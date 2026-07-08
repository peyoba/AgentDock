import { describe, expect, it } from 'vitest';
import { rewriteAnthropicMessagesRequest } from '../../src/main/claudeCompatProxy';

const secret = 'test-agentdock-proxy-secret';

describe('rewriteAnthropicMessagesRequest', () => {
  it('removes disabled thinking for claude-3 models', () => {
    const result = rewriteAnthropicMessagesRequest({
      path: '/v1/messages',
      headers: { 'anthropic-beta': 'context-1m-2025-08-07' },
      bodyText: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        thinking: { type: 'disabled' },
      }),
    });

    expect(result.body).not.toHaveProperty('thinking');
    expect(result.body.max_tokens).toBe(4096);
    expect(result.headers['anthropic-beta']).toBe('context-1m-2025-08-07');
    expect(result.rewrite.thinking).toBe('removed');
  });

  it('uses adaptive thinking for opus and sonnet 4.6 through 4.9 models', () => {
    const result = rewriteAnthropicMessagesRequest({
      path: '/v1/messages?beta=true',
      headers: {
        'anthropic-beta':
          'context-1m-2025-08-07,prompt-caching-scope-2026-01-05,effort-2025-11-24',
      },
      bodyText: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        top_p: 0.9,
        top_k: 40,
        thinking: null,
      }),
    });

    expect(result.body.thinking).toEqual({ type: 'adaptive' });
    expect(result.body.temperature).toBe(1);
    expect(result.body).not.toHaveProperty('top_p');
    expect(result.body).not.toHaveProperty('top_k');
    expect(result.body.max_tokens).toBeGreaterThan(1024);
    expect(result.headers['anthropic-beta']).toBe(
      'context-1m-2025-08-07,interleaved-thinking-2025-05-14',
    );
    expect(result.rewrite.thinking).toBe('adaptive');
    expect(result.rewrite.removedBetas).toEqual([
      'prompt-caching-scope-2026-01-05',
      'effort-2025-11-24',
    ]);
  });

  it('uses enabled thinking with a bounded budget for other high-version Claude models', () => {
    const result = rewriteAnthropicMessagesRequest({
      path: '/v1/messages',
      headers: {},
      bodyText: JSON.stringify({
        model: 'claude-fable-5',
        max_tokens: 1200,
      }),
    });

    expect(result.body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(result.body.temperature).toBe(1);
    expect(result.body.max_tokens).toBeGreaterThan(1024);
    expect(result.headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14');
    expect(result.rewrite.thinking).toBe('enabled');
  });

  it('does not rewrite non-message paths', () => {
    const result = rewriteAnthropicMessagesRequest({
      path: '/v1/models',
      headers: {},
      bodyText: JSON.stringify({ model: 'claude-fable-5', max_tokens: 1200 }),
    });

    expect(result.body).toEqual({ model: 'claude-fable-5', max_tokens: 1200 });
    expect(result.headers).toEqual({});
    expect(result.rewrite.thinking).toBe('unchanged');
  });

  it('rejects invalid JSON without including the original body', () => {
    expect(() =>
      rewriteAnthropicMessagesRequest({
        path: '/v1/messages',
        headers: {},
        bodyText: `{"model":"claude-fable-5","content":"${secret}"`,
      }),
    ).toThrow('Claude compat proxy received invalid JSON');
  });
});
