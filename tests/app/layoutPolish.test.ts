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

  it('renders running sessions as compact non-wrapping tabs', () => {
    const css = styles();

    expect(css).toMatch(/\.session-tabs\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.session-tab button\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.session-tab button\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });

  it('keeps the xterm scrollbar dark and pinned to the terminal edge', () => {
    const css = styles();

    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport\s*\{[^}]*right:\s*0/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport\s*\{[^}]*overflow-y:\s*scroll !important/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport\s*\{[^}]*scrollbar-gutter:\s*stable/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport\s*\{[^}]*scrollbar-color:\s*#4b5563 #07080c/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-viewport::-webkit-scrollbar\s*\{[^}]*width:\s*10px/s);
    expect(css).toMatch(/\.terminal-surface\s+\.xterm-screen\s*\{[^}]*padding-right:\s*14px/s);
  });

  it('uses a stable sidebar-and-editor layout for API configuration', () => {
    const css = styles();

    expect(css).toMatch(/\.api-config-layout\s*\{[^}]*grid-template-columns:\s*minmax\(280px,\s*420px\) minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.profile-card-grid\s*\{[^}]*align-content:\s*start/s);
  });
});
