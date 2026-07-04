import { describe, expect, it } from 'vitest';
import { defaultApiProfiles, isDefaultApiProfileId } from '../../src/shared/defaultApiProfiles';

describe('default API profiles', () => {
  it('starts Claude AnyRouter with explicit Claude model mapping defaults', () => {
    expect(defaultApiProfiles.length).toBeGreaterThan(0);

    const claudeProfile = defaultApiProfiles.find((profile) => profile.toolType === 'claude');
    const codexProfile = defaultApiProfiles.find((profile) => profile.toolType === 'codex');

    expect(claudeProfile?.skipPermissions).toBe(true);
    expect(claudeProfile?.defaultModel).toBe('claude-opus-4-8');
    expect(claudeProfile?.defaultModel).not.toBe('opus[1m]');
    expect(claudeProfile?.claudeHaikuModel).toBe('claude-haiku-4-5-20251001');
    expect(claudeProfile?.claudeSonnetModel).toBe('claude-fable-5');
    expect(claudeProfile?.claudeOpusModel).toBe('claude-opus-4-8');
    expect(claudeProfile?.claudeDefaultLaunchMode).toBe('default');
    expect(claudeProfile?.claudeCodeRetryWatchdog).toBe(true);
    expect(claudeProfile?.claudeCodeMaxRetries).toBe(100);
    expect(claudeProfile?.anthropicBetas).toBe('context-1m-2025-08-07');
    expect(claudeProfile?.claudeCodeDisableNonessentialTraffic).toBe(true);
    expect(claudeProfile?.claudeCodeAttributionHeader).toBe('0');
    expect(claudeProfile?.disableInstallationChecks).toBe(true);
    expect(claudeProfile?.claudeCleanupPeriodDays).toBe(720);
    expect(codexProfile?.bypassApprovals).toBe(true);
    for (const profile of defaultApiProfiles) {
      expect(profile.defaultModel).toBeTruthy();
      expect(profile.availableModels).toBeUndefined();
      // 出厂配置不得携带机器特定值（如本机代理端口），代理由用户在高级设置里自行填写
      expect(profile.httpProxy).toBeUndefined();
      expect(profile.httpsProxy).toBeUndefined();
    }
  });

  it('marks bundled profile ids as protected defaults', () => {
    expect(isDefaultApiProfileId('claude-anyrouter')).toBe(true);
    expect(isDefaultApiProfileId('codex-openai')).toBe(true);
    expect(isDefaultApiProfileId('claude-custom-1')).toBe(false);
  });
});
