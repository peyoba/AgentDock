import { describe, expect, it } from 'vitest';

describe('package-mac build info', () => {
  it('creates package build metadata with the package timestamp as build id', async () => {
    const { createBuildInfo } = await import('../../scripts/package-mac.mjs');

    expect(createBuildInfo({
      version: '0.2.0',
      buildId: '20260708-061530',
      buildTime: new Date('2026-07-08T06:15:30.000Z'),
      commit: '01d1331abcdef',
      dirty: true,
    })).toEqual({
      version: '0.2.0',
      buildId: '20260708-061530',
      buildTime: '2026-07-08T06:15:30.000Z',
      commit: '01d1331abcdef',
      commitShort: '01d1331',
      dirty: true,
    });
  });
});
