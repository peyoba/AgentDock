import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('layout polish styles', () => {
  const styles = () => readFileSync('src/renderer/styles.css', 'utf8');

  it('uses a compact responsive command bar with a consistently styled path picker', () => {
    const css = styles();

    expect(css).toMatch(/\.command-bar\s*\{[^}]*display:\s*block/s);
    expect(css).toMatch(/\.command-fields\s*\{[^}]*grid-template-columns:\s*minmax\(180px,\s*1fr\) minmax\(240px,\s*1\.2fr\) auto minmax\(132px,\s*auto\)/s);
    expect(css).toMatch(/\.launch-button\s*\{[^}]*min-width:\s*132px/s);
    expect(css).toMatch(/\.local-shell-button\s*\{[^}]*border:\s*1px solid #d1d5db/s);
    expect(css).not.toMatch(/\.workspace-path-button\s*\{/);
  });

  it('lets the terminal use full width unless the details drawer is open', () => {
    const css = styles();

    expect(css).toMatch(/\.workspace-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.workspace-grid\.details-open\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(260px,\s*316px\)/s);
  });

  it('keeps the project panel collapsed by default and protects terminal width', () => {
    const css = styles();

    expect(css).toMatch(/\.workbench-layout\s*\{[^}]*--project-panel-width:\s*360px/s);
    expect(css).toMatch(/\.workbench-layout\s*\{[^}]*grid-template-columns:\s*var\(--session-library-width\) 6px minmax\(0,\s*1fr\) 32px/s);
    expect(css).toMatch(/\.workbench-layout\.project-open\s*\{[^}]*grid-template-columns:[^}]*var\(--session-library-width\)[^}]*6px[^}]*minmax\(0,\s*1fr\)[^}]*10px[^}]*minmax\(260px,\s*var\(--project-panel-width\)\)/s);
    expect(css).toMatch(/\.session-library-resizer,[^}]*\.project-panel-resizer\s*\{[^}]*cursor:\s*col-resize/s);
    expect(css).toMatch(/\.project-panel-resizer\s*\{[^}]*cursor:\s*col-resize/s);
    expect(css).toMatch(/\.project-panel-rail\s*\{[^}]*border-radius:\s*8px/s);
    expect(css).toMatch(/\.project-panel-rail\s*\{[^}]*letter-spacing:\s*1px/s);
    expect(css).toMatch(/\.project-panel\.collapsed\s*\{/);
  });

  it('keeps the claude launch mode column sized to its content so the labels stay readable', () => {
    const css = styles();

    // 启动模式列曾被压缩截断成"空 MC"；列宽必须跟随内容，不参与收缩。
    expect(css).toMatch(/\.command-fields\.with-claude-mode\s*\{[^}]*grid-template-columns:[^}]*auto\s*\n\s*auto/s);
    expect(css).toMatch(/\.command-bar select\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });

  it('hides the native xterm scrollbar and styles the overlay scrollbar like macOS', () => {
    const css = styles();

    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport\s*\{[^}]*right:\s*0/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport\s*\{[^}]*overflow-y:\s*scroll !important/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport\s*\{[^}]*scrollbar-width:\s*none/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport::-webkit-scrollbar\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.terminal-drag-scrollbar\s*\{[^}]*opacity:\s*0/s);
    expect(css).toMatch(/\.terminal-drag-scrollbar\.is-active[^{]*\{[^}]*opacity:\s*1/s);
    expect(css).toMatch(/\.terminal-drag-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px/s);
    expect(css).toMatch(/\.terminal-drag-scrollbar-thumb\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.32\)/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-screen\s*\{[^}]*padding-right:\s*14px/s);
  });

  it('uses a stable sidebar-and-editor layout for API configuration', () => {
    const css = styles();

    expect(css).toMatch(/\.api-config-layout\s*\{[^}]*grid-template-columns:\s*minmax\(280px,\s*420px\) minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.profile-card-grid\s*\{[^}]*align-content:\s*start/s);
  });
});
