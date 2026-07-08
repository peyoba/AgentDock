# AgentDock Claude Compat Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Claude Profile 增加可选的 session 专属 Anthropic 兼容改写层，替代外部全局 AnyRouter 代理，同时保持多 Profile endpoint/key 隔离。

**Architecture:** 在 Electron main process 内新增 `src/main/claudeCompatProxy.ts`，使用 Node 内置 HTTP server 监听 `127.0.0.1:0`，按 session 保存固定 upstream 并只改写 `POST /v1/messages*`。`SessionService` 在 Claude 非本地 shell 会话启动前按 Profile 开关创建代理，将 `ANTHROPIC_BASE_URL` 指向本地动态端口，并在 PTY 失败、退出、停止、删除和 dispose 时关闭代理。

**Tech Stack:** Electron main process、TypeScript、Node `http`/`fetch`/`URL`、React API 配置 UI、Vitest、现有 node-pty adapter；不新增生产依赖。

---

## 当前前置状态

- 已确认 SPEC：`docs/superpowers/specs/2026-07-08-agentdock-claude-compat-proxy-design.zh-CN.md`
- 风险等级：L3
- 当前工作区已有未提交 UI/测试改动：`src/renderer/App.tsx`、`src/renderer/components/CommandBar.tsx`、`src/renderer/components/TerminalPane.tsx`、`src/renderer/styles.css`、`tests/app/App.test.tsx`、`tests/app/layoutPolish.test.ts`、`tests/app/windowChrome.test.ts`、`.agent-workflow/state.md`
- 执行本计划前先决定这些既有改动是提交为独立基线，还是在当前 dirty worktree 中继续叠加。本计划不要求回滚它们。

## 文件结构

- Create: `src/main/claudeCompatProxy.ts`
  - 职责：本地 loopback 转发器、请求体改写、beta header 归一化、上游 URL 拼接、脱敏日志摘要。
- Create: `tests/app/claudeCompatProxy.test.ts`
  - 职责：覆盖改写规则、非 messages 透传、上游隔离、secret 不进日志/错误。
- Modify: `src/shared/agentdockTypes.ts`
  - 增加 `ApiProfile.claudeAnthropicCompatProxyEnabled?: boolean`。
- Modify: `src/shared/claudeProfileDefaults.ts`
  - Claude 默认归一化时保留该开关，默认不自动开启。
- Modify: `src/main/stores/configMigration.ts`
  - 配置版本升级到 `5`，迁移和保存保留新字段。
- Modify: `src/main/stores/profileStore.ts`
  - Profile store sanitize 白名单保留新字段。
- Modify: `src/main/main.ts`
  - Renderer IPC profile sanitize 白名单保留新字段。
- Modify: `src/main/launchEnvironment.ts`
  - 支持 Claude base URL override，默认仍使用 `profile.baseUrl`。
- Modify: `src/main/sessionService.ts`
  - 增加代理 factory 注入、启动前创建代理、退出和清理时关闭代理。
- Modify: `src/renderer/components/ApiConfigPanel.tsx`
  - Claude Profile 高级网络配置中新增“启用 Anthropic 兼容改写”开关，保存时带上字段。
- Modify tests:
  - `tests/app/configMigration.test.ts`
  - `tests/app/claudeProfileDefaults.test.ts`
  - `tests/app/launchEnvironment.test.ts`
  - `tests/app/sessionService.test.ts`
  - `tests/app/sessionSecurity.test.ts`
  - `tests/app/App.test.tsx`
  - `tests/app/preloadTypes.test.ts`（如当前白名单测试要求字段显式覆盖）

## Task 0: Baseline Guard

**Files:**
- Read only: current git state

- [ ] **Step 1: Record the dirty baseline**

Run:

```bash
git status --short --branch
git diff --stat
```

Expected: 看到当前已有 UI/测试/state 改动；不要回滚用户改动。

- [ ] **Step 2: Run the workflow gate before implementation**

Run:

```bash
npm run workflow:doctor
```

Expected: PASS。如果失败，先记录失败项并停止进入代码实现。

- [ ] **Step 3: Decide baseline handling**

如果用户选择提交当前 UI 改动，使用：

```bash
git add .agent-workflow/state.md src/renderer/App.tsx src/renderer/components/CommandBar.tsx src/renderer/components/TerminalPane.tsx src/renderer/styles.css tests/app/App.test.tsx tests/app/layoutPolish.test.ts tests/app/windowChrome.test.ts
git commit -m "chore: preserve pre-proxy worktree baseline"
```

如果用户选择继续叠加，记录“dirty baseline accepted”，不要执行 commit。

## Task 1: Compat Proxy Rewrite Rules

**Files:**
- Create: `tests/app/claudeCompatProxy.test.ts`
- Create: `src/main/claudeCompatProxy.ts`

- [ ] **Step 1: Write failing tests for request rewrite rules**

Create `tests/app/claudeCompatProxy.test.ts` with these initial tests:

```ts
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
    expect(result.body.max_tokens).toBe(1025);
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
```

- [ ] **Step 2: Run the new tests to verify RED**

Run:

```bash
npx vitest run tests/app/claudeCompatProxy.test.ts
```

Expected: FAIL because `src/main/claudeCompatProxy.ts` does not exist.

- [ ] **Step 3: Implement the rewrite helpers**

Create `src/main/claudeCompatProxy.ts` with these exported rewrite pieces:

```ts
import http from 'node:http';
import { Buffer } from 'node:buffer';

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
  return (
    typeof model === 'string' &&
    /(?:^|-)opus-4-[6-9](?:-|$)/.test(model) ||
    typeof model === 'string' &&
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
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run tests/app/claudeCompatProxy.test.ts
```

Expected: rewrite tests PASS; proxy server import tests still fail until `startClaudeCompatProxy` is implemented in Task 2.

## Task 2: Loopback Proxy Server

**Files:**
- Modify: `tests/app/claudeCompatProxy.test.ts`
- Modify: `src/main/claudeCompatProxy.ts`

- [ ] **Step 1: Add failing proxy server tests**

Append to `tests/app/claudeCompatProxy.test.ts`:

```ts
describe('startClaudeCompatProxy', () => {
  it('forwards a messages request to the configured upstream and redacts logs', async () => {
    const upstreamRequests: Array<{ url: string; body: unknown; beta: string | null; auth: string | null }> = [];
    const upstream = await new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
      const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
          upstreamRequests.push({
            url: request.url ?? '',
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
            beta: request.headers['anthropic-beta'] as string | null,
            auth: request.headers.authorization as string | null,
          });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: true }));
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
    const logger = vi.fn();

    const proxy = await startClaudeCompatProxy({
      upstreamBaseUrl: upstream.url,
      profileId: 'profile-a',
      sessionId: 'session-a',
      log: logger,
    });

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

    await proxy.close();
    await upstream.close();
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

    await fetch(`${proxyA.baseUrl}/v1/models`);
    await fetch(`${proxyB.baseUrl}/v1/models`);

    expect(hits).toEqual(['A:/v1/models', 'B:/v1/models']);

    await proxyA.close();
    await proxyB.close();
    await upstreamA.close();
    await upstreamB.close();
  });
});

async function createNamedUpstream(name: string, hits: string[]) {
  return new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
    const server = http.createServer((request, response) => {
      hits.push(`${name}:${request.url ?? ''}`);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ name }));
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
```

Add imports at the top:

```ts
import http from 'node:http';
import { Buffer } from 'node:buffer';
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run tests/app/claudeCompatProxy.test.ts
```

Expected: FAIL because server startup/forwarding is not implemented.

- [ ] **Step 3: Implement proxy server**

Extend `src/main/claudeCompatProxy.ts`:

```ts
type CompatProxyLogEvent = {
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

  if (basePath && basePath !== '/' && !requestPath.startsWith(`${basePath}/`)) {
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

export async function startClaudeCompatProxy({
  upstreamBaseUrl,
  profileId,
  sessionId,
  log,
}: StartClaudeCompatProxyInput): Promise<ClaudeCompatProxyInstance> {
  const upstreamBase = new URL(upstreamBaseUrl);
  const server = http.createServer(async (request, response) => {
    const requestUrl = request.url ?? '/';
    let bodyText = request.method === 'GET' || request.method === 'HEAD'
      ? ''
      : await readRequestBody(request);
    let headers = normalizeInputHeaders(requestHeaders(request));
    let rewrite: CompatRewriteSummary = { thinking: 'unchanged', removedBetas: [] };

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
      });

      response.writeHead(upstreamResponse.status, Object.fromEntries(upstreamResponse.headers));
      response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
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
      writeProxyError(
        response,
        error instanceof SyntaxError ? 400 : 502,
        error instanceof Error ? error.message : 'Claude compat proxy request failed',
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
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
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
```

- [ ] **Step 4: Run focused proxy tests**

Run:

```bash
npx vitest run tests/app/claudeCompatProxy.test.ts
```

Expected: PASS.

## Task 3: Profile Field Persistence

**Files:**
- Modify: `src/shared/agentdockTypes.ts`
- Modify: `src/shared/claudeProfileDefaults.ts`
- Modify: `src/main/stores/configMigration.ts`
- Modify: `src/main/stores/profileStore.ts`
- Modify: `src/main/main.ts`
- Test: `tests/app/configMigration.test.ts`
- Test: `tests/app/claudeProfileDefaults.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Add to `tests/app/configMigration.test.ts`:

```ts
it('preserves the Claude Anthropic compat proxy flag during migration and versioning', () => {
  const migrated = migrateProfile({
    __version: 4,
    id: 'claude-custom-1',
    name: 'Claude Custom',
    toolType: 'claude',
    baseUrl: 'https://anyrouter.top',
    keychainService: 'AgentDock',
    keychainAccount: 'claude-custom-1',
    claudeAnthropicCompatProxyEnabled: true,
  });

  expect(migrated.claudeAnthropicCompatProxyEnabled).toBe(true);
  expect(addVersionToProfile(migrated).__version).toBe(5);
});
```

Add to `tests/app/claudeProfileDefaults.test.ts`:

```ts
it('does not enable the Anthropic compat proxy by default for Claude profiles', () => {
  expect(normalizeClaudeProfileDefaults(baseClaudeProfile).claudeAnthropicCompatProxyEnabled).toBe(
    undefined,
  );
});

it('preserves an explicit Anthropic compat proxy preference', () => {
  expect(
    normalizeClaudeProfileDefaults({
      ...baseClaudeProfile,
      claudeAnthropicCompatProxyEnabled: true,
    }).claudeAnthropicCompatProxyEnabled,
  ).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run tests/app/configMigration.test.ts tests/app/claudeProfileDefaults.test.ts
```

Expected: FAIL because the type/store/migration field is absent and version is still `4`.

- [ ] **Step 3: Add the field to shared type and defaults**

In `src/shared/agentdockTypes.ts`, add:

```ts
  claudeAnthropicCompatProxyEnabled?: boolean;
```

In `src/shared/claudeProfileDefaults.ts`, return the field only from the existing profile:

```ts
    claudeAnthropicCompatProxyEnabled:
      profile.claudeAnthropicCompatProxyEnabled === true ? true : undefined,
```

Place it next to `claudeAlwaysThinkingEnabled` / `claudeCclineStatusLineEnabled`.

- [ ] **Step 4: Update config migration and sanitizers**

In `src/main/stores/configMigration.ts`:

```ts
export type ConfigVersion = 1 | 2 | 3 | 4 | 5;
export const CURRENT_CONFIG_VERSION: ConfigVersion = 5;
```

Allow version `5` in both profile and workspace migration branches, and include:

```ts
      claudeAnthropicCompatProxyEnabled:
        profile.claudeAnthropicCompatProxyEnabled as boolean | undefined,
```

Set legacy migration value:

```ts
    claudeAnthropicCompatProxyEnabled: undefined,
```

In `src/main/stores/profileStore.ts` and `src/main/main.ts`, preserve:

```ts
  if (typeof normalizedProfile.claudeAnthropicCompatProxyEnabled === 'boolean') {
    sanitized.claudeAnthropicCompatProxyEnabled =
      normalizedProfile.claudeAnthropicCompatProxyEnabled;
  }
```

For `src/main/main.ts`, include it in the returned object near other Claude booleans:

```ts
    claudeAnthropicCompatProxyEnabled:
      normalizedProfile.claudeAnthropicCompatProxyEnabled,
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run tests/app/configMigration.test.ts tests/app/claudeProfileDefaults.test.ts
```

Expected: PASS.

## Task 4: Launch Environment Override

**Files:**
- Modify: `src/main/launchEnvironment.ts`
- Test: `tests/app/launchEnvironment.test.ts`

- [ ] **Step 1: Write failing launch environment test**

Add to `tests/app/launchEnvironment.test.ts`:

```ts
it('can override the Claude base URL with a session-local compat proxy URL', () => {
  const env = buildLaunchEnvironment({
    profile: {
      ...baseProfile,
      claudeAnthropicCompatProxyEnabled: true,
    },
    secret: 'local-development-secret',
    appDataPath: '/Users/example/Library/Application Support/AgentDock',
    anthropicBaseUrl: 'http://127.0.0.1:43210',
  });

  expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:43210');
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('local-development-secret');
});
```

- [ ] **Step 2: Run launch environment tests to verify RED**

Run:

```bash
npx vitest run tests/app/launchEnvironment.test.ts
```

Expected: FAIL because `anthropicBaseUrl` is not accepted.

- [ ] **Step 3: Add optional override**

In `src/main/launchEnvironment.ts`, extend `BuildLaunchEnvironmentInput`:

```ts
  anthropicBaseUrl?: string;
```

Update function parameters:

```ts
export function buildLaunchEnvironment({
  profile,
  secret,
  appDataPath,
  homeDir = os.homedir(),
  anthropicBaseUrl,
}: BuildLaunchEnvironmentInput): Record<string, string> {
```

Use the override for Claude only:

```ts
      ANTHROPIC_BASE_URL: anthropicBaseUrl ?? profile.baseUrl,
```

- [ ] **Step 4: Run launch environment tests**

Run:

```bash
npx vitest run tests/app/launchEnvironment.test.ts
```

Expected: PASS.

## Task 5: SessionService Proxy Lifecycle

**Files:**
- Modify: `src/main/sessionService.ts`
- Test: `tests/app/sessionService.test.ts`
- Test: `tests/app/sessionSecurity.test.ts`

- [ ] **Step 1: Add failing SessionService tests**

Add to `tests/app/sessionService.test.ts`:

```ts
it('uses a session-local Claude compat proxy when the profile enables it', async () => {
  const spawned: Array<{ env: Record<string, string> }> = [];
  const closed: string[] = [];
  const service = createSessionService({
    keychain: { readSecret: vi.fn().mockResolvedValue('local-development-secret'), writeSecret: vi.fn(), deleteSecret: vi.fn() },
    pty: {
      async spawn(request) {
        spawned.push({ env: request.env });
        return createFakePtySession(request.sessionId);
      },
    },
    startClaudeCompatProxy: vi.fn(async ({ upstreamBaseUrl, sessionId }) => ({
      baseUrl: `http://127.0.0.1:41000/${sessionId}`,
      close: vi.fn(async () => closed.push(upstreamBaseUrl)),
    })),
    appDataPath: '/tmp/agentdock-test-data',
    workspaceExists: () => true,
  });

  await service.launch({
    profile: {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://upstream-a.example',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
      claudeAnthropicCompatProxyEnabled: true,
    },
    workspace: { id: 'workspace-a', name: 'Workspace A', path: '/tmp/workspace-a' },
    command: 'claude',
  });

  expect(spawned[0]?.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:41000/session-1');
  expect(spawned[0]?.env.ANTHROPIC_AUTH_TOKEN).toBe('local-development-secret');
  expect(closed).toEqual([]);
});

it('does not use the Claude compat proxy for local shell commands or disabled profiles', async () => {
  const startClaudeCompatProxy = vi.fn();
  const spawned: Array<{ env: Record<string, string> }> = [];
  const service = createSessionService({
    keychain: { readSecret: vi.fn().mockResolvedValue('local-development-secret'), writeSecret: vi.fn(), deleteSecret: vi.fn() },
    pty: {
      async spawn(request) {
        spawned.push({ env: request.env });
        return createFakePtySession(request.sessionId);
      },
    },
    startClaudeCompatProxy,
    appDataPath: '/tmp/agentdock-test-data',
    workspaceExists: () => true,
  });
  const profile = {
    id: 'profile-a',
    name: 'Claude A',
    toolType: 'claude' as const,
    baseUrl: 'https://upstream-a.example',
    keychainService: 'AgentDock',
    keychainAccount: 'profile-a',
    claudeAnthropicCompatProxyEnabled: true,
  };

  await service.launch({
    profile,
    workspace: { id: 'workspace-a', name: 'Workspace A', path: '/tmp/workspace-a' },
    command: 'zsh',
  });
  await service.launch({
    profile: { ...profile, claudeAnthropicCompatProxyEnabled: false },
    workspace: { id: 'workspace-a', name: 'Workspace A', path: '/tmp/workspace-a' },
    command: 'claude',
  });

  expect(startClaudeCompatProxy).not.toHaveBeenCalled();
  expect(spawned[0]?.env.ANTHROPIC_BASE_URL).toBeUndefined();
  expect(spawned[1]?.env.ANTHROPIC_BASE_URL).toBe('https://upstream-a.example');
});

it('closes the Claude compat proxy when PTY spawn fails and when a session stops', async () => {
  const closed: string[] = [];
  const service = createSessionService({
    keychain: { readSecret: vi.fn().mockResolvedValue('local-development-secret'), writeSecret: vi.fn(), deleteSecret: vi.fn() },
    pty: {
      async spawn(request) {
        if (request.sessionId === 'session-1') {
          throw new Error('spawn failed');
        }
        return createFakePtySession(request.sessionId);
      },
    },
    startClaudeCompatProxy: vi.fn(async ({ sessionId }) => ({
      baseUrl: `http://127.0.0.1:42000/${sessionId}`,
      close: vi.fn(async () => closed.push(sessionId)),
    })),
    appDataPath: '/tmp/agentdock-test-data',
    workspaceExists: () => true,
  });
  const profile = {
    id: 'profile-a',
    name: 'Claude A',
    toolType: 'claude' as const,
    baseUrl: 'https://upstream-a.example',
    keychainService: 'AgentDock',
    keychainAccount: 'profile-a',
    claudeAnthropicCompatProxyEnabled: true,
  };
  const workspace = { id: 'workspace-a', name: 'Workspace A', path: '/tmp/workspace-a' };

  await expect(service.launch({ profile, workspace, command: 'claude' })).rejects.toThrow(
    '终端命令启动失败',
  );
  const session = await service.launch({ profile, workspace, command: 'claude' });
  await service.killTerminal({ sessionId: session.id });

  expect(closed).toEqual(['session-1', 'session-2']);
});
```

If `createFakePtySession` is private in the test file, add a local helper near existing helpers:

```ts
function createFakePtySession(sessionId: string) {
  return {
    id: sessionId,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(),
  };
}
```

Add to `tests/app/sessionSecurity.test.ts`:

```ts
it('does not expose compat proxy secrets in session payloads', async () => {
  const service = createSecureTestService({
    startClaudeCompatProxy: async () => ({
      baseUrl: 'http://127.0.0.1:43000',
      close: async () => undefined,
    }),
  });
  const session = await service.launch({
    profile: {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://upstream.example',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
      claudeAnthropicCompatProxyEnabled: true,
    },
    workspace: { id: 'workspace-a', name: 'Workspace A', path: '/tmp/workspace-a' },
    command: 'claude',
  });

  expect(JSON.stringify(session)).not.toContain('local-development-secret');
  expect(JSON.stringify(session)).not.toContain('ANTHROPIC_AUTH_TOKEN');
  expect(JSON.stringify(session)).not.toContain('Authorization');
});
```

- [ ] **Step 2: Run focused SessionService tests to verify RED**

Run:

```bash
npx vitest run tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts -t "compat proxy|compat proxy secrets|session-local Claude"
```

Expected: FAIL because `startClaudeCompatProxy` is not wired.

- [ ] **Step 3: Wire proxy factory into SessionService**

In `src/main/sessionService.ts`, import:

```ts
import {
  startClaudeCompatProxy as startDefaultClaudeCompatProxy,
  type ClaudeCompatProxyInstance,
  type StartClaudeCompatProxyInput,
} from './claudeCompatProxy.js';
```

Add types:

```ts
type ClaudeCompatProxyFactory = (
  input: StartClaudeCompatProxyInput,
) => Promise<ClaudeCompatProxyInstance>;
```

Extend `CreateSessionServiceOptions`:

```ts
  startClaudeCompatProxy?: ClaudeCompatProxyFactory;
```

Extend normalized options and destructuring with `startClaudeCompatProxy`, defaulting to `startDefaultClaudeCompatProxy`.

Create map and close helper inside `createSessionService`:

```ts
  const claudeCompatProxies = new Map<string, ClaudeCompatProxyInstance>();

  const closeClaudeCompatProxy = async (sessionId: string): Promise<void> => {
    const proxy = claudeCompatProxies.get(sessionId);
    if (!proxy) {
      return;
    }
    claudeCompatProxies.delete(sessionId);
    await proxy.close().catch(() => undefined);
  };
```

Before `buildLaunchEnvironment`, read the secret once and optionally start proxy:

```ts
      const secret = isLocalShellCommand(command)
        ? undefined
        : await keychain.readSecret(profile.keychainService, profile.keychainAccount);
      const compatProxy =
        !isLocalShellCommand(command) &&
        profile.toolType === 'claude' &&
        profile.claudeAnthropicCompatProxyEnabled === true
          ? await startClaudeCompatProxy({
              upstreamBaseUrl: profile.baseUrl,
              profileId: profile.id,
              sessionId: session.id,
            })
          : undefined;
      if (compatProxy) {
        claudeCompatProxies.set(session.id, compatProxy);
      }
      const baseEnv = isLocalShellCommand(command)
        ? {}
        : buildLaunchEnvironment({
            profile,
            secret: secret ?? '',
            appDataPath,
            homeDir,
            anthropicBaseUrl: compatProxy?.baseUrl,
          });
```

In every cleanup path call `void closeClaudeCompatProxy(session.id)` or `await closeClaudeCompatProxy(session.id)`:

```ts
        void closeClaudeCompatProxy(session.id);
```

Place it in:

- `catch` block inside `startSessionPty`
- `onExit` handler before releasing runtime owner
- `killTerminal`
- `deleteSessionRecord`
- `dispose`

- [ ] **Step 4: Run focused SessionService tests**

Run:

```bash
npx vitest run tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts -t "compat proxy|compat proxy secrets|session-local Claude"
```

Expected: PASS.

## Task 6: API Config UI

**Files:**
- Modify: `src/renderer/components/ApiConfigPanel.tsx`
- Test: `tests/app/App.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add to `tests/app/App.test.tsx` in the API profile editing describe block:

```ts
it('edits and saves the Claude Anthropic compat proxy flag', async () => {
  const api = createMockApi({
    listProfiles: vi.fn().mockResolvedValue([
      {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeAnthropicCompatProxyEnabled: false,
      },
    ]),
    saveProfile: vi.fn(async (profile: ApiProfile) => profile),
  });
  vi.stubGlobal('agentDock', api);

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'API 配置' }));
  fireEvent.click(await screen.findByRole('button', { name: '显示高级设置' }));
  const checkbox = await screen.findByLabelText('启用 Anthropic 兼容改写');

  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => {
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        claudeAnthropicCompatProxyEnabled: true,
      }),
    );
  });
});

it('does not save the Claude compat proxy flag on Codex profiles', async () => {
  const api = createMockApi({
    listProfiles: vi.fn().mockResolvedValue([
      {
        id: 'codex-a',
        name: 'Codex A',
        toolType: 'codex',
        baseUrl: 'https://openai.example/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'codex-a',
      },
    ]),
    saveProfile: vi.fn(async (profile: ApiProfile) => profile),
  });
  vi.stubGlobal('agentDock', api);

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'API 配置' }));
  fireEvent.click(await screen.findByRole('button', { name: '显示高级设置' }));

  expect(screen.queryByLabelText('启用 Anthropic 兼容改写')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

  await waitFor(() => {
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.not.objectContaining({
        claudeAnthropicCompatProxyEnabled: expect.anything(),
      }),
    );
  });
});
```

- [ ] **Step 2: Run UI tests to verify RED**

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "Anthropic compat proxy"
```

Expected: FAIL because the checkbox is absent.

- [ ] **Step 3: Add UI field and save mapping**

In `createNewProfileDraft`, no default true value is added. Leave field absent for new profiles.

In submit payload near Claude network booleans:

```ts
        claudeAnthropicCompatProxyEnabled:
          draft.toolType === 'claude'
            ? draft.claudeAnthropicCompatProxyEnabled
            : undefined,
```

In the Claude “网络与请求” advanced option list, add:

```tsx
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              aria-label="启用 Anthropic 兼容改写"
                              checked={draft.claudeAnthropicCompatProxyEnabled ?? false}
                              onChange={(event) =>
                                updateDraft(
                                  'claudeAnthropicCompatProxyEnabled',
                                  event.target.checked,
                                )
                              }
                            />
                            <span>启用 Anthropic 兼容改写</span>
                            <small className="field-help">
                              为此 Profile 的 Claude 会话创建独立本地改写代理。
                            </small>
                          </label>
```

- [ ] **Step 4: Run focused UI tests**

Run:

```bash
npx vitest run tests/app/App.test.tsx -t "Anthropic compat proxy"
```

Expected: PASS.

## Task 7: Integration Tests and Secret Boundaries

**Files:**
- Test: `tests/app/claudeCompatProxy.test.ts`
- Test: `tests/app/sessionService.test.ts`
- Test: `tests/app/sessionSecurity.test.ts`
- Test: `tests/app/App.test.tsx`
- Test: `tests/app/preloadTypes.test.ts`

- [ ] **Step 1: Run all focused tests for the feature**

Run:

```bash
npx vitest run tests/app/claudeCompatProxy.test.ts tests/app/configMigration.test.ts tests/app/claudeProfileDefaults.test.ts tests/app/launchEnvironment.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts tests/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full app test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: PASS with only existing Vite chunk size warning if present.

- [ ] **Step 5: Secret scan for feature files**

Run:

```bash
rg -n "test-agentdock-proxy-secret|local-development-secret|Authorization|ANTHROPIC_AUTH_TOKEN|Bearer " src/main/claudeCompatProxy.ts src/main/sessionService.ts tests/app/claudeCompatProxy.test.ts tests/app/sessionService.test.ts tests/app/sessionSecurity.test.ts
```

Expected: Only test fixture strings and environment variable names appear; no real API key appears.

## Task 8: L3 Real Verification

**Files:**
- Create: `.agent-workflow/verification/2026-07-08-claude-compat-proxy.md`
- Modify: `.agent-workflow/state.md`

- [ ] **Step 1: Run required workflow gates**

Run:

```bash
npm run workflow:doctor
npm run test:workflow
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 2: Run local proxy smoke with two fake upstreams**

Use the `claudeCompatProxy` test server pattern to run a local one-shot script against `dist/main/claudeCompatProxy.js` after build. The smoke must prove:

- proxy A forwards to upstream A
- proxy B forwards to upstream B
- request body receives thinking/beta rewrite
- logs do not include `Authorization` or test secret

Run command after implementation:

```bash
node scripts/smoke-claude-compat-proxy.mjs
```

Expected: PASS output including `CLAUDE_COMPAT_PROXY_SMOKE_PASS`. If creating a smoke script is not desired, run an equivalent `node --input-type=module` one-liner and paste the command/output into verification.

- [ ] **Step 3: Run real Claude endpoint verification when user allows local API usage**

Manual verification steps:

1. Open AgentDock dev app or packaged app.
2. Configure Claude Profile A with `claudeAnthropicCompatProxyEnabled=true` and endpoint A.
3. Configure Claude Profile B with `claudeAnthropicCompatProxyEnabled=true` and endpoint B.
4. Start both Claude sessions in the same workspace.
5. Change external `~/.anyrouter/current-upstream`.
6. Send a minimal prompt in each session that triggers `/v1/messages`.
7. Confirm each session still uses its own configured endpoint.

Expected: both sessions work independently; no session follows the external global AnyRouter upstream.

- [ ] **Step 4: Write verification record**

Create `.agent-workflow/verification/2026-07-08-claude-compat-proxy.md`:

```markdown
# Claude Compat Proxy Verification

## Scope
Claude Profile 内置 Anthropic 兼容改写层。

## Commands
- `npm run workflow:doctor` — PASS
- `npm run test:workflow` — PASS
- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run build` — PASS

## Real Verification
- Local two-upstream proxy smoke: PASS
- Real Claude endpoint smoke: PASS / PARTIAL with reason

## Secret Boundary
日志、UI、session payload、verification record 未包含完整 API Key、完整 Authorization header、完整请求正文或完整响应正文。

## Result
PASS / PARTIAL
```

Replace `PASS / PARTIAL` with the actual result before delivery.

## Task 9: Workflow Delivery Preparation

**Files:**
- Modify: `.agent-workflow/state.md`
- Create: `.agent-workflow/delivery/2026-07-08-claude-compat-proxy-delivery-report.md`

- [ ] **Step 1: Update workflow state**

Set:

```markdown
## 当前任务
2026-07-08 AgentDock Claude Profile 内置 Anthropic 兼容改写层：实现、验证和交付完成。

## 当前 Hook
delivery_hook

## 当前阶段
delivery

## 用户待确认
无

## 下一步
等待用户验收或选择是否打包发布。
```

- [ ] **Step 2: Create delivery report**

Create `.agent-workflow/delivery/2026-07-08-claude-compat-proxy-delivery-report.md` with:

```markdown
# Claude Compat Proxy Delivery Report

## 任务等级
L3

## 修改范围
- Claude Profile 字段：`claudeAnthropicCompatProxyEnabled`
- Main process：session 专属 loopback compat proxy
- SessionService：启动、退出、停止、删除、dispose 生命周期清理
- Renderer：Claude API 配置高级开关

## 验证命令
- `npm run workflow:doctor`
- `npm run test:workflow`
- `npm test`
- `npm run typecheck`
- `npm run build`

## 真实验证
见 `.agent-workflow/verification/2026-07-08-claude-compat-proxy.md`。

## 安全结论
未新增生产依赖；未向 Renderer/IPC 暴露完整 secret/env；日志和报告不包含完整 API Key、Authorization header、完整请求正文或完整响应正文。

## 交付结论
可交付 / 有条件交付
```

- [ ] **Step 3: Final diff check**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: `git diff --check` no output. `git status` shows only intended files.

## Self-Review

- Spec coverage: Tasks 1-2 cover thinking/beta rewrite and local loopback proxy; Task 3 covers Profile field persistence; Task 4-5 cover environment injection and lifecycle; Task 6 covers UI; Task 7-9 cover validation, L3 real verification and delivery.
- Dependency check: plan uses Node built-ins only; no package manager or lockfile changes.
- Security check: proxy logs only metadata; tests assert secret does not appear in logs/session payloads.
- Boundary check: Codex path is untouched except shared `ApiProfile` type compatibility; local shell commands skip proxy.
