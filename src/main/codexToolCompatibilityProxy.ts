import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CODEX_COMPATIBILITY_BODY_LIMIT_BYTES,
  createCodexInternalModelAlias,
  rewriteCodexCompatibilityRequest,
} from './codexToolCompatibilityRequest.js';

export type CodexToolCompatibilityProxyLogEvent = {
  profileId: string;
  sessionId: string;
  upstreamHost: string;
  path: string;
  statusCode: number;
  durationMs: number;
};

export type StartCodexToolCompatibilityProxyInput = {
  upstreamBaseUrl: string;
  upstreamApiKey: string;
  upstreamModel: string;
  profileId: string;
  sessionId: string;
  log?: (event: CodexToolCompatibilityProxyLogEvent) => void;
};

export type CodexToolCompatibilityProxyInstance = {
  baseUrl: string;
  localApiKey: string;
  internalModel: string;
  close(): Promise<void>;
};

class LocalRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function writeError(response: http.ServerResponse, statusCode: number, message: string): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: message }));
}

function readBoundedBody(request: http.IncomingMessage): Promise<string> {
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > CODEX_COMPATIBILITY_BODY_LIMIT_BYTES) {
    request.resume();
    return Promise.reject(new LocalRequestError(413, 'Codex compatibility request body is too large'));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const cleanup = (): void => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > CODEX_COMPATIBILITY_BODY_LIMIT_BYTES) {
        request.resume();
        fail(new LocalRequestError(413, 'Codex compatibility request body is too large'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onError = (): void => fail(new LocalRequestError(400, 'Codex compatibility request body failed'));
    const onAborted = (): void => fail(new LocalRequestError(400, 'Codex compatibility request body failed'));

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

function upstreamRequestHeaders(request: http.IncomingMessage, apiKey: string): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (['host', 'content-length', 'connection', 'authorization'].includes(name.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  headers.set('authorization', `Bearer ${apiKey}`);
  return headers;
}

function downstreamResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(name)) {
      continue;
    }
    result[name] = value;
  }
  return result;
}

function upstreamResponsesUrl(upstreamBase: URL, requestUrl: URL): URL {
  const result = new URL(upstreamBase);
  const basePath = result.pathname.replace(/\/$/, '');
  result.pathname = `${basePath}/responses`;
  result.search = requestUrl.search;
  return result;
}

export async function startCodexToolCompatibilityProxy({
  upstreamBaseUrl,
  upstreamApiKey,
  upstreamModel,
  profileId,
  sessionId,
  log,
}: StartCodexToolCompatibilityProxyInput): Promise<CodexToolCompatibilityProxyInstance> {
  const upstreamBase = new URL(upstreamBaseUrl);
  const localApiKey = randomBytes(32).toString('base64url');
  const internalModel = createCodexInternalModelAlias(sessionId);
  const activeRequests = new Set<AbortController>();
  const sockets = new Set<Socket>();
  let closing = false;

  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== '/v1/responses') {
      request.resume();
      writeError(response, 404, 'Codex compatibility route not found');
      return;
    }
    if (request.method !== 'POST') {
      request.resume();
      writeError(response, 405, 'Codex compatibility method not allowed');
      return;
    }
    if (request.headers.authorization !== `Bearer ${localApiKey}`) {
      request.resume();
      writeError(response, 401, 'Codex compatibility authorization failed');
      return;
    }
    if (closing) {
      request.resume();
      writeError(response, 503, 'Codex compatibility proxy is closing');
      return;
    }

    const startedAt = Date.now();
    const upstreamAbort = new AbortController();
    activeRequests.add(upstreamAbort);
    const abortOnClose = (): void => {
      if (!response.writableEnded) upstreamAbort.abort();
    };
    response.once('close', abortOnClose);

    try {
      const bodyText = await readBoundedBody(request);
      const rewrittenBody = rewriteCodexCompatibilityRequest({ bodyText, internalModel, upstreamModel });
      const upstreamResponse = await fetch(upstreamResponsesUrl(upstreamBase, requestUrl), {
        method: 'POST',
        headers: upstreamRequestHeaders(request, upstreamApiKey),
        body: JSON.stringify(rewrittenBody),
        signal: upstreamAbort.signal,
      });

      if (!upstreamResponse.ok) {
        upstreamAbort.abort();
        response.writeHead(upstreamResponse.status, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(
          `Upstream rejected Responses tools request (HTTP ${upstreamResponse.status}); verify this Profile supports Codex Responses tools`,
        );
      } else {
        response.writeHead(upstreamResponse.status, downstreamResponseHeaders(upstreamResponse.headers));
        if (upstreamResponse.body) {
          await pipeline(
            Readable.fromWeb(upstreamResponse.body as import('node:stream/web').ReadableStream),
            response,
          );
        } else {
          response.end();
        }
      }
      log?.({
        profileId,
        sessionId,
        upstreamHost: upstreamBase.host,
        path: requestUrl.pathname,
        statusCode: upstreamResponse.status,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
      } else if (error instanceof LocalRequestError) {
        writeError(response, error.statusCode, error.message);
      } else if (error instanceof Error && /JSON object|model/.test(error.message)) {
        writeError(response, 400, error.message);
      } else {
        writeError(response, 502, 'Codex compatibility upstream request failed');
      }
    } finally {
      response.off('close', abortOnClose);
      activeRequests.delete(upstreamAbort);
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
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
    server.close();
    throw new Error('Codex compatibility proxy failed to bind a local port');
  }

  let closePromise: Promise<void> | undefined;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    localApiKey,
    internalModel,
    close: () => {
      if (closePromise) return closePromise;
      closing = true;
      for (const controller of activeRequests) controller.abort();
      closePromise = new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      });
      return closePromise;
    },
  };
}
