import { describe, expect, it } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter } from '../../src/main/adapters/ptyAdapter';

function createTerminalRuntime() {
  const writes: string[] = [];
  const resizes: Array<{ cols: number; rows: number }> = [];
  let killed = false;
  const dataListeners = new Set<(data: string) => void>();

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
        },
        onData(listener) {
          dataListeners.add(listener);
          return () => dataListeners.delete(listener);
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
    emit(data: string) {
      for (const listener of dataListeners) {
        listener(data);
      }
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
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
      keychain: runtime.keychain,
      pty: runtime.pty,
      appDataPath: '/tmp/agentdock-test-data',
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
    expect(await service.list()).toEqual([{ ...session, status: 'stopped' }]);
    expect(outputEvents).toEqual([
      { sessionId: session.id, data: 'hello from fake pty' },
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



  it('launches a local zsh shell without reading API secrets', async () => {
    let readSecretCalled = false;
    const spawnedCommands: string[] = [];
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
      command: 'zsh',
    });

    expect(readSecretCalled).toBe(false);
    expect(spawnedCommands).toEqual(['zsh']);
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
    ).rejects.toThrow('Terminal session was not found');
    await expect(
      service.resizeTerminal({ sessionId: 'missing-session', cols: 80, rows: 24 }),
    ).rejects.toThrow('Terminal session was not found');
    await expect(
      service.killTerminal({ sessionId: 'missing-session' }),
    ).rejects.toThrow('Terminal session was not found');
  });
});
