import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('macOS package script', () => {
  it('uses timestamped package output and does not use electron-packager overwrite', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
      optionalDependencies: Record<string, string>;
    };
    const script = readFileSync('scripts/package-mac.mjs', 'utf8');
    const support = readFileSync('scripts/package-support.mjs', 'utf8');

    expect(packageJson.scripts['package:mac']).toBe(
      'npm run build && node scripts/package-mac.mjs',
    );
    // 内嵌 statusline 二进制必须固定版本，且作为可选依赖以兼容非 darwin-arm64 环境
    expect(packageJson.optionalDependencies['@cometix/ccline-darwin-arm64']).toBe('1.1.2');
    expect(script).toContain('release/packages');
    expect(script).toContain('AGENTDOCK_PACKAGE_OUT');
    expect(support).toContain(
      "spawnSync('git', ['status', '--porcelain', '--untracked-files=all']",
    );
    expect(support.match(/if \(result\.error\)/g)).toHaveLength(3);
    expect(support).toContain('git rev-parse HEAD failed with exit code');
    expect(support).toContain('git status --porcelain failed with exit code');
    expect(script).toContain('codesign');
    expect(script).toContain('--no-install');
    expect(script).toContain('spawn-helper,ccline');
    expect(script).toContain('\\\\.agentdock');
    expect(script).toContain('\\\\.claude');
    expect(script).toContain('\\\\.pytest_cache');
    expect(script).toContain('\\\\.env');
    expect(script).toContain('\\\\.log');
    expect(script).toContain('AgentDock-v${version}-macos-arm64.zip');
    expect(script).toContain("run('ditto'");
    expect(script).toContain("from './package-support.mjs'");
    expect(script).not.toContain('--overwrite');
    expect(script).not.toContain("'package-lock.json',\n      'src',");
    expect(script).not.toContain('release/AgentDock-darwin-arm64/AgentDock.app');
  });
});
