import { describe, expect, it, vi } from 'vitest';
import { createSessionService } from '../../src/main/sessionService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { PtyAdapter } from '../../src/main/adapters/ptyAdapter';

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
  path: '/missing/workspace',
};

describe('sessionService launch failure safety', () => {
  it('rejects missing workspaces before reading secrets', async () => {
    const readSecret = vi.fn();
    const service = createSessionService({
      keychain: {
        readSecret,
        async writeSecret() {},
        async deleteSecret() {},
      } as KeychainAdapter,
      pty: {
        async spawn() {
          throw new Error('should not spawn');
        },
      } as PtyAdapter,
      appDataPath: '/tmp/agentdock-test-data',
      workspaceExists: () => false,
    });

    await expect(
      service.launch({ profile, workspace, command: 'claude' }),
    ).rejects.toThrow('Workspace path is not available');

    expect(readSecret).not.toHaveBeenCalled();
    expect(await service.list()).toEqual([]);
  });

  it('marks the session failed and throws a safe error when PTY spawn fails', async () => {
    const secret = 'agentdock-secret-must-not-leak';
    const service = createSessionService({
      clock: { now: () => new Date('2026-07-02T00:00:00.000Z') },
      keychain: {
        async readSecret() {
          return secret;
        },
        async writeSecret() {},
        async deleteSecret() {},
      },
      pty: {
        async spawn() {
          throw new Error(`spawn failed with ${secret} and ANTHROPIC_AUTH_TOKEN`);
        },
      },
      appDataPath: '/tmp/agentdock-test-data',
      workspaceExists: () => true,
    });

    await expect(
      service.launch({ profile, workspace: { ...workspace, path: '/tmp' }, command: 'claude' }),
    ).rejects.toThrow('Failed to launch terminal command "claude"');

    const sessions = await service.list();
    expect(sessions).toEqual([
      {
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'failed',
        startedAt: '2026-07-02T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(sessions)).not.toContain(secret);
    await expect(
      service.writeTerminal({ sessionId: 'session-1', input: 'help\n' }),
    ).rejects.toThrow('Terminal session was not found');
  });

  it('rethrows missing local API key errors so the UI can tell users to save a key', async () => {
    const service = createSessionService({
      keychain: {
        async readSecret() {
          throw new Error('API key was not found for account "profile-a"');
        },
        async writeSecret() {},
        async deleteSecret() {},
      },
      pty: {
        async spawn() {
          throw new Error('should not spawn without an API key');
        },
      },
      appDataPath: '/tmp/agentdock-test-data',
      workspaceExists: () => true,
    });

    await expect(
      service.launch({ profile, workspace: { ...workspace, path: '/tmp' }, command: 'claude' }),
    ).rejects.toThrow('API key was not found for account "profile-a"');
  });
});
