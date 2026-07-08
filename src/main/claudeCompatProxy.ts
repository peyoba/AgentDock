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
