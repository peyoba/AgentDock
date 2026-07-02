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
  const url = new URL(baseUrl);
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
  return new Error(`Unable to fetch model list: ${status}${suffix}`);
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
  const secret = await secretAdapter.readSecret(profile.keychainService, profile.keychainAccount);
  const endpoints = buildModelEndpointCandidates(profile.baseUrl);
  const headers = buildHeaders(profile, secret);

  for (const [index, endpoint] of endpoints.entries()) {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers,
    });

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
      throw new Error('Model list response did not include model IDs');
    }

    return models;
  }

  throw new Error('Unable to fetch model list');
}
