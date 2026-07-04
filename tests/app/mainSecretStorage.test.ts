import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('main process secret storage wiring', () => {
  const mainSource = readFileSync('src/main/main.ts', 'utf8');

  it('keeps the local encrypted vault as the primary secret store', () => {
    expect(mainSource).toContain('createEncryptedVaultAdapter');
    expect(mainSource).toContain('secrets.vault.json');
  });

  it('migrates legacy Keychain secrets through the vault-backed adapter on read miss', () => {
    expect(mainSource).toContain('createVaultBackedSecretAdapter');
    expect(mainSource).toContain('fallback: createKeytarAdapter()');
  });

  it('falls back to the plain vault when the keytar native module is unavailable', () => {
    const wiring = mainSource.slice(
      mainSource.indexOf('function createSecretAdapter'),
      mainSource.indexOf('const secretAdapter'),
    );
    expect(wiring).toContain('try {');
    expect(wiring).toContain('return vault;');
  });
});
