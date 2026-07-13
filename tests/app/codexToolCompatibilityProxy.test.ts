import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCodexInternalModelAlias,
  rewriteCodexCompatibilityRequest,
} from '../../src/main/codexToolCompatibilityRequest';
import {
  startCodexToolCompatibilityProxy,
  type CodexToolCompatibilityProxyInstance,
} from '../../src/main/codexToolCompatibilityProxy';

const servers: Server[] = [];
const proxies: CodexToolCompatibilityProxyInstance[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections?.();
    server.close();
    await once(server, 'close').catch(() => undefined);
  }));
});

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP test server address');
  }
  servers.push(server);
  return `http://127.0.0.1:${address.port}/v1`;
}

async function startProxy(input: {
  upstreamBaseUrl: string;
  upstreamApiKey?: string;
  upstreamModel?: string;
  sessionId?: string;
  log?: Parameters<typeof startCodexToolCompatibilityProxy>[0]['log'];
}): Promise<CodexToolCompatibilityProxyInstance> {
  const proxy = await startCodexToolCompatibilityProxy({
    upstreamBaseUrl: input.upstreamBaseUrl,
    upstreamApiKey: input.upstreamApiKey ?? 'test-upstream-secret',
    upstreamModel: input.upstreamModel ?? 'gpt-5.6-sol',
    profileId: 'profile-test',
    sessionId: input.sessionId ?? 'session-test',
    log: input.log,
  });
  proxies.push(proxy);
  return proxy;
}

function proxyRequest(
  proxy: CodexToolCompatibilityProxyInstance,
  body: Record<string, unknown>,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${proxy.baseUrl}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${proxy.localApiKey}`,
      'content-type': 'application/json',
      ...init.headers,
    },
    body: JSON.stringify(body),
    ...init,
  });
}

describe('rewriteCodexCompatibilityRequest', () => {
  it('changes only the internal model alias and preserves standard tools', () => {
    const internalModel = createCodexInternalModelAlias('session-a');
    const source = {
      model: internalModel,
      tool_choice: 'auto',
      store: false,
      stream: true,
      tools: [
        { type: 'function', name: 'exec_command', parameters: { type: 'object' } },
        { type: 'custom', name: 'apply_patch', format: { type: 'text' } },
        { type: 'function', name: 'collaboration.send_message', parameters: { type: 'object' } },
      ],
      input: [{ role: 'user', content: 'test-only' }],
    };

    expect(rewriteCodexCompatibilityRequest({
      bodyText: JSON.stringify(source),
      internalModel,
      upstreamModel: 'gpt-5.6-sol',
    })).toEqual({
      ...source,
      model: 'gpt-5.6-sol',
    });
  });

  it('rejects a non-object body and a model that belongs to another session', () => {
    expect(() => rewriteCodexCompatibilityRequest({
      bodyText: '[]',
      internalModel: createCodexInternalModelAlias('session-a'),
      upstreamModel: 'gpt-5.6-sol',
    })).toThrow(/JSON object/i);
    expect(() => rewriteCodexCompatibilityRequest({
      bodyText: JSON.stringify({ model: createCodexInternalModelAlias('session-b') }),
      internalModel: createCodexInternalModelAlias('session-a'),
      upstreamModel: 'gpt-5.6-sol',
    })).toThrow(/model/i);
  });
});

describe('codexToolCompatibilityProxy', () => {
  it('requires the per-session local bearer token', async () => {
    const upstream = await listen(createServer((_request, response) => response.end('unexpected')));
    const proxy = await startProxy({ upstreamBaseUrl: upstream });

    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ model: proxy.internalModel }),
    });

    expect(response.status).toBe(401);
  });

  it('accepts only POST /v1/responses', async () => {
    const upstream = await listen(createServer((_request, response) => response.end('unexpected')));
    const proxy = await startProxy({ upstreamBaseUrl: upstream });

    const wrongMethod = await fetch(`${proxy.baseUrl}/responses`, {
      method: 'GET',
      headers: { authorization: `Bearer ${proxy.localApiKey}` },
    });
    const wrongPath = await fetch(`${proxy.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${proxy.localApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: proxy.internalModel }),
    });

    expect(wrongMethod.status).toBe(405);
    expect(wrongPath.status).toBe(404);
  });

  it('does not forward a mismatched internal model', async () => {
    let upstreamCalls = 0;
    const upstream = await listen(createServer((_request, response) => {
      upstreamCalls += 1;
      response.end('unexpected');
    }));
    const proxy = await startProxy({ upstreamBaseUrl: upstream });

    const response = await proxyRequest(proxy, {
      model: createCodexInternalModelAlias('another-session'),
      stream: true,
    });

    expect(response.status).toBe(400);
    expect(upstreamCalls).toBe(0);
  });

  it('replaces the local token with the upstream secret without logging either value', async () => {
    const upstreamSecret = 'test-upstream-secret-never-log';
    const requestMarker = 'test-request-body-never-log';
    let forwardedAuthorization = '';
    let forwardedBody: Record<string, unknown> | undefined;
    const upstream = await listen(createServer(async (request, response) => {
      forwardedAuthorization = request.headers.authorization ?? '';
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      forwardedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"id":"response-test"}');
    }));
    const log = vi.fn();
    const proxy = await startProxy({ upstreamBaseUrl: upstream, upstreamApiKey: upstreamSecret, log });

    const response = await proxyRequest(proxy, {
      model: proxy.internalModel,
      input: requestMarker,
      tools: [{ type: 'function', name: 'exec_command' }],
    });
    await response.text();

    expect(forwardedAuthorization).toBe(`Bearer ${upstreamSecret}`);
    expect(forwardedBody).toEqual({
      model: 'gpt-5.6-sol',
      input: requestMarker,
      tools: [{ type: 'function', name: 'exec_command' }],
    });
    const logs = JSON.stringify(log.mock.calls);
    expect(logs).not.toContain(upstreamSecret);
    expect(logs).not.toContain(proxy.localApiKey);
    expect(logs).not.toContain(requestMarker);
  });

  it('preserves an upstream error status without forwarding or logging its sensitive body', async () => {
    const upstreamSecret = 'test-upstream-error-secret-never-expose';
    const requestMarker = 'test-upstream-error-request-marker';
    const sensitiveSecondLine = 'test-sensitive-upstream-error-detail';
    const upstreamErrorBody = [
      'Gateway unavailable',
      `${requestMarker} Authorization: Bearer ${upstreamSecret}`,
      sensitiveSecondLine,
    ].join('\n');
    const upstream = await listen(createServer((_request, response) => {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(upstreamErrorBody);
    }));
    const log = vi.fn();
    const proxy = await startProxy({ upstreamBaseUrl: upstream, upstreamApiKey: upstreamSecret, log });

    const response = await proxyRequest(proxy, {
      model: proxy.internalModel,
      input: requestMarker,
      stream: true,
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const downstreamBody = await Promise.race([
      response.text(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Timed out reading bounded upstream error response')),
          1_000,
        );
      }),
    ]).finally(() => clearTimeout(timeout));

    expect(response.status).toBe(502);
    expect(downstreamBody).toContain('HTTP 502');
    expect(downstreamBody).toContain('Responses tools');
    expect(downstreamBody).not.toContain(requestMarker);
    expect(downstreamBody).not.toContain(upstreamSecret);
    expect(downstreamBody).not.toContain('Authorization');
    expect(downstreamBody).not.toContain(sensitiveSecondLine);
    expect(downstreamBody).not.toBe(upstreamErrorBody);

    const logs = JSON.stringify(log.mock.calls);
    expect(logs).not.toContain(requestMarker);
    expect(logs).not.toContain(upstreamSecret);
    expect(logs).not.toContain('Authorization');
    expect(logs).not.toContain(sensitiveSecondLine);
  });

  it('streams SSE chunks before upstream completion', async () => {
    let finishUpstream: (() => void) | undefined;
    const upstreamFinished = new Promise<void>((resolve) => {
      finishUpstream = resolve;
    });
    const upstream = await listen(createServer(async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: response.output_item.added\ndata: {"type":"function_call"}\n\n');
      await upstreamFinished;
      response.end('event: response.completed\ndata: {"type":"response.completed"}\n\n');
    }));
    const proxy = await startProxy({ upstreamBaseUrl: upstream });

    const response = await proxyRequest(proxy, { model: proxy.internalModel, stream: true });
    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();

    expect(new TextDecoder().decode(firstChunk?.value)).toContain('function_call');
    expect(firstChunk?.done).toBe(false);
    finishUpstream?.();
    await reader?.cancel();
  });

  it('keeps two sessions pinned to different ports, tokens and upstream models', async () => {
    const forwardedModels: string[] = [];
    const upstream = await listen(createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      forwardedModels.push((JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model: string }).model);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    }));
    const first = await startProxy({ upstreamBaseUrl: upstream, upstreamModel: 'model-a', sessionId: 'session-a' });
    const second = await startProxy({ upstreamBaseUrl: upstream, upstreamModel: 'model-b', sessionId: 'session-b' });

    expect(first.baseUrl).not.toBe(second.baseUrl);
    expect(first.localApiKey).not.toBe(second.localApiKey);
    expect(first.internalModel).not.toBe(second.internalModel);
    await Promise.all([
      proxyRequest(first, { model: first.internalModel }).then((response) => response.text()),
      proxyRequest(second, { model: second.internalModel }).then((response) => response.text()),
    ]);

    expect(forwardedModels.sort()).toEqual(['model-a', 'model-b']);
  });

  it('close resolves while a streaming request is open', async () => {
    const upstream = await listen(createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: response.created\ndata: {}\n\n');
    }));
    const proxy = await startProxy({ upstreamBaseUrl: upstream });
    const response = await proxyRequest(proxy, { model: proxy.internalModel, stream: true });
    await response.body?.getReader().read();

    await expect(Promise.race([
      proxy.close().then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 1_000)),
    ])).resolves.toBe('closed');
  });
});
