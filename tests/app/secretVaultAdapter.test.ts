import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

async function readPosixMode(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
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
  it('creates private paths and heals legacy permissions without changing vault contents', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-vault-permissions-'));
    const vaultDirectoryPath = path.join(tempDir, 'private-vault');
    const vaultFilePath = path.join(vaultDirectoryPath, 'secrets.vault.json');
    const adapter = createEncryptedVaultAdapter({
      filePath: vaultFilePath,
      keyMaterial: 'agentdock-private-storage-test-material',
      legacyKeyMaterials: [],
    });

    try {
      await adapter.writeSecret('AgentDock', 'permission-profile', 'test-vault-secret-value');

      const newDirectoryMode = await readPosixMode(vaultDirectoryPath);
      const newFileMode = await readPosixMode(vaultFilePath);
      const encryptedContentsBeforeHealing = await readFile(vaultFilePath, 'utf-8');

      await chmod(vaultDirectoryPath, 0o755);
      await chmod(vaultFilePath, 0o644);
      await expect(adapter.readSecret('AgentDock', 'permission-profile')).resolves.toBe(
        'test-vault-secret-value',
      );

      expect({
        newDirectoryMode,
        newFileMode,
        healedDirectoryMode: await readPosixMode(vaultDirectoryPath),
        healedFileMode: await readPosixMode(vaultFilePath),
        contentsPreserved:
          (await readFile(vaultFilePath, 'utf-8')) === encryptedContentsBeforeHealing,
      }).toEqual({
        newDirectoryMode: 0o700,
        newFileMode: 0o600,
        healedDirectoryMode: 0o700,
        healedFileMode: 0o600,
        contentsPreserved: true,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

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

  it('reports a recoverable message when an existing vault entry cannot be decrypted', async () => {
    const memory = createMemoryFiles();
    const filePath = '/tmp/agentdock-test/secrets.vault.json';
    const writer = createEncryptedVaultAdapter({
      filePath,
      keyMaterial: 'old-key-material',
      ensureDirectory: async () => undefined,
      readTextFile: memory.readTextFile,
      writeTextFile: memory.writeTextFile,
    });
    const reader = createEncryptedVaultAdapter({
      filePath,
      keyMaterial: 'new-key-material',
      ensureDirectory: async () => undefined,
      readTextFile: memory.readTextFile,
      writeTextFile: memory.writeTextFile,
    });

    await writer.writeSecret('AgentDock', 'codex-custom-1', 'test-old-secret');

    await expect(reader.readSecret('AgentDock', 'codex-custom-1')).rejects.toThrow(
      '无法读取已保存的 API Key，请重新粘贴并保存一次以修复本机加密记录。',
    );
  });

  it('decrypts records written with a legacy key material and heals them to the current one', async () => {
    const memory = createMemoryFiles();
    const filePath = '/tmp/agentdock-test/secrets.vault.json';
    const writer = createEncryptedVaultAdapter({
      filePath,
      keyMaterial: 'legacy-host-bound-material',
      ensureDirectory: async () => undefined,
      readTextFile: memory.readTextFile,
      writeTextFile: memory.writeTextFile,
    });
    await writer.writeSecret('AgentDock', 'profile-a', 'test-migrated-secret');

    const reader = createEncryptedVaultAdapter({
      filePath,
      keyMaterial: 'stable-material-v2',
      legacyKeyMaterials: ['legacy-host-bound-material'],
      ensureDirectory: async () => undefined,
      readTextFile: memory.readTextFile,
      writeTextFile: memory.writeTextFile,
    });
    await expect(reader.readSecret('AgentDock', 'profile-a')).resolves.toBe(
      'test-migrated-secret',
    );

    // 自愈后：新 adapter 不带 legacy 材料也必须能读到同一条记录
    const healedReader = createEncryptedVaultAdapter({
      filePath,
      keyMaterial: 'stable-material-v2',
      legacyKeyMaterials: [],
      ensureDirectory: async () => undefined,
      readTextFile: memory.readTextFile,
      writeTextFile: memory.writeTextFile,
    });
    await expect(healedReader.readSecret('AgentDock', 'profile-a')).resolves.toBe(
      'test-migrated-secret',
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

  it('serializes concurrent writes so updates do not overwrite each other', async () => {
    const memory = createMemoryFiles();
    const firstWriteStarted = deferred();
    const allowFirstWrite = deferred();
    let writeCount = 0;
    const adapter = createEncryptedVaultAdapter({
      filePath: '/tmp/agentdock-test/secrets.vault.json',
      keyMaterial: 'agentdock-test-key-material',
      ensureDirectory: async () => undefined,
      readTextFile: memory.readTextFile,
      writeTextFile: async (filePath, content) => {
        writeCount += 1;
        if (writeCount === 1) {
          firstWriteStarted.resolve();
          await allowFirstWrite.promise;
        }
        await memory.writeTextFile(filePath, content);
      },
    });

    const firstWrite = adapter.writeSecret('AgentDock', 'profile-a', 'test-secret-a');
    await firstWriteStarted.promise;
    const secondWrite = adapter.writeSecret('AgentDock', 'profile-b', 'test-secret-b');
    allowFirstWrite.resolve();
    await Promise.all([firstWrite, secondWrite]);

    await expect(adapter.readSecret('AgentDock', 'profile-a')).resolves.toBe('test-secret-a');
    await expect(adapter.readSecret('AgentDock', 'profile-b')).resolves.toBe('test-secret-b');
  });

  it('orders delete operations after an in-flight write', async () => {
    const { adapter } = createMemoryVault();
    await adapter.writeSecret('AgentDock', 'profile-a', 'test-secret-a');

    await Promise.all([
      adapter.writeSecret('AgentDock', 'profile-b', 'test-secret-b'),
      adapter.deleteSecret('AgentDock', 'profile-a'),
    ]);

    await expect(adapter.readSecret('AgentDock', 'profile-a')).rejects.toThrow(
      'API key was not found',
    );
    await expect(adapter.readSecret('AgentDock', 'profile-b')).resolves.toBe('test-secret-b');
  });
});
