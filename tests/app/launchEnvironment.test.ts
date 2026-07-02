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
