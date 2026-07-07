import { describe, expect, it } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter } from '../../src/main/adapters/ptyAdapter';
import type { WorkspaceContextStore } from '../../src/main/workspaceContextStore';

function createTerminalRuntime() {
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  let killed = false;
  const killedSessionIds: string[] = [];
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

  const keychain: KeychainAdapter = {
    async readSecret() {
      return 'fake-secret-for-terminal-control';
    },
    async writeSecret() {},
    async deleteSecret() {},
  };

  const pty: PtyAdapter = {
    async spawn(request) {
      return {
        id: request.sessionId,
        write(input) {
          writes.push(input);
        },
        resize(cols, rows) {
          resizes.push({ cols, rows });
        },
        kill() {
          killed = true;
          killedSessionIds.push(request.sessionId);
        },
        onData(listener) {
          dataListeners.add(listener);
          return () => dataListeners.delete(listener);
        },
        onExit(listener) {
          exitListeners.add(listener);
          return () => exitListeners.delete(listener);
        },
      };
    },
  };

  return {
    keychain,
    pty,
    writes,
    resizes,
    get killed() {
      return killed;
    },
    get killedSessionIds() {
      return killedSessionIds;
    },
    emit(data: string) {
      for (const listener of dataListeners) {
        listener(data);
      }
    },
    emitExit(event: { exitCode: number; signal?: number }) {
      for (const listener of [...exitListeners]) {
        listener(event);
      }
    },
    get exitListenerCount() {
      return exitListeners.size;
    },
  };
}

async function launchTestSession(service: ReturnType<typeof createSessionService>) {
  return service.launch({
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
}

describe('sessionService terminal controls', () => {
  it('routes terminal input, resize, output, and kill through the stored PTY session', async () => {
    const runtime = createTerminalRuntime();
    const contextOutput: Array<{ workspacePath: string; sessionId: string; data: string }> = [];
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      workspaceContext: {
        async startSession() {
          return {
            contextDir: '/Users/example/Desktop/web/AgentDock/.agentdock/context',
            sharedContextFile: '/Users/example/Desktop/web/AgentDock/.agentdock/context/shared-context.md',
            sessionTranscriptFile: '/Users/example/Desktop/web/AgentDock/.agentdock/context/sessions/session-1.md',
          };
        },
        async appendOutput({ workspace, sessionId, data }) {
          contextOutput.push({ workspacePath: workspace.path, sessionId, data });
        },
        async readSharedContext() {
          return { filePath: '', content: '' };
        },
        async ensureGitExcluded() {},
      },
    });
    const outputEvents: Array<{ sessionId: string; data: string }> = [];
    const unsubscribe = service.onTerminalOutput((event) => outputEvents.push(event));

    const session = await launchTestSession(service);
    await service.writeTerminal({ sessionId: session.id, input: 'help\n' });
    await service.resizeTerminal({ sessionId: session.id, cols: 120, rows: 32 });
    runtime.emit('hello from fake pty');
    await expect(service.readTerminalBuffer({ sessionId: session.id })).resolves.toBe('hello from fake pty');
    const stopped = await service.killTerminal({ sessionId: session.id });
    runtime.emit('ignored after kill');
    unsubscribe();
    runtime.emit('not delivered');

    expect(runtime.writes).toEqual(['help\n']);
    expect(runtime.resizes).toEqual([{ cols: 120, rows: 32 }]);
    expect(runtime.killed).toBe(true);
    expect(stopped.status).toBe('stopped');
    const stoppedSessions = await service.list();
    expect(stoppedSessions).toEqual([
      expect.objectContaining({ id: session.id, status: 'stopped' }),
    ]);
    expect(stoppedSessions[0]).not.toHaveProperty('runtimeOwner');
    expect(outputEvents).toEqual([
      { sessionId: session.id, data: 'hello from fake pty' },
    ]);
    expect(contextOutput).toEqual([
      {
        workspacePath: '/Users/example/Desktop/web/AgentDock',
        sessionId: session.id,
        data: 'hello from fake pty',
      },
    ]);
  });

  it('keeps a multi-megabyte PTY replay buffer so switching tabs does not erase earlier context', async () => {
    const runtime = createTerminalRuntime();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });
    const session = await launchTestSession(service);

    runtime.emit(`BEGIN-CONTEXT\n${'a'.repeat(250_000)}\n`);
    runtime.emit(`LATEST-CONTEXT\n${'b'.repeat(250_000)}\n`);

    const replayBuffer = await service.readTerminalBuffer({ sessionId: session.id });

    expect(replayBuffer).toContain('BEGIN-CONTEXT');
    expect(replayBuffer).toContain('LATEST-CONTEXT');
  });

  it('disposes all running PTY sessions owned by the service', async () => {
    const runtime = createTerminalRuntime();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });
    const first = await launchTestSession(service);
    const second = await launchTestSession(service);

    await service.dispose();
    runtime.emit('ignored after dispose');

    expect(runtime.killedSessionIds).toEqual([first.id, second.id]);
    await expect(
      service.writeTerminal({ sessionId: first.id, input: 'help\n' }),
    ).rejects.toThrow('未找到指定的终端会话');
    const disposedSessions = await service.list();
    expect(disposedSessions).toEqual([
      expect.objectContaining({ id: first.id, status: 'stopped' }),
      expect.objectContaining({ id: second.id, status: 'stopped' }),
    ]);
    expect(disposedSessions[0]).not.toHaveProperty('runtimeOwner');
    expect(disposedSessions[1]).not.toHaveProperty('runtimeOwner');
  });



  it('launches a local zsh shell without reading API secrets', async () => {
    let readSecretCalled = false;
    const spawnedCommands: string[] = [];
    const spawnedEnvironments: Array<Record<string, string>> = [];
    const service = createSessionService({
      keychain: {
        async readSecret() {
          readSecretCalled = true;
          throw new Error('Keychain should not be read for local shell');
        },
        async writeSecret() {},
        async deleteSecret() {},
      },
      pty: {
        async spawn(request) {
          spawnedCommands.push(request.command);
          spawnedEnvironments.push(request.env);
          return {
            id: request.sessionId,
            write() {},
            resize() {},
            kill() {},
            onData() {
              return () => undefined;
            },
          };
        },
      },
      appDataPath: '/tmp/agentdock-test-data',
      workspaceContext: fixedWorkspaceContext(),
    });

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid',
        keychainService: 'AgentDock',
        keychainAccount: 'missing-secret',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'zsh',
    });

    expect(readSecretCalled).toBe(false);
    expect(spawnedCommands).toEqual(['zsh']);
    expect(spawnedEnvironments[0]).toMatchObject({
      AGENTDOCK_CONTEXT_DIR: '/Users/example/Desktop/web/AgentDock/.agentdock/context',
      AGENTDOCK_SHARED_CONTEXT_FILE: '/Users/example/Desktop/web/AgentDock/.agentdock/context/shared-context.md',
      AGENTDOCK_SESSION_TRANSCRIPT_FILE:
        '/Users/example/Desktop/web/AgentDock/.agentdock/context/sessions/session-1.md',
    });
    expect(session.status).toBe('running');
  });

  it('treats absolute shell paths like /bin/zsh as local shells without reading API secrets', async () => {
    let readSecretCalled = false;
    const spawnedEnvironments: Array<Record<string, string>> = [];
    const service = createSessionService({
      keychain: {
        async readSecret() {
          readSecretCalled = true;
          throw new Error('Keychain should not be read for local shell');
        },
        async writeSecret() {},
        async deleteSecret() {},
      },
      pty: {
        async spawn(request) {
          spawnedEnvironments.push(request.env);
          return {
            id: request.sessionId,
            write() {},
            resize() {},
            kill() {},
            onData() {
              return () => undefined;
            },
          };
        },
      },
      appDataPath: '/tmp/agentdock-test-data',
    });

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid',
        keychainService: 'AgentDock',
        keychainAccount: 'missing-secret',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: '/bin/zsh',
    });

    expect(readSecretCalled).toBe(false);
    expect(spawnedEnvironments[0]?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(session.status).toBe('running');
  });

  it('creates an expanded Codex Home directory before spawning codex', async () => {
    const ensuredDirectories: string[] = [];
    const spawnedEnvironments: Array<Record<string, string>> = [];
    const writtenFiles: Array<{ filePath: string; content: string }> = [];
    const service = createSessionService({
      keychain: {
        async readSecret() {
          return 'fake-codex-secret-that-must-not-be-written';
        },
        async writeSecret() {},
        async deleteSecret() {},
      },
      pty: {
        async spawn(request) {
          spawnedEnvironments.push(request.env);
          return {
            id: request.sessionId,
            write() {},
            resize() {},
            kill() {},
            onData() {
              return () => undefined;
            },
          };
        },
      },
      appDataPath: '/tmp/agentdock-test-data',
      homeDir: '/Users/example',
      ensureDirectory(directoryPath) {
        ensuredDirectories.push(directoryPath);
      },
      writeTextFile(filePath, content) {
        writtenFiles.push({ filePath, content });
      },
    });

    const session = await service.launch({
      profile: {
        id: 'codex-openai',
        name: 'Codex OpenAI',
        toolType: 'codex',
        baseUrl: 'https://openai.example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'codex-openai',
        codexHome: '~/.agentdock/codex-profiles/codex-openai',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'codex',
    });

    expect(session.status).toBe('running');
    expect(ensuredDirectories).toEqual([
      '/Users/example/.agentdock/codex-profiles/codex-openai',
    ]);
    expect(spawnedEnvironments[0]?.CODEX_HOME).toBe(
      '/Users/example/.agentdock/codex-profiles/codex-openai',
    );
    expect(writtenFiles).toEqual([
      {
        filePath: '/Users/example/.agentdock/codex-profiles/codex-openai/config.toml',
        content: [
          'model = "gpt-5-codex"',
          'model_provider = "agentdock"',
          '',
          '[model_providers.agentdock]',
          'name = "AgentDock"',
          'base_url = "https://openai.example.invalid/v1"',
          'wire_api = "responses"',
          'env_key = "OPENAI_API_KEY"',
          '',
          '[projects."/Users/example/Desktop/web/AgentDock"]',
          'trust_level = "trusted"',
          '',
        ].join('\n'),
      },
    ]);
    expect(writtenFiles[0]?.content).not.toContain('fake-codex-secret-that-must-not-be-written');
  });

  it('rejects terminal controls for unknown sessions without exposing env or secrets', async () => {
    const runtime = createTerminalRuntime();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });

    await expect(
      service.writeTerminal({ sessionId: 'missing-session', input: 'help\n' }),
    ).rejects.toThrow('未找到指定的终端会话');
    await expect(
      service.resizeTerminal({ sessionId: 'missing-session', cols: 80, rows: 24 }),
    ).rejects.toThrow('未找到指定的终端会话');
    await expect(
      service.killTerminal({ sessionId: 'missing-session' }),
    ).rejects.toThrow('未找到指定的终端会话');
  });
});

function fixedWorkspaceContext(): WorkspaceContextStore {
  return {
    async startSession() {
      return {
        contextDir: '/Users/example/Desktop/web/AgentDock/.agentdock/context',
        sharedContextFile: '/Users/example/Desktop/web/AgentDock/.agentdock/context/shared-context.md',
        sessionTranscriptFile: '/Users/example/Desktop/web/AgentDock/.agentdock/context/sessions/session-1.md',
      };
    },
    async appendOutput() {},
    async readSharedContext() {
      return { filePath: '', content: '' };
    },
    async ensureGitExcluded() {},
  };
}

describe('sessionService process exit handling', () => {
  it('marks the session as exited, notifies the terminal, and still allows closing the tab', async () => {
    const runtime = createTerminalRuntime();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });
    const outputEvents: Array<{ sessionId: string; data: string }> = [];
    service.onTerminalOutput((event) => outputEvents.push(event));

    const session = await launchTestSession(service);
    expect(session.status).toBe('running');

    runtime.emitExit({ exitCode: 0 });

    const [listed] = await service.list();
    expect(listed?.status).toBe('exited');
    expect(
      outputEvents.some(
        (event) => event.sessionId === session.id && event.data.includes('进程已退出'),
      ),
    ).toBe(true);
    await expect(service.readTerminalBuffer({ sessionId: session.id })).resolves.toContain(
      '进程已退出',
    );
    await expect(
      service.writeTerminal({ sessionId: session.id, input: 'ls\n' }),
    ).rejects.toThrow('未找到指定的终端会话');

    const closed = await service.killTerminal({ sessionId: session.id });
    expect(closed.status).toBe('stopped');
  });

  it('does not report an exit after the user already killed the terminal', async () => {
    const runtime = createTerminalRuntime();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
    });
    const outputEvents: Array<{ sessionId: string; data: string }> = [];
    service.onTerminalOutput((event) => outputEvents.push(event));

    const session = await launchTestSession(service);
    await service.killTerminal({ sessionId: session.id });
    runtime.emitExit({ exitCode: 0 });

    const [listed] = await service.list();
    expect(listed?.status).toBe('stopped');
    expect(outputEvents.some((event) => event.data.includes('进程已退出'))).toBe(false);
  });

  it('prefixes session ids with the injected window scope for cross-window uniqueness', async () => {
    const runtime = createTerminalRuntime();
    const service = createSessionService({
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
      sessionIdPrefix: 'w7-',
    });

    const session = await launchTestSession(service);
    expect(session.id).toBe('session-w7-1');
  });
});
