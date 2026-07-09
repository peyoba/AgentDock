import { Buffer } from 'node:buffer';
import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const INTERLEAVED_THINKING_BETA = 'interleaved-thinking-2025-05-14';
const UNSUPPORTED_BETAS = new Set([
  'prompt-caching-scope-2026-01-05',
  'effort-2025-11-24',
]);

export type CompatRewriteStatus = 'unchanged' | 'removed' | 'adaptive' | 'enabled';

export type CompatRewriteSummary = {
  model?: string;
  thinking: CompatRewriteStatus;
  removedBetas: string[];
};

export type RewriteAnthropicMessagesInput = {
  path: string;
  headers: Record<string, string | undefined>;
  bodyText: string;
};

export type RewriteAnthropicMessagesResult = {
  body: Record<string, unknown>;
  bodyText: string;
  headers: Record<string, string>;
  rewrite: CompatRewriteSummary;
};

function parseJsonObject(bodyText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body is not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Claude compat proxy received invalid JSON');
  }
}

function isMessagesPath(pathValue: string): boolean {
  const pathname = new URL(pathValue, 'http://127.0.0.1').pathname;
  return pathname === '/v1/messages' || pathname.startsWith('/v1/messages/');
}

function disabledThinking(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  return (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === 'disabled'
  );
}

function modelName(body: Record<string, unknown>): string | undefined {
  return typeof body.model === 'string' ? body.model : undefined;
}

function isClaude3Model(model: string | undefined): boolean {
  return typeof model === 'string' && /^claude-3(?:-|$)/.test(model);
}

function isAdaptiveThinkingModel(model: string | undefined): boolean {
  if (typeof model !== 'string') {
    return false;
  }

  return (
    /(?:^|-)opus-4-[6-9](?:-|$)/.test(model) ||
    /(?:^|-)sonnet-4-[6-9](?:-|$)/.test(model)
  );
}

function shouldEnableThinking(model: string | undefined): boolean {
  return typeof model === 'string' && model.startsWith('claude-') && !isClaude3Model(model);
}

function maxTokens(body: Record<string, unknown>): number {
  return typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens)
    ? Math.trunc(body.max_tokens)
    : 8192;
}

function thinkingBudgetTokens(body: Record<string, unknown>): number {
  return Math.min(32000, Math.max(1024, Math.floor(maxTokens(body) * 0.8)));
}

function normalizeThinkingParameters(body: Record<string, unknown>): void {
  const thinking = body.thinking as { budget_tokens?: unknown } | undefined;
  const budget =
    typeof thinking?.budget_tokens === 'number' && Number.isFinite(thinking.budget_tokens)
      ? Math.trunc(thinking.budget_tokens)
      : 0;

  body.temperature = 1;
  delete body.top_p;
  delete body.top_k;
  if (budget > 0 && maxTokens(body) <= budget) {
    body.max_tokens = budget + 1;
  }
}

function betaTokens(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeThinkingBeta(headers: Record<string, string>): string[] {
  const tokens = betaTokens(headers['anthropic-beta']);
  const removed: string[] = [];
  const kept: string[] = [];

  for (const token of tokens) {
    if (UNSUPPORTED_BETAS.has(token)) {
      removed.push(token);
      continue;
    }
    if (!kept.includes(token)) {
      kept.push(token);
    }
  }

  if (!kept.includes(INTERLEAVED_THINKING_BETA)) {
    kept.push(INTERLEAVED_THINKING_BETA);
  }

  headers['anthropic-beta'] = kept.join(',');
  return removed;
}

function normalizeInputHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalized[name.toLowerCase()] = value;
    }
  }
  return normalized;
}

export type CompatProxyLogEvent = {
  sessionId: string;
  profileId: string;
  upstreamHost: string;
  path: string;
  statusCode: number;
  model?: string;
  thinking: CompatRewriteStatus;
  removedBetas: string[];
};

export type StartClaudeCompatProxyInput = {
  upstreamBaseUrl: string;
  profileId: string;
  sessionId: string;
  log?: (event: CompatProxyLogEvent) => void;
};

export type ClaudeCompatProxyInstance = {
  baseUrl: string;
  close(): Promise<void>;
};

function resolveUpstreamUrl(upstreamBaseUrl: string, requestUrl: string): URL {
  const base = new URL(upstreamBaseUrl);
  const request = new URL(requestUrl, 'http://127.0.0.1');
  const basePath = base.pathname.replace(/\/$/, '');
  const requestPath = request.pathname;

  if (basePath && basePath !== '/' && requestPath !== basePath && !requestPath.startsWith(`${basePath}/`)) {
    base.pathname = `${basePath}${requestPath}`;
  } else {
    base.pathname = requestPath;
  }
  base.search = request.search;
  return base;
}

function requestHeaders(request: http.IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers[name] = value.join(',');
    } else {
      headers[name] = value;
    }
  }
  return headers;
}

function fetchHeaders(headers: Record<string, string>): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (['host', 'content-length', 'connection'].includes(name.toLowerCase())) {
      continue;
    }
    result.set(name, value);
  }
  return result;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (
      ['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(
        name.toLowerCase(),
      )
    ) {
      continue;
    }
    result[name] = value;
  }
  return result;
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeProxyError(response: http.ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: message }));
}

export function rewriteAnthropicMessagesRequest({
  path,
  headers,
  bodyText,
}: RewriteAnthropicMessagesInput): RewriteAnthropicMessagesResult {
  const body = parseJsonObject(bodyText);
  const normalizedHeaders = normalizeInputHeaders(headers);
  const model = modelName(body);
  const rewrite: CompatRewriteSummary = {
    model,
    thinking: 'unchanged',
    removedBetas: [],
  };

  if (!isMessagesPath(path)) {
    return { body, bodyText: JSON.stringify(body), headers: normalizedHeaders, rewrite };
  }

  if (disabledThinking(body.thinking)) {
    if (isClaude3Model(model)) {
      delete body.thinking;
      rewrite.thinking = 'removed';
    } else if (isAdaptiveThinkingModel(model)) {
      body.thinking = { type: 'adaptive' };
      rewrite.thinking = 'adaptive';
    } else if (shouldEnableThinking(model)) {
      body.thinking = { type: 'enabled', budget_tokens: thinkingBudgetTokens(body) };
      rewrite.thinking = 'enabled';
    }
  }

  if (rewrite.thinking === 'adaptive' || rewrite.thinking === 'enabled') {
    normalizeThinkingParameters(body);
    rewrite.removedBetas = normalizeThinkingBeta(normalizedHeaders);
  }

  return { body, bodyText: JSON.stringify(body), headers: normalizedHeaders, rewrite };
}

export async function startClaudeCompatProxy({
  upstreamBaseUrl,
  profileId,
  sessionId,
  log,
}: StartClaudeCompatProxyInput): Promise<ClaudeCompatProxyInstance> {
  const upstreamBase = new URL(upstreamBaseUrl);
  const server = http.createServer(async (request, response) => {
    const requestUrl = request.url ?? '/';
    let bodyText =
      request.method === 'GET' || request.method === 'HEAD'
        ? ''
        : await readRequestBody(request);
    let headers = normalizeInputHeaders(requestHeaders(request));
    let rewrite: CompatRewriteSummary = { thinking: 'unchanged', removedBetas: [] };

    // CLI 中断请求时同步取消上游 fetch，避免继续消耗上游 token。
    const upstreamAbort = new AbortController();
    response.once('close', () => {
      if (!response.writableEnded) {
        upstreamAbort.abort();
      }
    });

    try {
      if (request.method === 'POST' && bodyText) {
        const rewritten = rewriteAnthropicMessagesRequest({
          path: requestUrl,
          headers,
          bodyText,
        });
        bodyText = rewritten.bodyText;
        headers = rewritten.headers;
        rewrite = rewritten.rewrite;
      }

      const upstreamUrl = resolveUpstreamUrl(upstreamBaseUrl, requestUrl);
      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: fetchHeaders(headers),
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : bodyText,
        signal: upstreamAbort.signal,
      });

      response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
      if (upstreamResponse.body) {
        // 必须逐块转发：Claude CLI 依赖 SSE 流式输出，整体缓冲会让终端长时间无响应。
        await pipeline(
          Readable.fromWeb(upstreamResponse.body as import('node:stream/web').ReadableStream),
          response,
        );
      } else {
        response.end();
      }
      log?.({
        sessionId,
        profileId,
        upstreamHost: upstreamBase.host,
        path: new URL(requestUrl, 'http://127.0.0.1').pathname,
        statusCode: upstreamResponse.status,
        model: rewrite.model,
        thinking: rewrite.thinking,
        removedBetas: rewrite.removedBetas,
      });
    } catch (error) {
      if (response.headersSent) {
        // 响应头已发出（如流式中途上游断开），无法再写错误响应，直接断开连接。
        response.destroy();
        return;
      }
      writeProxyError(
        response,
        error instanceof Error && /invalid JSON/.test(error.message) ? 400 : 502,
        error instanceof Error ? error.message : 'Claude compat proxy request failed',
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Claude compat proxy failed to bind a local port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // close() 只会停止接收新连接；主动断开存活连接（如挂起的 SSE 流），
        // 否则 kill 会话 / 退出应用会被长请求阻塞。
        server.closeAllConnections();
      }),
  };
}
