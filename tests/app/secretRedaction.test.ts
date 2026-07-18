import { describe, expect, it } from 'vitest';
import { redactSecrets, registerKnownSecret } from '../../src/main/secretRedaction';

describe('secretRedaction', () => {
  it('redacts common key patterns', () => {
    expect(redactSecrets('token sk-ant-abcdefghijklmnop123 done')).toBe('token [REDACTED] done');
    expect(redactSecrets('ANTHROPIC_AUTH_TOKEN=whatever-value')).toBe(
      'ANTHROPIC_AUTH_TOKEN=[REDACTED]',
    );
  });

  it('redacts registered known secrets of arbitrary format', () => {
    registerKnownSecret('third-party-key-Zx91');
    expect(redactSecrets('echo third-party-key-Zx91')).toBe('echo [REDACTED]');
  });

  it('ignores short or empty known secrets', () => {
    registerKnownSecret('');
    registerKnownSecret('short');
    expect(redactSecrets('short text')).toBe('short text');
  });

  it('redacts XAI/Grok API key material', () => {
    expect(redactSecrets('XAI_API_KEY=xai-abcdefghijklmnop')).toBe('XAI_API_KEY=[REDACTED]');
    expect(redactSecrets('token xai-abcdefghijklmnop done')).toBe('token [REDACTED] done');
  });
});
