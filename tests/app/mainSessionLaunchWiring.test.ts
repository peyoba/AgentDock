import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('main session restart wiring', () => {
  it('uses the same resolved restart command for validation, mode normalization and service restart', () => {
    const source = readFileSync('src/main/main.ts', 'utf8');
    const restartHandler = source.match(
      /ipcMain\.handle\('sessions:restart',[\s\S]*?(?=\n\s*ipcMain\.handle\('windows:new')/,
    )?.[0];

    expect(restartHandler).toBeDefined();
    expect(restartHandler).toMatch(/validateSessionCommand\(restartCommand\)/);
    expect(restartHandler).toMatch(
      /normalizedLaunchModes\(\s*profile,\s*restartCommand,\s*request\.claudeLaunchMode,\s*request\.codexLaunchMode,?\s*\)/,
    );
    expect(restartHandler).toMatch(
      /const restartInput\s*=\s*\{[\s\S]*?command:\s*restartCommand\s*,[\s\S]*?\};/,
    );
  });
});
