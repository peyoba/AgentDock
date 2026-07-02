import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Vite packaging configuration', () => {
  it('uses relative asset paths so packaged Electron file:// pages can load renderer bundles', () => {
    const configSource = readFileSync('vite.config.ts', 'utf8');

    expect(configSource).toContain("base: './'");
  });
});
