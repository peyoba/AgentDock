import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('macOS window chrome behavior', () => {
  it('marks the custom title area as draggable while keeping controls clickable', () => {
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*-webkit-app-region:\s*drag/s);
    expect(styles).toMatch(/\.titlebar-spacer\s+(button|input|select)[^{]*\{[^}]*-webkit-app-region:\s*no-drag/s);
  });

  it('keeps the BrowserWindow explicitly resizable with compact minimum dimensions', () => {
    const mainSource = readFileSync('src/main/main.ts', 'utf8');
    const minWidth = Number(mainSource.match(/minWidth:\s*(\d+)/)?.[1]);
    const minHeight = Number(mainSource.match(/minHeight:\s*(\d+)/)?.[1]);

    expect(mainSource).toMatch(/resizable:\s*true/);
    expect(minWidth).toBeLessThanOrEqual(720);
    expect(minHeight).toBeLessThanOrEqual(480);
  });
});
