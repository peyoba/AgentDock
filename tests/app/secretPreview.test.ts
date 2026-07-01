import { describe, expect, it } from 'vitest';
import { maskSecret, redactEnvironmentPreview } from '../../src/shared/secretPreview';

describe('secretPreview', () => {
  it('masks non-empty secrets without exposing the original value', () => {
    const masked = maskSecret('local-development-secret');

    expect(masked).toMatch(/^••••/);
    expect(masked).not.toContain('local-development-secret');
  });

  it('redacts sensitive environment values while keeping non-sensitive values visible', () => {
    const preview = redactEnvironmentPreview({
      ANTHROPIC_BASE_URL: 'https://example.invalid/v1',
      ANTHROPIC_AUTH_TOKEN: 'local-development-secret',
      CODEX_HOME: '/Users/example/.agentdock/codex-profiles/profile-a',
      OPENAI_API_KEY: 'local-development-secret',
    });

    expect(preview.ANTHROPIC_BASE_URL).toBe('https://example.invalid/v1');
    expect(preview.ANTHROPIC_AUTH_TOKEN).not.toContain('local-development-secret');
    expect(preview.OPENAI_API_KEY).not.toContain('local-development-secret');
    expect(preview.CODEX_HOME).toContain('profile-a');
  });
});
