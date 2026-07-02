import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('main process secret storage wiring', () => {
  it('uses the local encrypted vault directly without automatic Keychain fallback prompts', () => {
    const mainSource = readFileSync('src/main/main.ts', 'utf8');

    expect(mainSource).toContain('createEncryptedVaultAdapter');
    expect(mainSource).toContain('secrets.vault.json');
    expect(mainSource).not.toContain('createKeytarAdapter');
    expect(mainSource).not.toContain('createVaultBackedSecretAdapter');
    expect(mainSource).not.toContain('const keychainAdapter = createKeytarAdapter();');
  });
});
