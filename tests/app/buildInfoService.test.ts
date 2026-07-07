import { describe, expect, it } from 'vitest';
import { resolveAppBuildInfo } from '../../src/main/buildInfoService';

describe('resolveAppBuildInfo', () => {
  it('reads packaged build metadata from Resources/build-info.json', () => {
    const info = resolveAppBuildInfo({
      appVersion: '0.1.0',
      resourcesPath: '/Applications/AgentDock.app/Contents/Resources',
      now: () => new Date('2026-07-08T06:20:00.000Z'),
      readTextFile: (filePath) => {
        expect(filePath).toBe('/Applications/AgentDock.app/Contents/Resources/build-info.json');
        return JSON.stringify({
          version: '0.2.0',
          buildId: '20260708-061530',
          buildTime: '2026-07-08T06:15:30.000Z',
          commit: '01d1331abcdef',
          dirty: false,
        });
      },
      readGitCommit: () => 'fallbackcommit',
      isGitDirty: () => true,
    });

    expect(info).toEqual({
      version: '0.2.0',
      buildId: '20260708-061530',
      buildTime: '2026-07-08T06:15:30.000Z',
      commit: '01d1331abcdef',
      commitShort: '01d1331',
      dirty: false,
    });
  });

  it('falls back to runtime metadata when packaged build metadata is absent', () => {
    const info = resolveAppBuildInfo({
      appVersion: '0.1.0',
      resourcesPath: '/tmp/electron-dev-resources',
      now: () => new Date('2026-07-08T06:30:00.000Z'),
      readTextFile: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      readGitCommit: () => 'abcdef1234567890',
      isGitDirty: () => true,
    });

    expect(info).toEqual({
      version: '0.1.0',
      buildId: 'dev',
      buildTime: '2026-07-08T06:30:00.000Z',
      commit: 'abcdef1234567890',
      commitShort: 'abcdef1',
      dirty: true,
    });
  });
});

