import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('macOS window chrome behavior', () => {
  it('marks the custom title area as draggable while keeping controls clickable', () => {
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*-webkit-app-region:\s*drag/s);
    expect(styles).toMatch(/\.titlebar-spacer\s+(button|input|select)[^{]*\{[^}]*-webkit-app-region:\s*no-drag/s);
  });

  it('uses a custom titlebar aligned with macOS traffic lights on the same row', () => {
    const mainSource = readFileSync('src/main/main.ts', 'utf8');
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    expect(mainSource).toMatch(/titleBarStyle:\s*'hidden'/);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*padding:\s*0 8px 8px/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*padding:\s*0 18px 0 68px/s);
  });

  it('keeps the custom titlebar compact so the brand logo center matches traffic lights', () => {
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*height:\s*34px/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*min-height:\s*34px/s);
    expect(styles).toMatch(/\.titlebar-spacer\s+p\s*\{[^}]*display:\s*none/s);
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
