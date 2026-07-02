import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type KeychainAdapter = {
  readSecret(service: string, account: string): Promise<string>;
  writeSecret(service: string, account: string, secret: string): Promise<void>;
  deleteSecret(service: string, account: string): Promise<void>;
};

export type KeytarLike = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

function loadKeytar(): KeytarLike {
  return require('keytar') as KeytarLike;
}

export function createKeytarAdapter(keytarModule: KeytarLike = loadKeytar()): KeychainAdapter {
  const secretCache = new Map<string, string>();
  const cacheKey = (service: string, account: string): string => `${service}\0${account}`;

  return {
    async readSecret(service: string, account: string): Promise<string> {
      const key = cacheKey(service, account);
      const cachedSecret = secretCache.get(key);
      if (cachedSecret) {
        return cachedSecret;
      }

      const secret = await keytarModule.getPassword(service, account);
      if (!secret) {
        throw new Error(`Keychain secret was not found for account "${account}"`);
      }
      secretCache.set(key, secret);
      return secret;
    },

    async writeSecret(service: string, account: string, secret: string): Promise<void> {
      await keytarModule.setPassword(service, account, secret);
      secretCache.set(cacheKey(service, account), secret);
    },

    async deleteSecret(service: string, account: string): Promise<void> {
      await keytarModule.deletePassword(service, account);
      secretCache.delete(cacheKey(service, account));
    },
  };
}

export function createUnavailableKeychainAdapter(): KeychainAdapter {
  const fail = async (): Promise<never> => {
    throw new Error('Keychain adapter is not available in Phase 1');
  };

  return {
    readSecret: fail,
    writeSecret: fail,
    deleteSecret: fail,
  };
}
