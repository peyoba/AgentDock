import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { KeychainAdapter } from './keychainAdapter.js';
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  writePrivateFileAtomically,
} from '../privateFileSystem.js';

type VaultRecord = {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
};

type VaultFile = {
  version: 1;
  secrets: Record<string, VaultRecord>;
};

type EncryptedVaultAdapterOptions = {
  filePath: string;
  keyMaterial?: string;
  legacyKeyMaterials?: string[];
  ensureDirectory?: (directoryPath: string) => Promise<void> | void;
  readTextFile?: (filePath: string) => Promise<string>;
  writeTextFile?: (filePath: string, content: string) => Promise<void>;
};

type VaultBackedSecretAdapterOptions = {
  vault: KeychainAdapter;
  fallback: KeychainAdapter;
};

const EMPTY_VAULT: VaultFile = {
  version: 1,
  secrets: {},
};

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function vaultUsername(): string {
  try {
    return os.userInfo().username || 'unknown-user';
  } catch {
    return 'unknown-user';
  }
}

// v1 材料混入了 os.hostname() 和 vault 目录字符串：hostname 会随网络漂移
// （"设备名.local" ↔ 纯 IP），目录字符串会随应用名大小写变化，任何一个变了
// 旧记录就再也解不开。v2 只保留跨网络、跨打包环境稳定的分量。
function defaultKeyMaterial(): string {
  return ['AgentDock local encrypted vault v2', vaultUsername(), os.homedir()].join('\0');
}

// 仅用于解密 v2 之前写入的旧记录；命中后 readSecret 会用 v2 材料重加密回写。
function legacyKeyMaterialV1(filePath: string): string {
  return [
    'AgentDock local encrypted vault v1',
    vaultUsername(),
    os.homedir(),
    os.hostname(),
    path.dirname(filePath),
  ].join('\0');
}

function secretId(service: string, account: string): string {
  return crypto.createHash('sha256').update(`${service}\0${account}`).digest('base64url');
}

function missingSecretError(account: string): Error {
  return new Error(`API key was not found for account "${account}"`);
}

function isMissingSecretError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/API key was not found for account/.test(error.message) ||
      /Keychain secret was not found for account/.test(error.message))
  );
}

function deriveKey(keyMaterial: string, salt: Buffer): Buffer {
  return crypto.scryptSync(keyMaterial, salt, 32);
}

function encryptSecret(secret: string, keyMaterial: string): VaultRecord {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(keyMaterial, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    updatedAt: new Date().toISOString(),
  };
}

function unreadableSecretError(): Error {
  return new Error(`无法读取已保存的 API Key，请重新粘贴并保存一次以修复本机加密记录。`);
}

function tryDecryptSecret(record: VaultRecord, keyMaterial: string): string | null {
  try {
    const salt = Buffer.from(record.salt, 'base64');
    const iv = Buffer.from(record.iv, 'base64');
    const tag = Buffer.from(record.tag, 'base64');
    const ciphertext = Buffer.from(record.ciphertext, 'base64');
    const key = deriveKey(keyMaterial, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function parseVault(text: string): VaultFile {
  const parsed: unknown = JSON.parse(text);

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Partial<VaultFile>).version !== 1 ||
    typeof (parsed as Partial<VaultFile>).secrets !== 'object' ||
    !(parsed as Partial<VaultFile>).secrets
  ) {
    throw new Error('Invalid AgentDock local API key vault file');
  }

  return parsed as VaultFile;
}

async function defaultEnsureDirectory(directoryPath: string): Promise<void> {
  await ensurePrivateDirectory(directoryPath);
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  await ensurePrivateDirectory(path.dirname(filePath));
  await ensurePrivateFile(filePath);
  return readFile(filePath, 'utf8');
}

async function defaultWriteTextFile(filePath: string, content: string): Promise<void> {
  await writePrivateFileAtomically(filePath, content);
}

export function createEncryptedVaultAdapter({
  filePath,
  keyMaterial = defaultKeyMaterial(),
  legacyKeyMaterials = [legacyKeyMaterialV1(filePath)],
  ensureDirectory = defaultEnsureDirectory,
  readTextFile = defaultReadTextFile,
  writeTextFile = defaultWriteTextFile,
}: EncryptedVaultAdapterOptions): KeychainAdapter {
  // 所有 read-modify-write 操作必须串行，避免多窗口同时保存或迁移时互相覆盖。
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function enqueueMutation<Result>(operation: () => Promise<Result>): Promise<Result> {
    const runningOperation = mutationQueue.then(operation, operation);
    mutationQueue = runningOperation.catch(() => undefined);
    return runningOperation;
  }

  async function readVault(): Promise<VaultFile> {
    try {
      return parseVault(await readTextFile(filePath));
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return { ...EMPTY_VAULT, secrets: {} };
      }

      throw error;
    }
  }

  async function writeVault(vault: VaultFile): Promise<void> {
    await ensureDirectory(path.dirname(filePath));
    await writeTextFile(filePath, `${JSON.stringify(vault, null, 2)}\n`);
  }

  return {
    async readSecret(service: string, account: string): Promise<string> {
      const vault = await readVault();
      const id = secretId(service, account);
      const record = vault.secrets[id];
      if (!record) {
        throw missingSecretError(account);
      }

      const secret = tryDecryptSecret(record, keyMaterial);
      if (secret !== null) {
        return secret;
      }

      for (const legacyMaterial of legacyKeyMaterials) {
        const legacySecret = tryDecryptSecret(record, legacyMaterial);
        if (legacySecret !== null) {
          // 自愈：用当前稳定材料重加密回写，之后不再依赖 legacy 材料
          try {
            await enqueueMutation(async () => {
              const latestVault = await readVault();
              latestVault.secrets[id] = encryptSecret(legacySecret, keyMaterial);
              await writeVault(latestVault);
            });
          } catch (error) {
            console.warn('[secret-vault] 自愈回写失败（不影响本次读取）:', error);
          }
          return legacySecret;
        }
      }

      throw unreadableSecretError();
    },

    async writeSecret(service: string, account: string, secret: string): Promise<void> {
      await enqueueMutation(async () => {
        const vault = await readVault();
        vault.secrets[secretId(service, account)] = encryptSecret(secret, keyMaterial);
        await writeVault(vault);
      });
    },

    async deleteSecret(service: string, account: string): Promise<void> {
      await enqueueMutation(async () => {
        const vault = await readVault();
        delete vault.secrets[secretId(service, account)];
        await writeVault(vault);
      });
    },
  };
}

export function createVaultBackedSecretAdapter({
  vault,
  fallback,
}: VaultBackedSecretAdapterOptions): KeychainAdapter {
  return {
    async readSecret(service: string, account: string): Promise<string> {
      try {
        return await vault.readSecret(service, account);
      } catch (error) {
        if (!isMissingSecretError(error)) {
          throw error;
        }
      }

      try {
        const secret = await fallback.readSecret(service, account);
        await vault.writeSecret(service, account, secret);
        return secret;
      } catch (error) {
        if (isMissingSecretError(error)) {
          throw missingSecretError(account);
        }

        throw error;
      }
    },

    async writeSecret(service: string, account: string, secret: string): Promise<void> {
      await vault.writeSecret(service, account, secret);
    },

    async deleteSecret(service: string, account: string): Promise<void> {
      await vault.deleteSecret(service, account);
    },
  };
}
