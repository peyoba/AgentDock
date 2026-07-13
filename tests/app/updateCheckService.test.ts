import { describe, expect, it, vi } from 'vitest';
import {
  checkForAppUpdate,
  isAllowedReleaseUrl,
  isNewerVersion,
} from '../../src/main/updateCheckService';

describe('updateCheckService', () => {
  it('compares semantic versions without treating older releases as updates', () => {
    expect(isNewerVersion('v0.2.0', '0.1.9')).toBe(true);
    expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.0.9', '0.1.0')).toBe(false);
    expect(isNewerVersion('invalid', '0.1.0')).toBe(false);
  });

  it('returns an available release from the public AgentDock releases repository', async () => {
    const fetchRelease = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.2.0',
    } as Response);

    await expect(checkForAppUpdate({ currentVersion: '0.1.0', fetchRelease })).resolves.toEqual({
      status: 'available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      releaseUrl: 'https://github.com/peyoba/AgentDock-Releases/releases/tag/v0.2.0',
    });
    expect(fetchRelease).toHaveBeenCalledWith(
      'https://github.com/peyoba/AgentDock-Releases/releases/latest',
      expect.objectContaining({ redirect: 'follow' }),
    );
  });

  it('returns a safe error for network failures or untrusted release URLs', async () => {
    const untrustedResponse = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.invalid/malware',
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
