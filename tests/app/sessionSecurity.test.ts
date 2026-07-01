import { describe, expect, it } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter } from '../../src/main/adapters/ptyAdapter';

const secret = 'sk-test-secret-that-must-not-reach-renderer';

function createService() {
  const keychain: KeychainAdapter = {
    async readSecret() {
      return secret;
    },
    async writeSecret() {},
    async deleteSecret() {},
  };

  const pty: PtyAdapter = {
    async spawn() {
      return {
        id: 'pty-session-1',
        write() {},
        resize() {},
        kill() {},
        onData() {
          return () => {};
        },
      };
    },
  };

  return createSessionService({
    clock: { now: () => new Date('2026-07-01T00:00:00.000Z') },
    keychain,
    pty,
    appDataPath: '/tmp/agentdock-test-data',
  });
}

describe('sessionService security boundary', () => {
  it('does not return complete secrets or complete env snapshots to callers', async () => {
    const service = createService();

    const session = await service.launch({
      profile: {
        id: 'profile-a',
        name: 'Codex A',
        toolType: 'codex',
        baseUrl: 'https://openai.example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'codex-a',
      },
      workspace: {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
      command: 'codex',
    });

    const returnedPayload = JSON.stringify({ session, sessions: await service.list() });

    expect(returnedPayload).not.toContain(secret);
    expect(returnedPayload).not.toContain('OPENAI_API_KEY');
    expect(returnedPayload).not.toContain('OPENAI_BASE_URL');
    expect(returnedPayload).not.toContain('CODEX_HOME');
    expect(session).not.toHaveProperty('env');
    expect(session).not.toHaveProperty('secret');
  });
});
