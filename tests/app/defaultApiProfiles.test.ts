import { describe, expect, it } from 'vitest';
import { defaultApiProfiles, isDefaultApiProfileId } from '../../src/shared/defaultApiProfiles';

describe('default API profiles', () => {
  it('starts with dangerous permissions enabled and no prefilled alternate model list', () => {
    expect(defaultApiProfiles.length).toBeGreaterThan(0);

    const claudeProfile = defaultApiProfiles.find((profile) => profile.toolType === 'claude');
    const codexProfile = defaultApiProfiles.find((profile) => profile.toolType === 'codex');

    expect(claudeProfile?.skipPermissions).toBe(true);
    expect(claudeProfile?.defaultModel).toBe('claude-fable-5');
    expect(claudeProfile?.defaultModel).not.toBe('opus[1m]');
    expect(claudeProfile?.claudeCodeRetryWatchdog).toBe(true);
    expect(claudeProfile?.claudeCodeMaxRetries).toBe(100);
    expect(claudeProfile?.anthropicBetas).toBe('context-1m-2025-08-07');
    expect(claudeProfile?.httpProxy).toBe('http://127.0.0.1:7897');
    expect(claudeProfile?.httpsProxy).toBe('http://127.0.0.1:7897');
    expect(claudeProfile?.claudeCodeDisableNonessentialTraffic).toBe(true);
    expect(claudeProfile?.claudeCodeAttributionHeader).toBe('0');
    expect(claudeProfile?.disableInstallationChecks).toBe(true);
    expect(claudeProfile?.claudeCleanupPeriodDays).toBe(720);
    expect(codexProfile?.bypassApprovals).toBe(true);
    for (const profile of defaultApiProfiles) {
      expect(profile.defaultModel).toBeTruthy();
      expect(profile.availableModels).toBeUndefined();
    }
  });

  it('marks bundled profile ids as protected defaults', () => {
    expect(isDefaultApiProfileId('claude-anyrouter')).toBe(true);
    expect(isDefaultApiProfileId('codex-openai')).toBe(true);
    expect(isDefaultApiProfileId('claude-custom-1')).toBe(false);
  });
});
