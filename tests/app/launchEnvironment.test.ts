import { describe, expect, it } from 'vitest';
import { buildLaunchEnvironment } from '../../src/main/launchEnvironment';
import type { ApiProfile } from '../../src/shared/agentdockTypes';

const baseProfile: ApiProfile = {
  id: 'profile-a',
  name: 'Claude A',
  toolType: 'claude',
  baseUrl: 'https://example.invalid/v1',
  keychainService: 'AgentDock',
  keychainAccount: 'profile-a',
};

describe('buildLaunchEnvironment', () => {
  it('builds isolated Claude environment variables', () => {
    const env = buildLaunchEnvironment({
      profile: baseProfile,
      secret: 'local-development-secret',
      appDataPath: '/Users/example/Library/Application Support/AgentDock',
    });

    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid/v1');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('local-development-secret');
    expect(env.CODEX_HOME).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_CODE_RETRY_WATCHDOG).toBeUndefined();
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBeUndefined();
  });

  it('adds configured Claude Code retry environment variables for any Claude profile', () => {
    const env = buildLaunchEnvironment({
      profile: {
        ...baseProfile,
        claudeCodeRetryWatchdog: true,
        claudeCodeMaxRetries: 100,
        anthropicBetas: 'context-1m-2025-08-07',
        httpProxy: 'http://127.0.0.1:7890',
        httpsProxy: 'http://127.0.0.1:7890',
        claudeCodeDisableNonessentialTraffic: true,
        claudeCodeAttributionHeader: '0',
        disableInstallationChecks: true,
      },
      secret: 'local-development-secret',
      appDataPath: '/Users/example/Library/Application Support/AgentDock',
    });

    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.invalid/v1');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('local-development-secret');
    expect(env.CLAUDE_CODE_RETRY_WATCHDOG).toBe('1');
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBe('100');
    expect(env.ANTHROPIC_BETAS).toBe('context-1m-2025-08-07');
    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890');
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('0');
    expect(env.DISABLE_INSTALLATION_CHECKS).toBe('1');
  });

  it('does not inject invalid proxy URLs into Claude launch environment', () => {
    const env = buildLaunchEnvironment({
      profile: {
        ...baseProfile,
        anthropicBetas: 'context-1m-2025-08-07',
        httpProxy: 'context-1m-2025-08-07',
        httpsProxy: 'not-a-url',
      },
      secret: 'local-development-secret',
      appDataPath: '/Users/example/Library/Application Support/AgentDock',
    });

    expect(env.ANTHROPIC_BETAS).toBe('context-1m-2025-08-07');
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
  });

  it('builds isolated Codex endpoint, key, and CODEX_HOME per profile', () => {
    const env = buildLaunchEnvironment({
      profile: { ...baseProfile, id: 'codex-openai', toolType: 'codex' },
      secret: 'local-development-secret',
      appDataPath: '/Users/example/Library/Application Support/AgentDock',
    });

    expect(env.OPENAI_BASE_URL).toBe('https://example.invalid/v1');
    expect(env.OPENAI_API_KEY).toBe('local-development-secret');
    expect(env.CODEX_HOME).toContain('codex-openai');
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('expands a configured Codex Home under the user home directory', () => {
    const env = buildLaunchEnvironment({
      profile: {
        ...baseProfile,
        id: 'codex-openai',
        toolType: 'codex',
        codexHome: '~/.agentdock/codex-profiles/codex-openai',
      },
      secret: 'local-development-secret',
      appDataPath: '/Users/example/Library/Application Support/AgentDock',
      homeDir: '/Users/example',
    });

    expect(env.CODEX_HOME).toBe('/Users/example/.agentdock/codex-profiles/codex-openai');
  });
});
