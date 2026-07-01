import { describe, expect, it } from 'vitest';
import { createUnavailableKeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import { createUnavailablePtyAdapter } from '../../src/main/adapters/ptyAdapter';

describe('adapter contracts', () => {
  it('fails fast when keychain adapter is unavailable', async () => {
    const adapter = createUnavailableKeychainAdapter();

    await expect(adapter.readSecret('AgentDock', 'profile-a')).rejects.toThrow(
      /Keychain adapter is not available/,
    );
  });

  it('fails fast when pty adapter is unavailable', async () => {
    const adapter = createUnavailablePtyAdapter();

    await expect(
      adapter.spawn({
        sessionId: 'session-a',
        command: 'claude',
        cwd: '/tmp',
        env: {},
      }),
    ).rejects.toThrow(/PTY adapter is not available/);
  });
});
