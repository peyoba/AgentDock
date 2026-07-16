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

    expect(mainSource).toMatch(
      /\.\.\.\(process\.platform === 'darwin' \? \{ titleBarStyle: 'hidden' \} : \{\}\)/,
    );
    expect(mainSource).not.toMatch(/^\s*titleBarStyle:\s*'hidden',/m);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*padding:\s*34px 0 0/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*position:\s*fixed/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*top:\s*0/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*left:\s*0/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*right:\s*0/s);
    expect(styles).toMatch(/\.brand-lockup\s*\{[^}]*display:\s*none/s);
  });

  it('keeps the top drag strip compact and mouse-hit-testable', () => {
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*height:\s*34px/s);
    expect(styles).toMatch(/\.titlebar-spacer\s*\{[^}]*min-height:\s*34px/s);
    expect(styles).not.toMatch(/\.titlebar-spacer\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('keeps the BrowserWindow explicitly resizable with compact minimum dimensions', () => {
    const mainSource = readFileSync('src/main/main.ts', 'utf8');
    const minWidth = Number(mainSource.match(/minWidth:\s*(\d+)/)?.[1]);
    const minHeight = Number(mainSource.match(/minHeight:\s*(\d+)/)?.[1]);

    expect(mainSource).toMatch(/resizable:\s*true/);
    expect(minWidth).toBeLessThanOrEqual(720);
    expect(minHeight).toBeLessThanOrEqual(480);
  });

  it('locks the app shell to the viewport so chrome never scrolls out of view', () => {
    const styles = readFileSync('src/renderer/styles.css', 'utf8');

    // 整页一旦可滚动，命令栏会被推出视野、内容会顶进红绿灯区域。
    expect(styles).toMatch(/body\s*\{[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*height:\s*100vh/s);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*overflow:\s*hidden/s);
    // 接口配置页和会话库列表改为内部滚动区。
    expect(styles).toMatch(/\.settings-page\s*\{[^}]*overflow-y:\s*auto/s);
    expect(styles).toMatch(/\.session-library-list\s*\{[^}]*overflow-y:\s*auto/s);
  });
});
