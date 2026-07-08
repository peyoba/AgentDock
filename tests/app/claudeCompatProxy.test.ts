import { Buffer } from 'node:buffer';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  rewriteAnthropicMessagesRequest,
  startClaudeCompatProxy,
} from '../../src/main/claudeCompatProxy';

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

describe('startClaudeCompatProxy', () => {
  it('forwards a messages request to the configured upstream and redacts logs', async () => {
    const upstreamRequests: Array<{
      url: string;
      body: unknown;
      beta: string | null;
      auth: string | null;
    }> = [];
    const upstream = await createJsonUpstream((request, bodyText) => {
      upstreamRequests.push({
        url: request.url ?? '',
        body: JSON.parse(bodyText) as unknown,
        beta: request.headers['anthropic-beta'] as string | null,
        auth: request.headers.authorization as string | null,
      });
      return { ok: true };
    });
    const logger = vi.fn();
    const proxy = await startClaudeCompatProxy({
      upstreamBaseUrl: upstream.url,
      profileId: 'profile-a',
      sessionId: 'session-a',
      log: logger,
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
          'anthropic-beta': 'prompt-caching-scope-2026-01-05',
        },
        body: JSON.stringify({ model: 'claude-fable-5', max_tokens: 1200 }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(upstreamRequests).toHaveLength(1);
      expect(upstreamRequests[0]?.url).toBe('/v1/messages');
      expect(upstreamRequests[0]?.auth).toBe(`Bearer ${secret}`);
      expect(upstreamRequests[0]?.beta).toBe('interleaved-thinking-2025-05-14');
      expect(JSON.stringify(upstreamRequests[0]?.body)).toContain('"thinking"');
      expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });

  it('keeps two proxy instances pinned to different upstreams', async () => {
    const hits: string[] = [];
    const upstreamA = await createNamedUpstream('A', hits);
    const upstreamB = await createNamedUpstream('B', hits);
    const proxyA = await startClaudeCompatProxy({
      upstreamBaseUrl: upstreamA.url,
      profileId: 'profile-a',
      sessionId: 'session-a',
    });
    const proxyB = await startClaudeCompatProxy({
      upstreamBaseUrl: upstreamB.url,
      profileId: 'profile-b',
      sessionId: 'session-b',
    });

    try {
      await fetch(`${proxyA.baseUrl}/v1/models`);
      await fetch(`${proxyB.baseUrl}/v1/models`);

      expect(hits).toEqual(['A:/v1/models', 'B:/v1/models']);
    } finally {
      await proxyA.close();
      await proxyB.close();
      await upstreamA.close();
      await upstreamB.close();
    }
  });

  it('does not forward stale compression headers after upstream fetch decompression', async () => {
    const upstream = await createGzipUpstream({ ok: true });
    const proxy = await startClaudeCompatProxy({
      upstreamBaseUrl: upstream.url,
      profileId: 'profile-a',
      sessionId: 'session-a',
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/v1/models`);

      expect(response.headers.get('content-encoding')).toBeNull();
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await proxy.close();
      await upstream.close();
    }
  });
});

async function createJsonUpstream(
  responseBody: (request: http.IncomingMessage, bodyText: string) => unknown,
): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(responseBody(request, Buffer.concat(chunks).toString('utf8'))));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('invalid test server address');
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function createNamedUpstream(
  name: string,
  hits: string[],
): Promise<{ url: string; close(): Promise<void> }> {
  return createJsonUpstream((request) => {
    hits.push(`${name}:${request.url ?? ''}`);
    return { name };
  });
}

async function createGzipUpstream(body: unknown): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_request, response) => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(body)));
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(compressed.byteLength),
      });
      response.end(compressed);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('invalid test server address');
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
