import crypto from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { KeychainAdapter } from './keychainAdapter.js';

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

function defaultKeyMaterial(filePath: string): string {
  let username = 'unknown-user';
  try {
    username = os.userInfo().username || username;
  } catch {
    username = 'unknown-user';
  }

  return [
    'AgentDock local encrypted vault v1',
    username,
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

function decryptSecret(record: VaultRecord, keyMaterial: string, account: string): string {
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
    throw new Error(`Unable to decrypt local API key vault entry for account "${account}"`);
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
  await mkdir(directoryPath, { recursive: true });
}

async function defaultReadTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

async function defaultWriteTextFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(filePath, 0o600);
}

export function createEncryptedVaultAdapter({
  filePath,
  keyMaterial = defaultKeyMaterial(filePath),
  ensureDirectory = defaultEnsureDirectory,
  readTextFile = defaultReadTextFile,
  writeTextFile = defaultWriteTextFile,
}: EncryptedVaultAdapterOptions): KeychainAdapter {
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
      const record = vault.secrets[secretId(service, account)];
      if (!record) {
        throw missingSecretError(account);
      }

      return decryptSecret(record, keyMaterial, account);
    },

    async writeSecret(service: string, account: string, secret: string): Promise<void> {
      const vault = await readVault();
      vault.secrets[secretId(service, account)] = encryptSecret(secret, keyMaterial);
      await writeVault(vault);
    },

    async deleteSecret(service: string, account: string): Promise<void> {
      const vault = await readVault();
      delete vault.secrets[secretId(service, account)];
      await writeVault(vault);
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
