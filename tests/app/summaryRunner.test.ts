import { describe, expect, it, vi } from 'vitest';
import { createProfileSummaryRunner } from '../../src/main/summaryRunner';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type {
  PtyAdapter,
  PtyDataHandler,
  PtyExitEvent,
  PtyExitHandler,
  PtySpawnRequest,
} from '../../src/main/adapters/ptyAdapter';
import type { AgentSession, ApiProfile, Workspace } from '../../src/shared/agentdockTypes';

const session: AgentSession = {
  id: 'session-1',
  title: 'Claude A · AgentDock',
  profileId: 'profile-a',
  workspaceId: 'workspace-a',
  command: 'claude',
  status: 'running',
  startedAt: '2026-07-06T00:00:00.000Z',
};

const workspace: Workspace = {
  id: 'workspace-a',
  name: 'AgentDock',
  path: '/Users/example/Desktop/web/AgentDock',
};

function validSummary(): string {
  return [
    '\u001b[32m# AgentDock Session Summary\u001b[0m',
    '',
    '## Current Goal',
    'Ship context summary.',
    '',
    '## Decisions',
    '- Keep manual first.',
    '',
    '## Files And Areas Touched',
    '- src/main/summaryRunner.ts',
    '',
    '## Commands And Verification',
    '- npx vitest run tests/app/summaryRunner.test.ts',
    '',
    '## Problems And Risks',
    '- Real CLI smoke still needs local credentials.',
    '',
    '## Next Steps',
    '- Continue implementation.',
    '',
    '## Source',
    'Transcript tail provided by AgentDock.',
    '',
  ].join('\n');
}

function createRuntime(secret = 'secret-value-that-must-not-appear') {
  const spawnRequests: PtySpawnRequest[] = [];
  const dataHandlers = new Map<string, PtyDataHandler>();
  const exitHandlers = new Map<string, PtyExitHandler>();
  const readSecret = vi.fn(async () => secret);

  const keychain: KeychainAdapter = {
    readSecret,
    async writeSecret() {},
    async deleteSecret() {},
  };

  const pty: PtyAdapter = {
    async spawn(request) {
      spawnRequests.push(request);
      return {
        id: request.sessionId,
        write() {},
        resize() {},
        kill() {},
        onData(listener) {
          dataHandlers.set(request.sessionId, listener);
          return () => dataHandlers.delete(request.sessionId);
        },
        onExit(listener) {
          exitHandlers.set(request.sessionId, listener);
          return () => exitHandlers.delete(request.sessionId);
        },
      };
    },
  };

  return {
    keychain,
    pty,
    readSecret,
    spawnRequests,
    async waitForSpawn() {
      await vi.waitFor(() => expect(spawnRequests).toHaveLength(1));
      await vi.waitFor(() => {
        expect(dataHandlers.has(spawnRequests[0].sessionId)).toBe(true);
        expect(exitHandlers.has(spawnRequests[0].sessionId)).toBe(true);
      });
      return spawnRequests[0];
    },
    emitData(data: string) {
      const request = spawnRequests[0];
      dataHandlers.get(request.sessionId)?.(data);
    },
    emitExit(event: PtyExitEvent) {
      const request = spawnRequests[0];
      exitHandlers.get(request.sessionId)?.(event);
    },
  };
}

function runnerInput() {
  return {
    session,
    workspace,
    previousSummary: '# Previous\n\nKeep the command bar compact.',
    redactedTranscriptTail: 'terminal tail with [REDACTED] credential marker',
    generatedAt: '2026-07-06T00:05:00.000Z',
    summaryProviderProfileId: 'profile-a',
  };
}

describe('createProfileSummaryRunner', () => {
  it('runs Claude in print mode through the injected PTY and returns clean markdown', async () => {
    const runtime = createRuntime();
    const profile: ApiProfile = {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://claude.example.invalid',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
      skipPermissions: true,
    };
    const runSummary = createProfileSummaryRunner({
      profile,
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      homeDir: '/Users/example',
    });

    const resultPromise = runSummary(runnerInput());
    const spawnRequest = await runtime.waitForSpawn();
    runtime.emitData(validSummary());
    runtime.emitExit({ exitCode: 0 });

    await expect(resultPromise).resolves.toContain('# AgentDock Session Summary');
    await expect(resultPromise).resolves.not.toContain('\u001b[32m');
    expect(runtime.readSecret).toHaveBeenCalledWith('AgentDock', 'profile-a');
    expect(spawnRequest.cwd).toBe(workspace.path);
    expect(spawnRequest.env).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://claude.example.invalid',
      ANTHROPIC_AUTH_TOKEN: 'secret-value-that-must-not-appear',
    });
    expect(spawnRequest.command).toContain('claude --print');
    expect(spawnRequest.command).toContain('--output-format text');
    expect(spawnRequest.command).toContain('--no-session-persistence');
    expect(spawnRequest.command).toContain('--permission-mode plan');
    expect(spawnRequest.command).toContain('## Current Goal');
    expect(spawnRequest.command).toContain('terminal tail with [REDACTED]');
    expect(spawnRequest.command).not.toContain('dangerously');
    expect(spawnRequest.command).not.toContain('secret-value-that-must-not-appear');
  });

  it('runs Codex exec with isolated CODEX_HOME config that never writes the API key', async () => {
    const runtime = createRuntime('codex-secret-that-must-not-be-written');
    const ensuredDirectories: string[] = [];
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const profile: ApiProfile = {
      id: 'codex-a',
      name: 'Codex A',
      toolType: 'codex',
      baseUrl: 'https://openai.example.invalid/v1',
      defaultModel: 'gpt-5-codex',
      keychainService: 'AgentDock',
      keychainAccount: 'codex-a',
      codexHome: '~/.agentdock/codex-profiles/codex-a',
    };
    const runSummary = createProfileSummaryRunner({
      profile,
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      homeDir: '/Users/example',
      ensureDirectory: async (directoryPath) => {
        ensuredDirectories.push(directoryPath);
      },
      writeTextFile: async (filePath, content) => {
        writtenFiles.push({ filePath, content });
      },
    });

    const resultPromise = runSummary({
      ...runnerInput(),
      workspace: { ...workspace, path: '/Users/example/Desktop/web/Agent Dock' },
    });
    const spawnRequest = await runtime.waitForSpawn();
    runtime.emitData(validSummary());
    runtime.emitExit({ exitCode: 0 });

    await expect(resultPromise).resolves.toContain('## Next Steps');
    expect(ensuredDirectories).toEqual(['/Users/example/.agentdock/codex-profiles/codex-a']);
    expect(writtenFiles).toEqual([
      {
        filePath: '/Users/example/.agentdock/codex-profiles/codex-a/config.toml',
        content: expect.stringContaining('base_url = "https://openai.example.invalid/v1"'),
      },
    ]);
    expect(writtenFiles[0].content).toContain('model = "gpt-5-codex"');
    expect(writtenFiles[0].content).toContain('env_key = "OPENAI_API_KEY"');
    expect(writtenFiles[0].content).not.toContain('codex-secret-that-must-not-be-written');
    expect(spawnRequest.env).toMatchObject({
      OPENAI_BASE_URL: 'https://openai.example.invalid/v1',
      OPENAI_API_KEY: 'codex-secret-that-must-not-be-written',
      CODEX_HOME: '/Users/example/.agentdock/codex-profiles/codex-a',
    });
    expect(spawnRequest.command).toContain('codex exec');
    expect(spawnRequest.command).toContain("--cd '/Users/example/Desktop/web/Agent Dock'");
    expect(spawnRequest.command).toContain('--sandbox read-only');
    expect(spawnRequest.command).toContain('--ask-for-approval never');
    expect(spawnRequest.command).toContain('--skip-git-repo-check');
    expect(spawnRequest.command).toContain('--ephemeral');
    expect(spawnRequest.command).not.toContain('codex-secret-that-must-not-be-written');
  });

  it('rejects nonzero CLI exits without leaking raw output or secrets', async () => {
    const runtime = createRuntime();
    const profile: ApiProfile = {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://claude.example.invalid',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
    };
    const runSummary = createProfileSummaryRunner({
      profile,
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      homeDir: '/Users/example',
    });

    const resultPromise = runSummary(runnerInput());
    await runtime.waitForSpawn();
    runtime.emitData('raw failure with secret-value-that-must-not-appear');
    runtime.emitExit({ exitCode: 2 });

    await expect(resultPromise).rejects.toThrow('摘要 CLI 执行失败');
    await expect(resultPromise).rejects.not.toThrow('secret-value-that-must-not-appear');
    await expect(resultPromise).rejects.not.toThrow('raw failure');
  });
});
