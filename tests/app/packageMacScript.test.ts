import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('macOS package script', () => {
  it('uses timestamped package output and does not use electron-packager overwrite', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    const script = readFileSync('scripts/package-mac.mjs', 'utf8');

    expect(packageJson.scripts['package:mac']).toBe(
      'npm run build && node scripts/package-mac.mjs',
    );
    expect(script).toContain('release/packages');
    expect(script).toContain('AGENTDOCK_PACKAGE_OUT');
    expect(script).toContain('codesign');
    expect(script).toContain('--no-install');
    expect(script).toContain('\\\\.agentdock');
    expect(script).toContain('\\\\.claude');
    expect(script).toContain('\\\\.pytest_cache');
    expect(script).toContain('\\\\.env');
    expect(script).toContain('\\\\.log');
    expect(script).not.toContain('--overwrite');
    expect(script).not.toContain('release/AgentDock-darwin-arm64/AgentDock.app');
  });
});
