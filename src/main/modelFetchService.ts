import type { ApiProfile } from '../shared/agentdockTypes.js';
import type { KeychainAdapter } from './adapters/keychainAdapter.js';

type FetchProfileModelsInput = {
  profile: ApiProfile;
  secretAdapter: KeychainAdapter;
  fetchImpl?: typeof fetch;
};

type ModelListShape = {
  data?: unknown;
  models?: unknown;
};

const MODEL_FETCH_TIMEOUT_MS = 10_000;

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function buildModelEndpointCandidates(baseUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Base URL 无效，无法解析：${baseUrl}`);
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  const basePath = pathname === '/' ? '' : pathname;
  const originAndPath = `${url.origin}${basePath}`;
  const candidates = basePath.endsWith('/v1')
    ? [`${originAndPath}/models`]
    : [`${originAndPath}/v1/models`, `${originAndPath}/models`];

  return unique(candidates);
}

function buildHeaders(profile: ApiProfile, secret: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${secret}`,
  };

  if (profile.toolType === 'claude') {
    headers['x-api-key'] = secret;
    headers['anthropic-version'] = '2023-06-01';
  }

  return headers;
}

function safeHttpError(status: number, statusText: string): Error {
  const suffix = statusText ? ` ${statusText}` : '';
  return new Error(`无法拉取模型列表: ${status}${suffix}`);
}

function readModelId(item: unknown): string | undefined {
  if (typeof item === 'string') {
    return item;
  }

  if (!item || typeof item !== 'object') {
    return undefined;
  }

  const candidate = item as { id?: unknown; name?: unknown };
  if (typeof candidate.id === 'string') {
    return candidate.id;
  }

  if (typeof candidate.name === 'string') {
    return candidate.name;
  }

  return undefined;
}

function extractModelIds(payload: unknown): string[] {
  const candidate = payload as ModelListShape;
  const list = Array.isArray(candidate?.data)
    ? candidate.data
    : Array.isArray(candidate?.models)
      ? candidate.models
      : Array.isArray(payload)
        ? payload
        : [];

  return unique(list.map(readModelId).filter((model): model is string => Boolean(model)));
}

export async function fetchProfileModels({
  profile,
  secretAdapter,
  fetchImpl = fetch,
}: FetchProfileModelsInput): Promise<string[]> {
  let secret: string;
  try {
    secret = await secretAdapter.readSecret(profile.keychainService, profile.keychainAccount);
  } catch (error) {
    if (
      profile.toolType === 'grok' &&
      profile.grokAuthMode === 'oauth' &&
      error instanceof Error &&
      /Keychain secret was not found for account|local API key vault entry was not found/i.test(
        error.message,
      )
    ) {
      throw new Error('OAuth 模式未配置 API Key，无法从 AgentDock 拉取模型列表');
    }
    throw error;
  }

  if (!secret.trim() && profile.toolType === 'grok' && profile.grokAuthMode === 'oauth') {
    throw new Error('OAuth 模式未配置 API Key，无法从 AgentDock 拉取模型列表');
  }

  const endpoints = buildModelEndpointCandidates(profile.baseUrl);
  const headers = buildHeaders(profile, secret);

  for (const [index, endpoint] of endpoints.entries()) {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('拉取模型列表超时，请检查 Endpoint 地址和网络连接');
      }
      throw error;
    }

    if (!response.ok) {
      const canTryNext = (response.status === 404 || response.status === 405) && index < endpoints.length - 1;
      if (canTryNext) {
        continue;
      }
      throw safeHttpError(response.status, response.statusText);
    }

    const payload = (await response.json().catch(() => undefined)) as unknown;
    const models = extractModelIds(payload);
    if (models.length === 0) {
      throw new Error('模型列表为空，无法获取有效的模型标识符');
    }

    return models;
  }

  throw new Error('无法拉取模型列表');
}
