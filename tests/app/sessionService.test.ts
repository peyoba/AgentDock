import { describe, expect, it } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter, PtySpawnRequest } from '../../src/main/adapters/ptyAdapter';

function createFakeRuntime() {
  const spawnRequests: PtySpawnRequest[] = [];

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
        write() {},
        resize() {},
        kill() {},
      };
    },
  };

  return { keychain, pty, spawnRequests };
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
});
