import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('preload packaging', () => {
  it('builds preload as CommonJS so packaged Electron exposes window.agentDock', () => {
    expect(existsSync('src/preload/preload.cts')).toBe(true);
    expect(readFileSync('src/main/main.ts', 'utf8')).toContain('../preload/preload.cjs');
  });
});
