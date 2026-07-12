import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeOwnerRegistry,
  createSessionService,
} from '../../src/main/sessionService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter, PtySpawnRequest } from '../../src/main/adapters/ptyAdapter';
import type { WorkspaceContextStore } from '../../src/main/workspaceContextStore';
import type { SessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';
import { createSessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';

function createFakeRuntime() {
  const spawnRequests: PtySpawnRequest[] = [];
  const writes: Array<{ sessionId: string; input: string }> = [];
  const dataHandlers = new Map<string, (data: string) => void>();
  const exitHandlers = new Map<string, (event: { exitCode: number; signal?: number }) => void>();

  const keychain: KeychainAdapter = {
    async readSecret(service, account) {
      expect(service).toBe('AgentDock');
      expect(account).toBe('profile-a');
      return 'local-development-secret';
    },
    async writeSecret() {},
    async deleteSecret() {},
  };

  const pty: PtyAdapter = {
    async spawn(request) {
      spawnRequests.push(request);
      return {
        id: request.sessionId,
        write(input) {
          writes.push({ sessionId: request.sessionId, input });
        },
        resize() {},
        kill() {},
        onData(listener) {
          dataHandlers.set(request.sessionId, listener);
          return () => dataHandlers.delete(request.sessionId);
        },
        onExit(listener) {
          exitHandlers.set(request.sessionId, listener);
          return () => {};
        },
      };
    },
  };

  return { keychain, pty, spawnRequests, writes, dataHandlers, exitHandlers };
}

function shellQuoteForTest(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function restorePromptForTest(contextFile: string): string {
  return [
    'Read the AgentDock restore context file and use it as background memory.',
    "Reply with one short memory-restored sentence, then wait for the user's next instruction.",
    'Do not continue previous tasks unless the user explicitly asks.',
    contextFile,
  ].join(' ');
}

function claudeRestoreCommandForTest(command: string, contextFile: string): string {
  return `${command} --append-system-prompt ${shellQuoteForTest(restorePromptForTest(contextFile))}`;
}

describe('sessionService', () => {
  it('launches a session through injected keychain and PTY adapters', async () => {
    const runtime = createFakeRuntime();
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    expect(session).toEqual({
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-01T00:00:00.000Z',
      runtimeOwner: {
        ownerId: 'default-window',
        startedAt: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(await service.list()).toEqual([session]);
    expect(runtime.spawnRequests).toEqual([
      {
        sessionId: 'session-1',
        command: 'claude',
        cwd: '/Users/example/Desktop/web/AgentDock',
        env: {
          ANTHROPIC_BASE_URL: 'https://example.invalid/v1',
          ANTHROPIC_AUTH_TOKEN: 'local-development-secret',
        },
      },
    ]);
  });

  it('does not reuse session IDs after a record is deleted', async () => {
    const runtime = createFakeRuntime();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });
    const launchInput = {
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    };

    const first = await service.launch(launchInput);
    const second = await service.launch(launchInput);
    expect(first.id).toBe('session-1');
    expect(second.id).toBe('session-2');

    await service.killTerminal({ sessionId: first.id });
    await service.deleteSessionRecord({ sessionId: first.id });

    const third = await service.launch(launchInput);
    expect(third.id).toBe('session-3');
  });

  it('uses a session-local Claude compat proxy when the profile enables it', async () => {
    const runtime = createFakeRuntime();
    const startClaudeCompatProxy = vi.fn(async ({ upstreamBaseUrl, sessionId }) => ({
      baseUrl: `http://127.0.0.1:41000/${sessionId}`,
      close: vi.fn(async () => undefined),
      upstreamBaseUrl,
    }));
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      startClaudeCompatProxy,
    });

    await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://upstream-a.example',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeAnthropicCompatProxyEnabled: true,
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    expect(startClaudeCompatProxy).toHaveBeenCalledWith({
      upstreamBaseUrl: 'https://upstream-a.example',
      profileId: 'profile-a',
      sessionId: 'session-1',
    });
    expect(runtime.spawnRequests[0]?.env.ANTHROPIC_BASE_URL).toBe(
      'http://127.0.0.1:41000/session-1',
    );
    expect(runtime.spawnRequests[0]?.env.ANTHROPIC_AUTH_TOKEN).toBe(
      'local-development-secret',
    );
  });

  it('does not use the Claude compat proxy for local shell commands or disabled profiles', async () => {
    const runtime = createFakeRuntime();
    const startClaudeCompatProxy = vi.fn();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      startClaudeCompatProxy,
    });
    const profile = {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude' as const,
      baseUrl: 'https://upstream-a.example',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
      claudeAnthropicCompatProxyEnabled: true,
    };
    const workspace = {
      id: 'workspace-a',
      name: 'AgentDock',
      path: '/Users/example/Desktop/web/AgentDock',
    };

    await service.launch({ profile, workspace, command: 'zsh' });
    await service.launch({
      profile: { ...profile, claudeAnthropicCompatProxyEnabled: false },
      workspace,
      command: 'claude',
    });

    expect(startClaudeCompatProxy).not.toHaveBeenCalled();
    expect(runtime.spawnRequests[0]?.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(runtime.spawnRequests[1]?.env.ANTHROPIC_BASE_URL).toBe(
      'https://upstream-a.example',
    );
  });

  it('closes the Claude compat proxy on spawn failure, stop, and PTY exit', async () => {
    const runtime = createFakeRuntime();
    const closed: string[] = [];
    const pty: PtyAdapter = {
      async spawn(request) {
        if (request.sessionId === 'session-1') {
          throw new Error('spawn failed');
        }
        return runtime.pty.spawn(request);
      },
    };
    const service = createSessionService({
      keychain: runtime.keychain,
      pty,
      appDataPath: '/tmp/agentdock-test-data',
      startClaudeCompatProxy: vi.fn(async ({ sessionId }) => ({
        baseUrl: `http://127.0.0.1:42000/${sessionId}`,
        close: vi.fn(async () => {
          closed.push(sessionId);
        }),
      })),
    });
    const profile = {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude' as const,
      baseUrl: 'https://upstream-a.example',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
      claudeAnthropicCompatProxyEnabled: true,
    };
    const workspace = {
      id: 'workspace-a',
      name: 'AgentDock',
      path: '/Users/example/Desktop/web/AgentDock',
    };

    await expect(service.launch({ profile, workspace, command: 'claude' })).rejects.toThrow(
      '终端命令启动失败',
    );
    const stoppedSession = await service.launch({ profile, workspace, command: 'claude' });
    await service.killTerminal({ sessionId: stoppedSession.id });
    const exitedSession = await service.launch({ profile, workspace, command: 'claude' });
    runtime.exitHandlers.get(exitedSession.id)?.({ exitCode: 0 });

    expect(closed).toEqual(['session-1', 'session-2', 'session-3']);
  });

  it('records exit code and Claude resume command when a PTY exits', async () => {
    const runtime = createFakeRuntime();
    const changedSessions: string[] = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });
    service.onSessionChanged((session) => {
      changedSessions.push(`${session.status}:${session.exitCode}:${session.resumeCommand}`);
    });

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    runtime.dataHandlers.get(session.id)?.(
      'Resume this session with:\r\nclaude --resume c4bf-b857\r\n',
    );
    runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        id: session.id,
        status: 'exited',
        exitCode: 0,
        resumeCommand: 'claude --resume c4bf-b857',
      }),
    ]);
    expect(changedSessions).toContain('exited:0:claude --resume c4bf-b857');
  });

  it('restarts an exited session with the same session id and preserved buffer', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restart-same-id-'));
    const runtime = createFakeRuntime();
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      const session = await service.launch({
        profile,
        workspace,
        command: 'claude',
      });
      runtime.dataHandlers.get(session.id)?.('previous terminal output');
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

      const resumeRestartRequest = {
        sessionId: session.id,
        profile,
        workspace,
        command: 'claude --resume c4bf-b857',
        strategy: 'resume' as const,
      };
      const restartedSession = await service.restart(resumeRestartRequest);

      expect(restartedSession).toMatchObject({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --resume c4bf-b857',
        status: 'running',
        startedAt: '2026-07-01T00:00:00.000Z',
        memoryRestore: {
          status: 'loaded',
          summary: '记忆已恢复：已加载最近会话背景，等待你的下一步指令。',
          contextFile: path.join(tempDir, '.agentdock/context/restores/session-1.md'),
        },
      });
      expect(runtime.spawnRequests.at(-1)).toEqual({
        sessionId: 'session-1',
        command: claudeRestoreCommandForTest(
          'claude --resume c4bf-b857',
          path.join(tempDir, '.agentdock/context/restores/session-1.md'),
        ),
        cwd: tempDir,
        env: {
          ANTHROPIC_BASE_URL: 'https://example.invalid/v1',
          ANTHROPIC_AUTH_TOKEN: 'local-development-secret',
        },
      });
      expect(runtime.writes.some((write) => write.input.includes('Read the AgentDock restore context file'))).toBe(false);
      await expect(service.readTerminalBuffer({ sessionId: session.id })).resolves.toContain(
        'previous terminal output',
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('uses verified native resume before AgentDock restore context fallback', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-native-resume-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      await historyStore.saveSession({
        id: 'session-native',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'exited',
        startedAt: '2026-07-01T00:00:00.000Z',
        nativeResume: {
          tool: 'claude',
          status: 'verified',
          sessionId: '123e4567-e89b-12d3-a456-426614174000',
          checkedAt: '2026-07-07T00:00:00.000Z',
        },
      });
      await historyStore.appendOutput('session-native', 'previous output that would feed fallback');
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:01:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: tempDir,
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      await service.list();
      const restarted = await service.restart({
        sessionId: 'session-native',
        profile,
        workspace,
        command: 'claude',
      });

      expect(runtime.spawnRequests.at(-1)?.command).toBe(
        'claude --resume 123e4567-e89b-12d3-a456-426614174000',
      );
      expect(runtime.spawnRequests.at(-1)?.command).not.toContain('AgentDock restore context');
      expect(runtime.spawnRequests.at(-1)?.command).not.toContain('--append-system-prompt');
      expect(restarted.memoryRestore).toMatchObject({
        method: 'native',
        status: 'loaded',
        summary: '原生恢复已验证：使用 Claude 会话 ID 恢复。',
      });
      await expect(
        readFile(path.join(tempDir, '.agentdock/context/restores/session-native.md'), 'utf-8'),
      ).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('preserves persisted history when restarting an exited session in place', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restart-history-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir, {
      maxBufferBytes: 1000,
      maxSessions: 50,
    });
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      };

      const session = await service.launch({
        profile,
        workspace,
        command: 'claude',
      });
      runtime.dataHandlers.get(session.id)?.('previous terminal output');
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });
      await historyStore.readBuffer(session.id);

      await service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'claude --resume c4bf-b857',
      });

      await expect(historyStore.readBuffer(session.id)).resolves.toContain(
        'previous terminal output',
      );
      await expect(service.readTerminalBuffer({ sessionId: session.id })).resolves.toContain(
        'previous terminal output',
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('passes a redacted restore prompt as the initial CLI prompt when restarting an agent session', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-context-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };
      const fakeOpenAiKey = ['sk', 'test-session-service-redaction-token'].join('-');

      const session = await service.launch({ profile, workspace, command: 'claude' });
      runtime.dataHandlers.get(session.id)?.(`OPENAI_API_KEY=${fakeOpenAiKey}\nrecent output`);
      await historyStore.readBuffer(session.id);
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

      const restarted = await service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'claude --resume c4bf-b857',
      });

      const restoreContextFile = path.join(tempDir, '.agentdock/context/restores/session-1.md');
      const restartSpawn = runtime.spawnRequests.at(-1);
      expect(restartSpawn?.command).toBe(
        claudeRestoreCommandForTest('claude --resume c4bf-b857', restoreContextFile),
      );
      expect(runtime.writes.some((write) => write.input.includes('Read the AgentDock restore context file'))).toBe(false);
      expect(restartSpawn?.command).not.toContain('recent output');
      expect(restarted.memoryRestore?.summary).toBe('记忆已恢复：已加载最近会话背景，等待你的下一步指令。');
      await expect(readFile(restoreContextFile, 'utf-8'))
        .resolves.toContain('recent output');
      await expect(readFile(restoreContextFile, 'utf-8'))
        .resolves.not.toContain(fakeOpenAiKey);
      expect(restartSpawn?.command).not.toContain(fakeOpenAiKey);
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('passes a readable restore prompt as the initial CLI prompt when the previous agent used TUI redraw output', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-tui-context-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      const session = await service.launch({ profile, workspace, command: 'claude' });
      runtime.dataHandlers.get(session.id)?.(
        [
          '\u001b[?1049h\u001b[?1006h\u001b[2J\u001b[H',
          'Working(9s • esc to interrupt)\r\u001b[2K',
          '\u001b[38;5;244m> 你好\u001b[0m\r\n',
          '\u001b[39m用户确认：重启前的最近对话必须传给新 Agent。\u001b[0m',
        ].join(''),
      );
      await historyStore.readBuffer(session.id);
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

      const restarted = await service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'claude --resume c4bf-b857',
      });

      const restoreContextFile = path.join(tempDir, '.agentdock/context/restores/session-1.md');
      const restartSpawn = runtime.spawnRequests.at(-1);
      expect(restartSpawn?.command).toBe(
        claudeRestoreCommandForTest('claude --resume c4bf-b857', restoreContextFile),
      );
      expect(runtime.writes.some((write) => write.input.includes('Read the AgentDock restore context file'))).toBe(false);
      expect(restartSpawn?.command).not.toContain('用户确认：重启前的最近对话必须传给新 Agent。');
      expect(restarted.memoryRestore?.summary).toBe('记忆已恢复：已加载最近会话背景，等待你的下一步指令。');
      const restoreContext = await readFile(restoreContextFile, 'utf-8');
      expect(restoreContext).toContain('用户确认：重启前的最近对话必须传给新 Agent。');
      expect(restoreContext).toContain('> 你好');
      expect(restoreContext).not.toContain('\u001b');
      expect(restoreContext).not.toContain('[38;5;244m');
      expect(restoreContext).not.toContain('Working(9s');
      expect(restartSpawn?.command).not.toContain('\u001b');
      expect(restartSpawn?.command).not.toContain('[38;5;244m');
      expect(restartSpawn?.command).not.toContain('Working(9s');
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('writes a restore context file and passes only the short read instruction as the initial CLI prompt', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-file-restart-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      const session = await service.launch({ profile, workspace, command: 'claude' });
      runtime.dataHandlers.get(session.id)?.('用户确认：恢复摘要只显示一句话。');
      await historyStore.readBuffer(session.id);
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

      const restarted = await service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'claude --resume c4bf-b857',
      });

      const restoreContextFile = path.join(tempDir, '.agentdock/context/restores/session-1.md');
      const restartSpawn = runtime.spawnRequests.at(-1);
      expect(restartSpawn?.command).toBe(
        claudeRestoreCommandForTest('claude --resume c4bf-b857', restoreContextFile),
      );
      expect(runtime.writes.some((write) => write.input.includes('Read the AgentDock restore context file'))).toBe(false);
      expect(restartSpawn?.command).not.toContain('用户确认：恢复摘要只显示一句话');
      expect(restarted.memoryRestore).toMatchObject({
        status: 'loaded',
        summary: '记忆已恢复：已加载最近会话背景，等待你的下一步指令。',
        contextFile: restoreContextFile,
      });
      await expect(readFile(restoreContextFile, 'utf-8'))
        .resolves.toContain('用户确认：恢复摘要只显示一句话');
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('passes the restore instruction as an initial prompt for Codex restarts without writing stdin', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-codex-restore-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: tempDir,
        historyStore,
        ensureDirectory() {},
        writeTextFile() {},
      });
      const profile = {
        id: 'profile-a',
        name: 'Codex A',
        toolType: 'codex' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      const session = await service.launch({ profile, workspace, command: 'codex' });
      runtime.dataHandlers.get(session.id)?.('用户确认：Codex 恢复不能写入输入框。');
      await historyStore.readBuffer(session.id);
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

      await service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'codex',
      });

      const restoreContextFile = path.join(tempDir, '.agentdock/context/restores/session-1.md');
      expect(runtime.spawnRequests.at(-1)?.command).toBe(
        `codex ${shellQuoteForTest(restorePromptForTest(restoreContextFile))}`,
      );
      expect(runtime.writes.some((write) => write.input.includes('Read the AgentDock restore context file'))).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('does not inject restore memory into local shell restarts', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-shell-no-restore-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      const session = await service.launch({ profile, workspace, command: 'zsh' });
      runtime.dataHandlers.get(session.id)?.('shell output');
      await historyStore.readBuffer(session.id);
      runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

      const restarted = await service.restart({
        sessionId: session.id,
        profile,
        workspace,
        command: 'zsh',
      });

      expect(runtime.writes.some((write) => write.input.includes('Read the AgentDock restore context file'))).toBe(false);
      expect(restarted.memoryRestore).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('stores cleaned terminal history for TUI redraw output without filling the save limit', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-clean-history-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir, {
      maxBufferBytes: 120,
      maxSessions: 50,
    });
    const contextOutput: string[] = [];
    const workspaceContext: WorkspaceContextStore = {
      async startSession() {
        return {
          contextDir: '/Users/example/Desktop/web/AgentDock/.agentdock/context',
          sharedContextFile: '/Users/example/Desktop/web/AgentDock/.agentdock/context/shared-context.md',
          sessionTranscriptFile:
            '/Users/example/Desktop/web/AgentDock/.agentdock/context/sessions/session-1.md',
        };
      },
      async appendOutput({ data }) {
        contextOutput.push(data);
      },
      async readSharedContext() {
        return { filePath: '', content: '' };
      },
      async ensureGitExcluded() {},
    };

    try {
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
        workspaceContext,
      });
      const session = await service.launch({
        profile: {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
        workspace: {
          id: 'workspace-a',
          name: 'AgentDock',
          path: '/Users/example/Desktop/web/AgentDock',
        },
        command: 'claude',
      });
      await historyStore.listSessions();

      const redrawOutput = Array.from({ length: 8 }, (_, index) => index + 1)
        .map((frame) => `\u001b[2J\u001b[HWorking ${frame}...\r\u001b[2KDone ${frame}\n`)
        .join('');
      expect(Buffer.byteLength(redrawOutput, 'utf-8')).toBeGreaterThan(120);
      runtime.dataHandlers.get(session.id)?.(redrawOutput);

      await vi.waitFor(async () => {
        await expect(historyStore.readBuffer(session.id)).resolves.toContain('Done 8');
      });

      const storedBuffer = await historyStore.readBuffer(session.id);
      expect(storedBuffer).toBe('Done 8\n');
      expect(storedBuffer).not.toContain('\u001b');
      expect(Buffer.byteLength(storedBuffer, 'utf-8')).toBeLessThan(120);
      expect((await service.list())[0].historyLimitReached).toBeUndefined();
      await expect(service.readTerminalBuffer({ sessionId: session.id })).resolves.toContain(
        '\u001b[2J',
      );
      await vi.waitFor(() => {
        expect(contextOutput.join('')).toBe('Done 8\n');
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('loads persisted session history and marks previously running sessions as interrupted', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-history-'));
    const historyStore = createSessionHistoryStore(tempDir, {
      maxBufferBytes: 1000,
      maxSessions: 50,
    });
    try {
      await historyStore.saveSession({
        id: 'session-old',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'running',
        startedAt: '2026-07-01T00:00:00.000Z',
      });
      await historyStore.appendOutput('session-old', 'previous terminal output');

      const service = createSessionService({
        clock: { now: () => new Date('2026-07-02T00:00:00.000Z') },
        keychain: createFakeRuntime().keychain,
        pty: createFakeRuntime().pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });

      await expect(service.list()).resolves.toEqual([
        expect.objectContaining({
          id: 'session-old',
          status: 'interrupted',
        }),
      ]);
      await expect(service.readTerminalBuffer({ sessionId: 'session-old' })).resolves.toBe(
        'previous terminal output',
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('can start an independent window service without restoring persisted sessions', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-new-window-history-'));
    const historyStore = createSessionHistoryStore(tempDir, {
      maxBufferBytes: 1000,
      maxSessions: 50,
    });
    try {
      await historyStore.saveSession({
        id: 'session-old',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'running',
        startedAt: '2026-07-01T00:00:00.000Z',
      });

      const service = createSessionService({
        keychain: createFakeRuntime().keychain,
        pty: createFakeRuntime().pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
        restoreHistory: false,
      });

      await expect(service.list()).resolves.toEqual([]);
      await expect(historyStore.listSessions()).resolves.toEqual([
        expect.objectContaining({
          id: 'session-old',
          status: 'running',
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('spawns the PTY even when session history persistence is backed up', async () => {
    const runtime = createFakeRuntime();
    let releaseSaveSession: (() => void) | undefined;
    const historyStore: SessionHistoryStore = {
      listSessions: vi.fn().mockResolvedValue([]),
      saveSession: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseSaveSession = resolve;
          }),
      ),
      appendOutput: vi.fn().mockResolvedValue({ limitReached: false }),
      readBuffer: vi.fn().mockResolvedValue(''),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      archiveBuffer: vi.fn().mockResolvedValue({ filePath: '/tmp/archive.txt' }),
    };
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      historyStore,
    });

    const launchPromise = service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });
    await vi.waitFor(() => {
      expect(runtime.spawnRequests).toHaveLength(1);
    });
    releaseSaveSession?.();
    await expect(launchPromise).resolves.toEqual(
      expect.objectContaining({
        id: 'session-1',
        status: 'running',
      }),
    );
  });

  it('stops a running PTY without deleting the session record', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-stop-keeps-record-'));
    const runtime = createFakeRuntime();
    try {
      const historyStore = createSessionHistoryStore(tempDir);
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });

      const session = await service.launch({
        profile: {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
        workspace: {
          id: 'workspace-a',
          name: 'AgentDock',
          path: '/Users/example/Desktop/web/AgentDock',
        },
        command: 'claude',
      });

      await service.killTerminal({ sessionId: session.id });

      await expect(service.list()).resolves.toEqual([
        expect.objectContaining({ id: session.id, status: 'stopped' }),
      ]);
      await expect(historyStore.listSessions()).resolves.toEqual([
        expect.objectContaining({ id: session.id, status: 'stopped' }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('closes a view without deleting the session record', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-close-view-'));
    const runtime = createFakeRuntime();
    try {
      const historyStore = createSessionHistoryStore(tempDir);
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const session = await service.launch({
        profile: {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
        workspace: {
          id: 'workspace-a',
          name: 'AgentDock',
          path: '/Users/example/Desktop/web/AgentDock',
        },
        command: 'claude',
      });

      await service.closeSessionView({ sessionId: session.id, viewId: 'window-1' });

      await expect(service.list()).resolves.toEqual([
        expect.objectContaining({ id: session.id, closedViewIds: ['window-1'] }),
      ]);
      await expect(historyStore.listSessions()).resolves.toEqual([
        expect.objectContaining({ id: session.id, closedViewIds: ['window-1'] }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('archives and deletes session records through explicit record operations', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-record-ops-'));
    const runtime = createFakeRuntime();
    try {
      const historyStore = createSessionHistoryStore(tempDir);
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
      });
      const session = await service.launch({
        profile: {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
        workspace: {
          id: 'workspace-a',
          name: 'AgentDock',
          path: '/Users/example/Desktop/web/AgentDock',
        },
        command: 'claude',
      });

      const archived = await service.archiveSessionRecord({ sessionId: session.id });
      expect(archived).toEqual(expect.objectContaining({ id: session.id, archived: true }));
      await expect(historyStore.listSessions()).resolves.toEqual([
        expect.objectContaining({ id: session.id, archived: true }),
      ]);

      await service.deleteSessionRecord({ sessionId: session.id });

      await expect(service.list()).resolves.toEqual([]);
      await expect(historyStore.listSessions()).resolves.toEqual([]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prevents another window from continuing a session owned by a running PTY', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-runtime-owner-'));
    const ownerRegistry = createRuntimeOwnerRegistry();
    const ownerRuntime = createFakeRuntime();
    const observerRuntime = createFakeRuntime();
    try {
      const historyStore = createSessionHistoryStore(tempDir);
      const ownerService = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
        keychain: ownerRuntime.keychain,
        pty: ownerRuntime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
        runtimeOwnerId: 'window-a',
        runtimeOwnerRegistry: ownerRegistry,
      });
      const observerService = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:01:00.000Z') },
        keychain: observerRuntime.keychain,
        pty: observerRuntime.pty,
        appDataPath: '/tmp/agentdock-test-data',
        historyStore,
        runtimeOwnerId: 'window-b',
        runtimeOwnerRegistry: ownerRegistry,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      };

      const session = await ownerService.launch({ profile, workspace, command: 'claude' });
      await vi.waitFor(async () => {
        await expect(historyStore.listSessions()).resolves.toEqual([
          expect.objectContaining({
            id: session.id,
            status: 'running',
            runtimeOwner: expect.objectContaining({ ownerId: 'window-a' }),
          }),
        ]);
      });

      await expect(observerService.list()).resolves.toEqual([
        expect.objectContaining({
          id: session.id,
          status: 'running',
          runtimeOwner: expect.objectContaining({ ownerId: 'window-a' }),
        }),
      ]);
      await expect(
        observerService.restart({ sessionId: session.id, profile, workspace, command: 'claude' }),
      ).rejects.toThrow('该会话正在另一窗口运行');
      expect(observerRuntime.spawnRequests).toHaveLength(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not estimate continuation-material pressure from raw terminal replay bytes', async () => {
    const runtime = createFakeRuntime();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });
    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    runtime.dataHandlers.get(session.id)?.('x'.repeat(4_500_000));

    await expect(service.getContextPressure({ sessionId: session.id })).resolves.toEqual({
      sessionId: session.id,
      level: 'low',
      score: 0,
    });
  });

  it('delegates session summaries with non-secret session and workspace metadata', async () => {
    const runtime = createFakeRuntime();
    const summaryJob = vi.fn().mockResolvedValue({
      status: 'success',
      summaryFile: '/workspace/.agentdock/context/summaries/session-1.md',
      handoffFile: '/workspace/.agentdock/context/handoffs/session-1.md',
      handoffPrompt: 'Read the AgentDock handoff first',
    });
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      summaryJob,
    });
    const workspace = {
      id: 'workspace-a',
      name: 'AgentDock',
      path: '/Users/example/Desktop/web/AgentDock',
    };
    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace,
      command: 'claude',
    });

    await expect(
      service.summarizeSession({ sessionId: session.id, continueAfterSummary: true }),
    ).resolves.toEqual({
      status: 'success',
      summaryFile: '/workspace/.agentdock/context/summaries/session-1.md',
      handoffFile: '/workspace/.agentdock/context/handoffs/session-1.md',
      handoffPrompt: 'Read the AgentDock handoff first',
    });

    expect(JSON.stringify(summaryJob.mock.calls)).not.toContain('local-development-secret');
    expect(summaryJob).toHaveBeenCalledWith({
      session,
      workspace,
      continueAfterSummary: true,
    });
  });

  it('coalesces terminal history output while a previous append is still running', async () => {
    const runtime = createFakeRuntime();
    let releaseAppend: (() => void) | undefined;
    const appendOutput = vi.fn(
      () =>
        new Promise<{ limitReached: boolean }>((resolve) => {
          releaseAppend = () => resolve({ limitReached: false });
        }),
    );
    const historyStore: SessionHistoryStore = {
      listSessions: vi.fn().mockResolvedValue([]),
      saveSession: vi.fn().mockResolvedValue(undefined),
      appendOutput,
      readBuffer: vi.fn().mockResolvedValue(''),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      archiveBuffer: vi.fn().mockResolvedValue({ filePath: '/tmp/archive.txt' }),
    };
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      historyStore,
    });
    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    runtime.dataHandlers.get(session.id)?.('first');
    await vi.waitFor(() => {
      expect(appendOutput).toHaveBeenCalledTimes(1);
    });
    runtime.dataHandlers.get(session.id)?.(' second');
    runtime.dataHandlers.get(session.id)?.(' third');
    expect(appendOutput).toHaveBeenCalledTimes(1);

    releaseAppend?.();
    await vi.waitFor(() => {
      expect(appendOutput).toHaveBeenCalledTimes(2);
    });
    expect(appendOutput).toHaveBeenNthCalledWith(1, session.id, 'first');
    expect(appendOutput).toHaveBeenNthCalledWith(2, session.id, ' second third');
  });

  it('passes only non-secret session metadata to workspace context', async () => {
    const runtime = createFakeRuntime();
    const startSessionInputs: unknown[] = [];
    const workspaceContext: WorkspaceContextStore = {
      async startSession(input) {
        startSessionInputs.push(JSON.parse(JSON.stringify(input)));
        return {
          contextDir: '/Users/example/Desktop/web/AgentDock/.agentdock/context',
          sharedContextFile: '/Users/example/Desktop/web/AgentDock/.agentdock/context/shared-context.md',
          sessionTranscriptFile:
            '/Users/example/Desktop/web/AgentDock/.agentdock/context/sessions/session-1.md',
        };
      },
      async appendOutput() {},
      async readSharedContext() {
        return { filePath: '', content: '' };
      },
      async ensureGitExcluded() {},
    };
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      workspaceContext,
    });

    await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    const contextJson = JSON.stringify(startSessionInputs);
    expect(contextJson).not.toContain('local-development-secret');
    expect(contextJson).not.toContain('ANTHROPIC_AUTH_TOKEN');
    expect(contextJson).not.toContain('OPENAI_API_KEY');
    expect(startSessionInputs).toEqual([
      {
        workspace: {
          id: 'workspace-a',
          name: 'AgentDock',
          path: '/Users/example/Desktop/web/AgentDock',
        },
        session: {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'starting',
          startedAt: '2026-07-01T00:00:00.000Z',
          runtimeOwner: {
            ownerId: 'default-window',
            startedAt: '2026-07-01T00:00:00.000Z',
          },
        },
      },
    ]);
  });

  it('writes Claude settings without secrets when model, cleanup, or env settings are configured', async () => {
    const runtime = createFakeRuntime();
    const ensuredDirectories: string[] = [];
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      ensureDirectory(directoryPath) {
        ensuredDirectories.push(directoryPath);
      },
      writeTextFile(filePath, content) {
        writtenFiles.push({ filePath, content });
      },
    });

    await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        defaultModel: 'claude-opus-4-8',
        claudeHaikuModel: 'claude-haiku-4-5-20251001',
        claudeSonnetModel: 'claude-fable-5',
        claudeOpusModel: 'claude-opus-4-8',
        claudeDefaultLaunchMode: 'opus',
        claudeAlwaysThinkingEnabled: true,
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeCodeRetryWatchdog: true,
        claudeCodeMaxRetries: 100,
        anthropicBetas: 'context-1m-2025-08-07',
        httpProxy: 'http://127.0.0.1:7897',
        httpsProxy: 'http://127.0.0.1:7897',
        claudeCodeDisableNonessentialTraffic: true,
        claudeCodeAttributionHeader: '0',
        disableInstallationChecks: true,
        claudeCleanupPeriodDays: 720,
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude --dangerously-skip-permissions',
    });

    expect(ensuredDirectories).toEqual(['/tmp/agentdock-test-data/claude-settings']);
    expect(writtenFiles).toEqual([
      {
        filePath: '/tmp/agentdock-test-data/claude-settings/profile-a.json',
        content: `${JSON.stringify({
          model: 'opus',
          alwaysThinkingEnabled: true,
          env: {
            ANTHROPIC_MODEL: 'claude-opus-4-8',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-fable-5',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-8',
            CLAUDE_CODE_RETRY_WATCHDOG: '1',
            CLAUDE_CODE_MAX_RETRIES: '100',
            ANTHROPIC_BETAS: 'context-1m-2025-08-07',
            HTTP_PROXY: 'http://127.0.0.1:7897',
            HTTPS_PROXY: 'http://127.0.0.1:7897',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
            DISABLE_INSTALLATION_CHECKS: '1',
          },
          cleanupPeriodDays: 720,
        }, null, 2)}\n`,
      },
    ]);
    expect(writtenFiles[0]?.content).not.toContain('local-development-secret');
    expect(runtime.spawnRequests[0]?.command).toBe(
      "claude --dangerously-skip-permissions --settings '/tmp/agentdock-test-data/claude-settings/profile-a.json'",
    );
  });

  it('writes CCometixLine statusLine settings only when the Claude profile enables it', async () => {
    const runtime = createFakeRuntime();
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const resolvedCcline =
      '/Applications/AgentDock.app/Contents/Resources/app.asar.unpacked/node_modules/@cometix/ccline-darwin-arm64/ccline';
    let resolveCalls = 0;
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      writeTextFile(filePath, content) {
        writtenFiles.push({ filePath, content });
      },
      resolveCclineCommand() {
        resolveCalls += 1;
        return resolvedCcline;
      },
    });

    await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeCclineStatusLineEnabled: true,
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    expect(resolveCalls).toBe(1);
    expect(writtenFiles).toEqual([
      {
        filePath: '/tmp/agentdock-test-data/claude-settings/profile-a.json',
        content: `${JSON.stringify({
          statusLine: {
            type: 'command',
            command: resolvedCcline,
            padding: 0,
          },
        }, null, 2)}\n`,
      },
    ]);
    expect(writtenFiles[0]?.content).not.toContain('local-development-secret');
    expect(runtime.spawnRequests[0]?.command).toBe(
      "claude --settings '/tmp/agentdock-test-data/claude-settings/profile-a.json'",
    );
  });

  it('shell-quotes the resolved ccline path and skips resolution when the toggle is off', async () => {
    const runtime = createFakeRuntime();
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    let resolveCalls = 0;
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      writeTextFile(filePath, content) {
        writtenFiles.push({ filePath, content });
      },
      resolveCclineCommand() {
        resolveCalls += 1;
        return '/Users/example/My Apps/AgentDock.app/Contents/Resources/app.asar.unpacked/ccline';
      },
    });

    const claudeProfile = {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude' as const,
      baseUrl: 'https://anyrouter.top',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
    };
    const workspace = {
      id: 'workspace-a',
      name: 'AgentDock',
      path: '/Users/example/Desktop/web/AgentDock',
    };

    await service.launch({
      profile: { ...claudeProfile, claudeCclineStatusLineEnabled: false },
      workspace,
      command: 'claude',
    });
    expect(resolveCalls).toBe(0);
    expect(writtenFiles).toEqual([]);

    await service.launch({
      profile: { ...claudeProfile, claudeCclineStatusLineEnabled: true },
      workspace,
      command: 'claude',
    });
    expect(resolveCalls).toBe(1);
    expect(writtenFiles[0]?.content).toContain(
      `"command": "'/Users/example/My Apps/AgentDock.app/Contents/Resources/app.asar.unpacked/ccline'"`,
    );
  });

  it('writes the full primary model when Claude launch mode is custom', async () => {
    const runtime = createFakeRuntime();
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      writeTextFile(filePath, content) {
        writtenFiles.push({ filePath, content });
      },
    });

    await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        defaultModel: 'claude-opus-4-8',
        claudeDefaultLaunchMode: 'custom',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude',
    });

    expect(JSON.parse(writtenFiles[0].content).model).toBe('claude-opus-4-8');
  });

  it('launches Claude lite mode with isolated settings and empty strict MCP config without changing model betas or retry settings', async () => {
    const runtime = createFakeRuntime();
    const ensuredDirectories: string[] = [];
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      ensureDirectory(directoryPath) {
        ensuredDirectories.push(directoryPath);
      },
      writeTextFile(filePath, content) {
        writtenFiles.push({ filePath, content });
      },
    });

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        defaultModel: 'claude-fable-5',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeCodeRetryWatchdog: true,
        claudeCodeMaxRetries: 100,
        anthropicBetas: 'context-1m-2025-08-07',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude --dangerously-skip-permissions',
      claudeLaunchMode: 'lite',
    });

    expect(session.claudeLaunchMode).toBe('lite');
    expect(ensuredDirectories).toEqual([
      '/tmp/agentdock-test-data/claude-settings',
      '/tmp/agentdock-test-data/claude-mcp',
    ]);
    expect(writtenFiles).toEqual([
      {
        filePath: '/tmp/agentdock-test-data/claude-settings/profile-a.json',
        content: `${JSON.stringify({
          model: 'claude-fable-5',
          env: {
            ANTHROPIC_MODEL: 'claude-fable-5',
            CLAUDE_CODE_RETRY_WATCHDOG: '1',
            CLAUDE_CODE_MAX_RETRIES: '100',
            ANTHROPIC_BETAS: 'context-1m-2025-08-07',
          },
        }, null, 2)}\n`,
      },
      {
        filePath: '/tmp/agentdock-test-data/claude-mcp/empty.json',
        content: `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
      },
    ]);
    expect(runtime.spawnRequests[0]?.command).toBe(
      "claude --dangerously-skip-permissions --settings '/tmp/agentdock-test-data/claude-settings/profile-a.json' --setting-sources project,local --mcp-config '/tmp/agentdock-test-data/claude-mcp/empty.json' --strict-mcp-config",
    );
  });

  it('restarts a Claude lite session with the same strict MCP isolation when no mode override is provided', async () => {
    const runtime = createFakeRuntime();
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      ensureDirectory() {},
      writeTextFile(filePath, content) {
        writtenFiles.push({ filePath, content });
      },
    });
    const profile = {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude' as const,
      baseUrl: 'https://anyrouter.top',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
    };
    const workspace = {
      id: 'workspace-a',
      name: 'AgentDock',
      path: '/Users/example/Desktop/web/AgentDock',
    };

    const session = await service.launch({
      profile,
      workspace,
      command: 'claude --dangerously-skip-permissions',
      claudeLaunchMode: 'lite',
    });
    runtime.exitHandlers.get(session.id)?.({ exitCode: 0 });

    const restartedSession = await service.restart({
      sessionId: session.id,
      profile,
      workspace,
      command: 'claude --resume c4bf-b857',
    });

    expect(restartedSession.claudeLaunchMode).toBe('lite');
    expect(writtenFiles).toContainEqual({
      filePath: '/tmp/agentdock-test-data/claude-mcp/empty.json',
      content: `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
    });
    expect(runtime.spawnRequests.at(-1)?.command).toBe(
      "claude --resume c4bf-b857 --setting-sources project,local --mcp-config '/tmp/agentdock-test-data/claude-mcp/empty.json' --strict-mcp-config",
    );
  });

  it('starts fresh without native resume or AgentDock restore context', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-fresh-restart-'));
    const runtime = createFakeRuntime();
    const historyStore = createSessionHistoryStore(tempDir);
    try {
      await historyStore.saveSession({
        id: 'session-fresh',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'exited',
        startedAt: '2026-07-01T00:00:00.000Z',
        nativeResume: {
          tool: 'claude',
          status: 'verified',
          sessionId: '123e4567-e89b-12d3-a456-426614174000',
          checkedAt: '2026-07-07T00:00:00.000Z',
        },
      });
      await historyStore.appendOutput(
        'session-fresh',
        'previous output that must not be restored into a fresh process',
      );
      const service = createSessionService({
        clock: { now: () => new Date('2026-07-01T00:01:00.000Z') },
        keychain: runtime.keychain,
        pty: runtime.pty,
        appDataPath: tempDir,
        historyStore,
      });
      const profile = {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude' as const,
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      };
      const workspace = {
        id: 'workspace-a',
        name: 'AgentDock',
        path: tempDir,
      };

      await service.list();
      const freshRestartRequest = {
        sessionId: 'session-fresh',
        profile,
        workspace,
        command: 'claude',
        strategy: 'fresh' as const,
      };
      const restartedSession = await service.restart(freshRestartRequest);

      expect(runtime.spawnRequests.at(-1)?.command).toBe('claude');
      expect(runtime.spawnRequests.at(-1)?.command).not.toContain('--resume');
      expect(runtime.spawnRequests.at(-1)?.command).not.toContain('--append-system-prompt');
      expect(restartedSession.memoryRestore?.method).not.toBe('native');
      expect(restartedSession.memoryRestore?.method).not.toBe('agentdock');
      await expect(
        readFile(path.join(tempDir, '.agentdock/context/restores/session-fresh.md'), 'utf-8'),
      ).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    }
  });

  it('launches Claude full mode without strict MCP isolation', async () => {
    const runtime = createFakeRuntime();
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      writeTextFile(filePath, content) {
        writtenFiles.push({ filePath, content });
      },
    });

    await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'claude --dangerously-skip-permissions',
      claudeLaunchMode: 'full',
    });

    expect(writtenFiles).toEqual([]);
    expect(runtime.spawnRequests[0]?.command).toBe('claude --dangerously-skip-permissions');
  });
});
