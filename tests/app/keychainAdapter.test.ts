import { describe, expect, it } from 'vitest';
import { createKeytarAdapter } from '../../src/main/adapters/keychainAdapter';

describe('createKeytarAdapter', () => {
  it('delegates write, read, and delete to a keytar-compatible module', async () => {
    const calls: string[] = [];
    const adapter = createKeytarAdapter({
      async getPassword(service, account) {
        calls.push(`get:${service}:${account}`);
        return 'test-secret-value';
      },
      async setPassword(service, account, secret) {
        calls.push(`set:${service}:${account}:${secret}`);
      },
      async deletePassword(service, account) {
        calls.push(`delete:${service}:${account}`);
        return true;
      },
    });

    await adapter.writeSecret('AgentDock Test', 'profile-a', 'test-secret-value');
    await expect(adapter.readSecret('AgentDock Test', 'profile-a')).resolves.toBe(
      'test-secret-value',
    );
    await adapter.deleteSecret('AgentDock Test', 'profile-a');

    expect(calls).toEqual([
      'set:AgentDock Test:profile-a:test-secret-value',
      'get:AgentDock Test:profile-a',
      'delete:AgentDock Test:profile-a',
    ]);
  });

  it('fails safely when the secret is missing', async () => {
    const adapter = createKeytarAdapter({
      async getPassword() {
        return null;
      },
      async setPassword() {},
      async deletePassword() {
        return false;
      },
    });

    await expect(adapter.readSecret('AgentDock Test', 'missing')).rejects.toThrow(
      'Keychain secret was not found for account "missing"',
    );
  });
});
