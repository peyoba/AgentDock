import { describe, expect, it } from 'vitest';
import type { CclineFileStats } from '../../src/main/cclineLocator';
import { resolveCclineCommand } from '../../src/main/cclineLocator';

function statsFor(
  files: Record<string, CclineFileStats>,
): (filePath: string) => CclineFileStats | undefined {
  return (filePath) => files[filePath];
}

const EXECUTABLE: CclineFileStats = { isFile: true, isExecutable: true };

describe('cclineLocator', () => {
  it('prefers a user-installed ccline over the bundled binary', () => {
    const command = resolveCclineCommand({
      homeDir: '/Users/example',
      envPath: '/opt/homebrew/bin',
      bundledPackageRoot: '/app/node_modules/@cometix/ccline-darwin-arm64',
      fileStats: statsFor({
        '/Users/example/.npm-global/bin/ccline': EXECUTABLE,
        '/app/node_modules/@cometix/ccline-darwin-arm64/ccline': EXECUTABLE,
      }),
    });

    expect(command).toBe('/Users/example/.npm-global/bin/ccline');
  });

  it('searches env PATH entries when user-level directories miss', () => {
    const command = resolveCclineCommand({
      homeDir: '/Users/example',
      envPath: ['/custom/tools/bin', '/opt/homebrew/bin'].join(':'),
      bundledPackageRoot: '/app/node_modules/@cometix/ccline-darwin-arm64',
      fileStats: statsFor({
        '/custom/tools/bin/ccline': EXECUTABLE,
      }),
    });

    expect(command).toBe('/custom/tools/bin/ccline');
  });

  it('falls back to the bundled binary and rewrites the asar path to the unpacked location', () => {
    const command = resolveCclineCommand({
      homeDir: '/Users/example',
      envPath: '/opt/homebrew/bin',
      bundledPackageRoot:
        '/Applications/AgentDock.app/Contents/Resources/app.asar/node_modules/@cometix/ccline-darwin-arm64',
      fileStats: statsFor({
        '/Applications/AgentDock.app/Contents/Resources/app.asar.unpacked/node_modules/@cometix/ccline-darwin-arm64/ccline':
          EXECUTABLE,
      }),
    });

    expect(command).toBe(
      '/Applications/AgentDock.app/Contents/Resources/app.asar.unpacked/node_modules/@cometix/ccline-darwin-arm64/ccline',
    );
  });

  it('restores the executable bit when the bundled binary lost it', () => {
    const chmodCalls: string[] = [];
    const bundledBinary = '/app/node_modules/@cometix/ccline-darwin-arm64/ccline';
    const command = resolveCclineCommand({
      homeDir: '/Users/example',
      envPath: '',
      bundledPackageRoot: '/app/node_modules/@cometix/ccline-darwin-arm64',
      fileStats: statsFor({
        [bundledBinary]: { isFile: true, isExecutable: false },
      }),
      makeExecutable(filePath) {
        chmodCalls.push(filePath);
      },
    });

    expect(command).toBe(bundledBinary);
    expect(chmodCalls).toEqual([bundledBinary]);
  });

  it('returns the bare command when neither an installed nor a bundled binary exists', () => {
    const command = resolveCclineCommand({
      homeDir: '/Users/example',
      envPath: '/opt/homebrew/bin',
      bundledPackageRoot: undefined,
      fileStats: statsFor({}),
    });

    expect(command).toBe('ccline');
  });

  it('ignores non-executable PATH entries such as plain files', () => {
    const command = resolveCclineCommand({
      homeDir: '/Users/example',
      envPath: '/custom/tools/bin',
      bundledPackageRoot: '/app/node_modules/@cometix/ccline-darwin-arm64',
      fileStats: statsFor({
        '/custom/tools/bin/ccline': { isFile: true, isExecutable: false },
        '/app/node_modules/@cometix/ccline-darwin-arm64/ccline': EXECUTABLE,
      }),
    });

    expect(command).toBe('/app/node_modules/@cometix/ccline-darwin-arm64/ccline');
  });
});
