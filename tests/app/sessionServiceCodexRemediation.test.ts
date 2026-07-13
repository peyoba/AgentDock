import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PtyAdapter, PtySpawnRequest } from '../../src/main/adapters/ptyAdapter';
import { createSessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';
import { createSessionService } from '../../src/main/sessionService';

function createRuntime() {
  const spawnRequests: PtySpawnRequest[] = [];
  const exitHandlers = new Map<string, (event: { exitCode: number; signal?: number }) => void>();
  const pty: PtyAdapter = {
    async spawn(request) {
      spawnRequests.push(request);
      return {
        id: request.sessionId,
        write() {},
        resize() {},
        kill() {},
        onData() { return () => undefined; },
        onExit(listener) {
          exitHandlers.set(request.sessionId, listener);
          return () => exitHandlers.delete(request.sessionId);
        },
      };
    },
  };
  return {
    exitHandlers,
    pty,
    spawnRequests,
    keychain: {
      async readSecret() { return 'test-upstream-secret'; },
      async writeSecret() {},
      async deleteSecret() {},
    },
  };
}

function codexProfile(tempDir: string) {
  return {
    id: 'profile-a',
    name: 'Codex Compatible',
    toolType: 'codex' as const,
    baseUrl: 'https://upstream.example.invalid/v1',
    defaultModel: 'gpt-5.6-sol',
    keychainService: 'AgentDock',
    keychainAccount: 'profile-a',
    codexHome: path.join(tempDir, 'shared-profile-home'),
    codexDefaultLaunchMode: 'newapi-tool-compatible' as const,
  };
}

function workspace(tempDir: string) {
  return { id: 'workspace-a', name: 'AgentDock', path: tempDir };
}

function proxyFactory() {
  return vi.fn(async ({ sessionId }: { sessionId: string }) => ({
    baseUrl: `http://127.0.0.1/${sessionId}/v1`,
    localApiKey: `test-local-token-${sessionId}`,
    internalModel: `agentdock-tool-runtime-${sessionId}`,
    close: vi.fn().mockResolvedValue(undefined),
  }));
}

describe('sessionService Codex remediation contracts', () => {
  it.each(['resume', 'fresh'] as const)(
    'keeps a legacy Codex session native during %s despite the current compatible Profile default',
    async (strategy) => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-legacy-codex-'));
      const runtime = createRuntime();
      const historyStore = createSessionHistoryStore(tempDir);
      const startProxy = proxyFactory();
      try {
        await historyStore.saveSession({
          id: 'session-legacy', title: 'Legacy Codex', profileId: 'profile-a',
          workspaceId: 'workspace-a', command: 'codex --no-alt-screen', status: 'exited',
          startedAt: '2026-07-01T00:00:00.000Z',
          nativeResume: { tool: 'codex', status: 'verified', sessionId: 'thread-legacy', checkedAt: '2026-07-01T00:00:00.000Z' },
        });
        const service = createSessionService({
          keychain: runtime.keychain, pty: runtime.pty, appDataPath: tempDir,
          historyStore, startCodexToolCompatibilityProxy: startProxy,
        });
        await service.list();
        const restarted = await service.restart({
          sessionId: 'session-legacy', profile: codexProfile(tempDir), workspace: workspace(tempDir),
          strategy, command: 'codex --no-alt-screen', codexLaunchMode: 'newapi-tool-compatible',
        });

        expect(startProxy).not.toHaveBeenCalled();
        expect(restarted.codexLaunchMode).toBe('native-responses');
        expect(runtime.spawnRequests[0]?.env).toMatchObject({
          OPENAI_BASE_URL: 'https://upstream.example.invalid/v1',
          OPENAI_API_KEY: 'test-upstream-secret',
          CODEX_HOME: path.join(tempDir, 'shared-profile-home'),
        });
        await service.dispose();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  );

  it('preserves the base command across native resume followed by fresh restart', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-codex-command-'));
    const runtime = createRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      await historyStore.saveSession({
        id: 'session-native', title: 'Native Codex', profileId: 'profile-a',
        workspaceId: 'workspace-a', command: 'codex --no-alt-screen', status: 'exited',
        startedAt: '2026-07-01T00:00:00.000Z', codexLaunchMode: 'native-responses',
        nativeResume: { tool: 'codex', status: 'verified', sessionId: 'thread-native', checkedAt: '2026-07-01T00:00:00.000Z' },
      });
      const service = createSessionService({ keychain: runtime.keychain, pty: runtime.pty, appDataPath: tempDir, historyStore });
      await service.list();
      const resumed = await service.restart({
        sessionId: 'session-native', profile: codexProfile(tempDir), workspace: workspace(tempDir),
        strategy: 'resume', command: 'codex --no-alt-screen',
      });
      expect(runtime.spawnRequests.at(-1)?.command).toBe('codex resume thread-native');
      expect(resumed.command).toBe('codex --no-alt-screen');
      expect(resumed.resumeCommand).toBe('codex resume thread-native');

      runtime.exitHandlers.get('session-native')?.({ exitCode: 0 });
      await service.restart({
        sessionId: 'session-native', profile: codexProfile(tempDir), workspace: workspace(tempDir),
        strategy: 'fresh', command: resumed.command,
      });
      expect(runtime.spawnRequests.at(-1)?.command).toBe('codex --no-alt-screen');
      await service.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses isolated per-session Codex homes and config files for compatible sessions', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-codex-runtime-'));
    const runtime = createRuntime();
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      keychain: runtime.keychain, pty: runtime.pty, appDataPath: tempDir,
      startCodexToolCompatibilityProxy: proxyFactory(), ensureDirectory() {},
      writeTextFile(filePath, content) { writtenFiles.push({ filePath, content }); },
    });
    try {
      for (let index = 0; index < 2; index += 1) {
        await service.launch({
          profile: codexProfile(tempDir), workspace: workspace(tempDir),
          command: 'codex --no-alt-screen', codexLaunchMode: 'newapi-tool-compatible',
        });
      }
      const homes = runtime.spawnRequests.map((request) => request.env.CODEX_HOME);
      expect(homes[0]).not.toBe(homes[1]);
      expect(homes).not.toContain(path.join(tempDir, 'shared-profile-home'));
      expect(writtenFiles.map(({ filePath }) => filePath)).toEqual(
        homes.map((home) => path.join(home!, 'config.toml')),
      );
      writtenFiles.forEach(({ content }, index) => {
        expect(content).toContain(`agentdock-tool-runtime-session-${index + 1}`);
        expect(content).not.toContain(`test-local-token-session-${index + 1}`);
      });
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each(['exit', 'kill', 'dispose'] as const)(
    'removes the compatible Codex runtime home on %s',
    async (lifecycle) => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-codex-cleanup-'));
      const runtime = createRuntime();
      const service = createSessionService({
        keychain: runtime.keychain, pty: runtime.pty, appDataPath: tempDir,
        startCodexToolCompatibilityProxy: proxyFactory(),
      });
      try {
        const session = await service.launch({
          profile: codexProfile(tempDir), workspace: workspace(tempDir), command: 'codex',
          codexLaunchMode: 'newapi-tool-compatible',
        });
        const runtimeHome = runtime.spawnRequests[0]?.env.CODEX_HOME;
        const configPath = path.join(runtimeHome!, 'config.toml');
        const configContent = await readFile(configPath, 'utf-8');
        expect(configContent).toContain('agentdock-tool-runtime-session-1');
        expect(configContent).not.toContain('test-local-token-session-1');
        if (lifecycle === 'exit') runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });
        if (lifecycle === 'kill') await service.killTerminal({ sessionId: session.id });
        if (lifecycle === 'dispose') await service.dispose();
        await vi.waitFor(async () => await expect(access(runtimeHome!)).rejects.toThrow());
      } finally {
        await service.dispose();
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  );

  it('removes the compatible Codex runtime home when PTY spawn fails', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-codex-spawn-fail-'));
    const runtime = createRuntime();
    const failingPty: PtyAdapter = {
      ...runtime.pty,
      async spawn(request) {
        runtime.spawnRequests.push(request);
        throw new Error('test spawn failure');
      },
    };
    const service = createSessionService({
      keychain: runtime.keychain, pty: failingPty, appDataPath: tempDir,
      startCodexToolCompatibilityProxy: proxyFactory(),
    });
    try {
      await expect(service.launch({
        profile: codexProfile(tempDir), workspace: workspace(tempDir), command: 'codex',
        codexLaunchMode: 'newapi-tool-compatible',
      })).rejects.toThrow('终端命令启动失败');
      await expect(access(runtime.spawnRequests[0]!.env.CODEX_HOME)).rejects.toThrow();
    } finally {
      await service.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('retries a failed runtime-home removal without affecting other sessions or repeating after success', async () => {
    const unhandledRejections: unknown[] = [];
    const captureUnhandled = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', captureUnhandled);
    try {
      for (const scenario of [
        { trigger: 'exit', retry: 'dispose' },
        { trigger: 'kill', retry: 'dispose' },
        { trigger: 'exit', retry: 'restart' },
      ] as const) {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-codex-cleanup-retry-'));
        const runtime = createRuntime();
        const removalAttempts = new Map<string, number>();
        const proxyCloses = new Map<string, ReturnType<typeof vi.fn>>();
        let transientFailurePath: string | undefined;
        const service = createSessionService({
          keychain: runtime.keychain,
          pty: runtime.pty,
          appDataPath: tempDir,
          ensureDirectory() {},
          writeTextFile() {},
          removeDirectory: vi.fn(async (directoryPath) => {
            const attempt = (removalAttempts.get(directoryPath) ?? 0) + 1;
            removalAttempts.set(directoryPath, attempt);
            if (directoryPath === transientFailurePath && attempt === 1) {
              throw new Error('test transient remove failure');
            }
          }),
          startCodexToolCompatibilityProxy: vi.fn(async ({ sessionId }) => {
            const close = vi.fn().mockResolvedValue(undefined);
            proxyCloses.set(sessionId, close);
            return {
              baseUrl: `http://127.0.0.1/${sessionId}/v1`,
              localApiKey: `test-local-token-${sessionId}`,
              internalModel: `agentdock-tool-runtime-${sessionId}`,
              close,
            };
          }),
        });
        try {
          const target = await service.launch({
            profile: codexProfile(tempDir), workspace: workspace(tempDir), command: 'codex',
            codexLaunchMode: 'newapi-tool-compatible',
          });
          const other = await service.launch({
            profile: codexProfile(tempDir), workspace: workspace(tempDir), command: 'codex',
            codexLaunchMode: 'newapi-tool-compatible',
          });
          const runtimeHome = runtime.spawnRequests[0]!.env.CODEX_HOME;
          transientFailurePath = runtimeHome;

          if (scenario.trigger === 'exit') {
            runtime.exitHandlers.get(target.id)?.({ exitCode: 0 });
            await vi.waitFor(() => expect(removalAttempts.get(runtimeHome)).toBe(1));
          } else {
            await service.killTerminal({ sessionId: target.id }).catch(() => undefined);
          }
          expect(removalAttempts.get(runtimeHome)).toBe(1);
          expect(proxyCloses.get(other.id)).not.toHaveBeenCalled();
          expect(unhandledRejections).toEqual([]);

          if (scenario.retry === 'restart') {
            await service.restart({
              sessionId: target.id, profile: codexProfile(tempDir), workspace: workspace(tempDir),
              strategy: 'fresh', command: 'codex',
            });
          } else {
            await service.dispose();
          }
          expect(removalAttempts.get(runtimeHome)).toBe(2);
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(removalAttempts.get(runtimeHome)).toBe(2);
          expect(unhandledRejections).toEqual([]);
        } finally {
          await service.dispose().catch(() => undefined);
          await rm(tempDir, { recursive: true, force: true });
        }
      }
    } finally {
      process.removeListener('unhandledRejection', captureUnhandled);
    }
  });
});
