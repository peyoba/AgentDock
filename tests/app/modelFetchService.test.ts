import { describe, expect, it, vi } from 'vitest';
import { fetchProfileModels } from '../../src/main/modelFetchService';
import type { KeychainAdapter } from '../../src/main/adapters/keychainAdapter';
import type { ApiProfile } from '../../src/shared/agentdockTypes';

const secret = 'test-agentdock-fetch-models-secret';

const codexProfile: ApiProfile = {
  id: 'codex-a',
  name: 'Codex A',
  toolType: 'codex',
  baseUrl: 'https://provider.example/v1',
  defaultModel: 'gpt-5-codex',
  keychainService: 'AgentDock',
  keychainAccount: 'codex-a',
};

function createSecretAdapter(): KeychainAdapter {
  return {
    async readSecret(service, account) {
      expect(service).toBe('AgentDock');
      expect(account).toBe('codex-a');
      return secret;
    },
    async writeSecret() {},
    async deleteSecret() {},
  };
}

describe('modelFetchService', () => {
  it('fetches OpenAI-compatible model IDs using the stored secret in main only', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'gpt-5-codex' }, { id: 'gpt-4o' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      fetchProfileModels({
        profile: codexProfile,
        secretAdapter: createSecretAdapter(),
        fetchImpl,
      }),
    ).resolves.toEqual(['gpt-5-codex', 'gpt-4o']);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://provider.example/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${secret}`,
        }),
      }),
    );
  });

  it('does not append duplicate /v1 when the configured endpoint already ends with /v1', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), { status: 200 }),
    );

    await fetchProfileModels({
      profile: { ...codexProfile, baseUrl: 'https://provider.example/v1' },
      secretAdapter: createSecretAdapter(),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://provider.example/v1/models',
      expect.any(Object),
    );
    expect(fetchImpl).not.toHaveBeenCalledWith(
      'https://provider.example/v1/v1/models',
      expect.any(Object),
    );
  });

  it('returns a safe error message without API key, headers, or provider body details', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: `Incorrect API key ${secret}` }), {
        status: 401,
        statusText: 'Unauthorized',
      }),
    );

    let thrown: unknown;
    try {
      await fetchProfileModels({
        profile: codexProfile,
        secretAdapter: createSecretAdapter(),
        fetchImpl,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('无法拉取模型列表: 401 Unauthorized');
    expect((thrown as Error).message).not.toContain(secret);
    expect((thrown as Error).message).not.toContain('Authorization');
    expect((thrown as Error).message).not.toContain('Incorrect API key');
  });

  it('rejects invalid base URLs with a Chinese error before any network request', async () => {
    const fetchImpl = vi.fn();

    await expect(
      fetchProfileModels({
        profile: { ...codexProfile, baseUrl: 'not-a-valid-url' },
        secretAdapter: createSecretAdapter(),
        fetchImpl,
      }),
    ).rejects.toThrow('Base URL 无效，无法解析：not-a-valid-url');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('applies a request timeout and reports it in Chinese', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    const fetchImpl = vi.fn(async () => {
      throw timeoutError;
    });

    await expect(
      fetchProfileModels({
        profile: codexProfile,
        secretAdapter: createSecretAdapter(),
        fetchImpl,
      }),
    ).rejects.toThrow('拉取模型列表超时，请检查 Endpoint 地址和网络连接');

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://provider.example/v1/models',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
