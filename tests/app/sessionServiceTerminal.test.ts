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
