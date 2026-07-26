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

    // 版本号不硬编码：以 package.json 为准，断言其余三处与之一致，
    // 这样每次 bump 只改 package.json，测试仍守住「四处版本同步」的契约。
    const version = packageJson.version;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
    expect(packageJson.scripts['package:win']).toBe(
      'npm run build && node scripts/package-win.mjs',
    );
    expect(script).toContain("'--platform=win32'");
    expect(script).toContain("'--arch=x64'");
    expect(script).toContain('*.node,*.exe');
    expect(script).toContain('@cometix/ccline-darwin-arm64');
    expect(script).toContain('AgentDock-v${version}-windows-x64.zip');
    expect(script).toContain('prebuilds/win32-x64');
    expect(preload).toContain(`version: '${version}'`);
    expect(app).toContain(`version: '${version}'`);
  });
});
