import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Windows package script', () => {
  it('builds a timestamped win32 x64 portable zip without new dependencies', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      version: string;
      scripts: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      version: string;
      packages: { '': { version: string } };
    };
    const script = readFileSync('scripts/package-win.mjs', 'utf8');
    const preload = readFileSync('src/preload/preload.cts', 'utf8');
    const app = readFileSync('src/renderer/App.tsx', 'utf8');

    expect(packageJson.version).toBe('0.1.1');
    expect(lock.version).toBe('0.1.1');
    expect(lock.packages[''].version).toBe('0.1.1');
    expect(packageJson.scripts['package:win']).toBe(
      'npm run build && node scripts/package-win.mjs',
    );
    expect(script).toContain("'--platform=win32'");
    expect(script).toContain("'--arch=x64'");
    expect(script).toContain('*.node,*.exe');
    expect(script).toContain('@cometix/ccline-darwin-arm64');
    expect(script).toContain('AgentDock-v${version}-windows-x64.zip');
    expect(script).toContain('prebuilds/win32-x64');
    expect(preload).toContain("version: '0.1.1'");
    expect(app).toContain("version: '0.1.1'");
  });
});
