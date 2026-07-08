import { describe, expect, it } from 'vitest';
import { normalizeClaudeProfileDefaults } from '../../src/shared/claudeProfileDefaults';
import type { ApiProfile } from '../../src/shared/agentdockTypes';

describe('Claude profile defaults', () => {
  const baseClaudeProfile: ApiProfile = {
    id: 'claude-custom-1',
    name: 'Claude Custom',
    toolType: 'claude',
    baseUrl: 'https://claude.example.invalid',
    keychainService: 'AgentDock',
    keychainAccount: 'claude-custom-1',
  };

  it('enables CCometixLine statusline by default for Claude profiles without a stored preference', () => {
    expect(normalizeClaudeProfileDefaults(baseClaudeProfile).claudeCclineStatusLineEnabled).toBe(
      true,
    );
  });

  it('preserves an explicit CCometixLine statusline opt-out', () => {
    expect(
      normalizeClaudeProfileDefaults({
        ...baseClaudeProfile,
        claudeCclineStatusLineEnabled: false,
      }).claudeCclineStatusLineEnabled,
    ).toBe(false);
  });

  it('does not enable the Anthropic compat proxy by default for Claude profiles', () => {
    expect(
      normalizeClaudeProfileDefaults(baseClaudeProfile).claudeAnthropicCompatProxyEnabled,
    ).toBe(undefined);
  });

  it('preserves an explicit Anthropic compat proxy preference', () => {
    expect(
      normalizeClaudeProfileDefaults({
        ...baseClaudeProfile,
        claudeAnthropicCompatProxyEnabled: true,
      }).claudeAnthropicCompatProxyEnabled,
    ).toBe(true);
  });

  it('does not add CCometixLine statusline defaults to non-Claude profiles', () => {
    const codexProfile: ApiProfile = {
      id: 'codex-custom-1',
      name: 'Codex Custom',
      toolType: 'codex',
      baseUrl: 'https://codex.example.invalid/v1',
      keychainService: 'AgentDock',
      keychainAccount: 'codex-custom-1',
    };

    expect(normalizeClaudeProfileDefaults(codexProfile).claudeCclineStatusLineEnabled).toBe(
      undefined,
    );
  });
});
