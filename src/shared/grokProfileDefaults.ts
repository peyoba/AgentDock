export const DEFAULT_GROK_BASE_URL = 'https://api.x.ai/v1';
export const DEFAULT_GROK_MODEL = 'grok-build';

export function defaultGrokHomePath(profileId: string): string {
  const normalizedId = profileId.trim();
  if (!normalizedId) {
    throw new Error('Grok profile id is required to build GROK_HOME');
  }
  return `~/.agentdock/grok-profiles/${normalizedId}`;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function isDefaultGrokBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) {
    return false;
  }
  return normalizeBaseUrl(baseUrl) === normalizeBaseUrl(DEFAULT_GROK_BASE_URL);
}
