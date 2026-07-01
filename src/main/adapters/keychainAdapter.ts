export type KeychainAdapter = {
  readSecret(service: string, account: string): Promise<string>;
  writeSecret(service: string, account: string, secret: string): Promise<void>;
  deleteSecret(service: string, account: string): Promise<void>;
};

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
