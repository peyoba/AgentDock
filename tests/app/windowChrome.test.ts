import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('macOS window chrome behavior', () => {
  it('marks the custom title area as draggable while keeping controls clickable', () => {
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*-webkit-app-region:\s*drag/s);
    expect(styles).toMatch(/\.titlebar-spacer\s+(button|input|select)[^{]*\{[^}]*-webkit-app-region:\s*no-drag/s);
  });

  it('lets the workbench fill the window while keeping app actions in the sidebar footer area', () => {
    const mainSource = readFileSync('src/main/main.ts', 'utf8');
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    expect(mainSource).toMatch(/titleBarStyle:\s*'hidden'/);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*padding:\s*0/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*position:\s*fixed/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*bottom:\s*12px/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*left:\s*16px/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*right:\s*auto/s);
    expect(styles).toMatch(/\.brand-lockup\s*\{[^}]*display:\s*none/s);
  });

  it('keeps the floating title actions compact', () => {
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*height:\s*40px/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*pointer-events:\s*none/s);
    expect(styles).toMatch(/\.header-actions\s*\{[^}]*pointer-events:\s*auto/s);
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
