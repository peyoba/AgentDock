import { describe, expect, it } from 'vitest';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import {
  createEncryptedVaultAdapter,
  createVaultBackedSecretAdapter,
} from '../../src/main/adapters/secretVaultAdapter';

function createMemoryFiles() {
  const files = new Map<string, string>();

  return {
    files,
    async readTextFile(filePath: string): Promise<string> {
      const content = files.get(filePath);
      if (content === undefined) {
        const error = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return content;
    },
    async writeTextFile(filePath: string, content: string): Promise<void> {
      files.set(filePath, content);
    },
  };
}

function createMemoryVault(filePath = '/tmp/agentdock-test/secrets.vault.json') {
  const memory = createMemoryFiles();
  const adapter = createEncryptedVaultAdapter({
    filePath,
    keyMaterial: 'agentdock-test-key-material',
    ensureDirectory: async () => undefined,
    readTextFile: memory.readTextFile,
    writeTextFile: memory.writeTextFile,
  });

  return { ...memory, adapter, filePath };
}

describe('encrypted local secret vault', () => {
  it('saves and reads API keys without storing plaintext in the vault file', async () => {
    const { adapter, files, filePath } = createMemoryVault();
    const secret = 'test-local-vault-secret-value';

    await adapter.writeSecret('AgentDock', 'profile-a', secret);

    await expect(adapter.readSecret('AgentDock', 'profile-a')).resolves.toBe(secret);
    const vaultFile = files.get(filePath) ?? '';
    expect(vaultFile).not.toContain(secret);
    expect(vaultFile).not.toContain('test-local-vault-secret-value');
    expect(JSON.parse(vaultFile)).toMatchObject({
      version: 1,
      secrets: expect.any(Object),
    });
  });

  it('reports a user-facing missing API key error without mentioning Keychain', async () => {
    const { adapter } = createMemoryVault();

    await expect(adapter.readSecret('AgentDock', 'missing-profile')).rejects.toThrow(
      'API key was not found for account "missing-profile"',
    );
  });

  it('migrates a legacy Keychain secret into the local vault on first read only', async () => {
    const { adapter: vault, files, filePath } = createMemoryVault();
    const fallbackCalls: string[] = [];
    const fallback: KeychainAdapter = {
      async readSecret(service, account) {
        fallbackCalls.push(`read:${service}:${account}`);
        return 'test-legacy-keychain-secret';
      },
      async writeSecret(service, account) {
        fallbackCalls.push(`write:${service}:${account}`);
      },
      async deleteSecret(service, account) {
        fallbackCalls.push(`delete:${service}:${account}`);
      },
    };
    const adapter = createVaultBackedSecretAdapter({ vault, fallback });

    await expect(adapter.readSecret('AgentDock', 'profile-a')).resolves.toBe(
      'test-legacy-keychain-secret',
    );
    await expect(adapter.readSecret('AgentDock', 'profile-a')).resolves.toBe(
      'test-legacy-keychain-secret',
    );

    expect(fallbackCalls).toEqual(['read:AgentDock:profile-a']);
    expect(files.get(filePath)).not.toContain('test-legacy-keychain-secret');
  });

  it('writes new API keys only to the local vault and not to legacy Keychain fallback', async () => {
    const { adapter: vault } = createMemoryVault();
    const fallbackCalls: string[] = [];
    const fallback: KeychainAdapter = {
      async readSecret() {
        throw new Error('fallback read should not be needed');
      },
      async writeSecret(service, account) {
        fallbackCalls.push(`write:${service}:${account}`);
      },
      async deleteSecret(service, account) {
        fallbackCalls.push(`delete:${service}:${account}`);
      },
    };
    const adapter = createVaultBackedSecretAdapter({ vault, fallback });

    await adapter.writeSecret('AgentDock', 'profile-a', 'test-new-local-only-secret');

    await expect(adapter.readSecret('AgentDock', 'profile-a')).resolves.toBe(
      'test-new-local-only-secret',
    );
    expect(fallbackCalls).toEqual([]);
  });
});
