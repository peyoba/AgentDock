import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('layout polish styles', () => {
  const styles = () => readFileSync('src/renderer/styles.css', 'utf8');

  it('uses a compact responsive command bar with a consistently styled path picker', () => {
    const css = styles();

    expect(css).toMatch(/\.command-bar\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.launch-button\s*\{[^}]*min-width:\s*150px/s);
    expect(css).toMatch(/\.workspace-path-button\s*\{[^}]*border:\s*1px solid #d1d5db/s);
  });

  it('renders running sessions as compact non-wrapping tabs', () => {
    const css = styles();

    expect(css).toMatch(/\.session-tabs\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.session-tab button\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.session-tab button\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });

  it('uses a stable sidebar-and-editor layout for API configuration', () => {
    const css = styles();

    expect(css).toMatch(/\.api-config-layout\s*\{[^}]*grid-template-columns:\s*minmax\(280px,\s*420px\) minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.profile-card-grid\s*\{[^}]*align-content:\s*start/s);
  });
});
