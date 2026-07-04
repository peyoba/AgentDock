import type { ApiProfile } from './agentdockTypes.js';

export const ANYROUTER_CLAUDE_DEFAULT_MODEL = 'claude-fable-5';
export const ANYROUTER_CLAUDE_BETA = 'context-1m-2025-08-07';
const LEGACY_ONE_MILLION_MODEL_ALIAS = 'opus[1m]';

function optionalTrimmedString(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function uniqueModelList(models: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const model of models) {
    const normalized = model.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function isLegacyOneMillionModelAlias(model: string | undefined): boolean {
  return optionalTrimmedString(model) === LEGACY_ONE_MILLION_MODEL_ALIAS;
}

function selectableClaudeModels(models: string[] | undefined): string[] {
  return uniqueModelList(
    (models ?? []).filter((model) => !isLegacyOneMillionModelAlias(model)),
  );
}

function defaultSelectableClaudeModel(
  model: string | undefined,
  models: string[],
  useAnyRouterDefaults: boolean,
): string | undefined {
  const trimmedModel = optionalTrimmedString(model);
  if (trimmedModel && !isLegacyOneMillionModelAlias(trimmedModel)) {
    return trimmedModel;
  }

  if (trimmedModel && isLegacyOneMillionModelAlias(trimmedModel)) {
    return (
      models.find((availableModel) => availableModel === ANYROUTER_CLAUDE_DEFAULT_MODEL) ??
      models.find((availableModel) => availableModel.toLowerCase().includes('opus')) ??
      models[0] ??
      ANYROUTER_CLAUDE_DEFAULT_MODEL
    );
  }

  return useAnyRouterDefaults ? ANYROUTER_CLAUDE_DEFAULT_MODEL : undefined;
}

function isAnthropicBetaToken(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
}

export function normalizeAnthropicBetas(
  value: string | undefined,
  requireAnyRouterOneMillionContext = false,
): string | undefined {
  const tokens = (optionalTrimmedString(value) ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token && isAnthropicBetaToken(token));

  const normalized = uniqueModelList(tokens);
  if (
    requireAnyRouterOneMillionContext &&
    !normalized.includes(ANYROUTER_CLAUDE_BETA)
  ) {
    normalized.unshift(ANYROUTER_CLAUDE_BETA);
  }

  return normalized.length > 0 ? normalized.join(',') : undefined;
}

export function normalizeProxyUrl(value: string | undefined): string | undefined {
  const trimmedValue = optionalTrimmedString(value);
  if (!trimmedValue) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
      ? trimmedValue
      : undefined;
  } catch {
    return undefined;
  }
}

export function isAnyRouterClaudeProfile(profile: ApiProfile): boolean {
  if (profile.toolType !== 'claude') {
    return false;
  }

  const name = profile.name.toLowerCase();
  const baseUrl = profile.baseUrl.toLowerCase();

  return (
    name.includes('anyrouter') ||
    baseUrl.includes('anyrouter.top') ||
    baseUrl.includes('fcapp.run')
  );
}

export function normalizeClaudeProfileDefaults(profile: ApiProfile): ApiProfile {
  if (profile.toolType !== 'claude') {
    return profile;
  }

  const useAnyRouterDefaults = isAnyRouterClaudeProfile(profile);
  const anthropicBetas = normalizeAnthropicBetas(
    profile.anthropicBetas,
    useAnyRouterDefaults,
  );
  const httpProxy = normalizeProxyUrl(profile.httpProxy);
  const httpsProxy = normalizeProxyUrl(profile.httpsProxy);
  const availableModels = useAnyRouterDefaults
    ? selectableClaudeModels(profile.availableModels)
    : profile.availableModels;
  const defaultModel = defaultSelectableClaudeModel(
    profile.defaultModel,
    availableModels ?? [],
    useAnyRouterDefaults,
  );

  return {
    ...profile,
    defaultModel,
    availableModels: availableModels && availableModels.length > 0 ? availableModels : undefined,
    anthropicBetas,
    httpProxy,
    httpsProxy,
  };
}
