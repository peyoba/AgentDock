import { describe, expect, it, vi } from 'vitest';
import {
  checkForAppUpdate,
  isAllowedReleaseUrl,
  isNewerVersion,
  pickLatestRelease,
} from '../../src/main/updateCheckService';

const sampleAtom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.1.2</id>
    <link rel="alternate" type="text/html" href="https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.2"/>
    <title>AgentDock v0.1.2</title>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.1.0</id>
    <link rel="alternate" type="text/html" href="https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.0"/>
    <title>AgentDock v0.1.0</title>
  </entry>
</feed>`;

describe('updateCheckService', () => {
  it('compares semantic versions without treating older releases as updates', () => {
    expect(isNewerVersion('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false);
    expect(isNewerVersion('invalid', '0.1.0')).toBe(false);
  });

  it('prefers the highest non-draft release even when it is a pre-release', () => {
    const latest = pickLatestRelease([
      {
        tag_name: 'v0.1.0',
        draft: false,
        prerelease: false,
        html_url: 'https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.0',
        name: 'AgentDock v0.1.0',
      },
      {
        tag_name: 'v0.1.2',
        draft: false,
        prerelease: true,
        html_url: 'https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.2',
        name: 'AgentDock v0.1.2',
      },
      {
        tag_name: 'v0.1.1',
        draft: true,
        prerelease: true,
        html_url: 'https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.1',
        name: 'draft',
      },
    ]);

    expect(latest).toEqual({
      latestVersion: '0.1.2',
      releaseUrl: 'https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.2',
      releaseName: 'AgentDock v0.1.2',
    });
  });

  it('returns an available release from the public AgentDock releases Atom feed', async () => {
    const fetchRelease = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => sampleAtom,
    } as Response);

    await expect(checkForAppUpdate({ currentVersion: '0.1.0', fetchRelease })).resolves.toEqual({
      status: 'available',
      currentVersion: '0.1.0',
      latestVersion: '0.1.2',
      releaseName: 'AgentDock v0.1.2',
      releaseUrl: 'https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.2',
    });
    expect(fetchRelease).toHaveBeenCalledWith(
      'https://github.com/peyoba/AgentDock-Releases/releases.atom',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining('atom'),
        }),
      }),
    );
  });

  it('reports current when installed version already matches the newest pre-release', async () => {
    const fetchRelease = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => sampleAtom,
    } as Response);

    await expect(checkForAppUpdate({ currentVersion: '0.1.2', fetchRelease })).resolves.toEqual({
      status: 'current',
      currentVersion: '0.1.2',
      latestVersion: '0.1.2',
      releaseName: 'AgentDock v0.1.2',
      releaseUrl: 'https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.1.2',
    });
  });

  it('returns a safe error for network failures or untrusted release URLs', async () => {
    const untrustedResponse = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <link rel="alternate" href="https://example.invalid/malware"/>
    <title>v0.2.0</title>
  </entry>
</feed>`,
    } as Response);

    await expect(checkForAppUpdate({ currentVersion: '0.1.0', fetchRelease: untrustedResponse }))
      .resolves.toEqual({
        status: 'error',
        currentVersion: '0.1.0',
        message: '暂时无法检查更新，请稍后重试',
      });
    expect(isAllowedReleaseUrl('https://example.invalid/malware')).toBe(false);
  });
});
