import os from 'node:os';
import path from 'node:path';
import type { ApiProfile } from '../shared/agentdockTypes.js';
import {
  normalizeAnthropicBetas,
  normalizeProxyUrl,
} from '../shared/claudeProfileDefaults.js';
import { isDefaultGrokBaseUrl } from '../shared/grokProfileDefaults.js';

type BuildLaunchEnvironmentInput = {
  profile: ApiProfile;
  secret: string;
  appDataPath: string;
  homeDir?: string;
  anthropicBaseUrl?: string;
};

function expandHomePath(pathValue: string, homeDir: string): string {
  if (pathValue === '~') {
    return homeDir;
  }

  if (pathValue.startsWith('~/')) {
    return path.join(homeDir, pathValue.slice(2));
  }

  return pathValue;
}

function resolveGrokHome({
  profile,
  appDataPath,
  homeDir,
}: {
  profile: ApiProfile;
  appDataPath: string;
  homeDir: string;
}): string {
  return expandHomePath(
    profile.grokHome ?? path.join(appDataPath, 'grok-profiles', profile.id),
    homeDir,
  );
}

function resolveCodexHome({
  profile,
  appDataPath,
  homeDir,
}: {
  profile: ApiProfile;
  appDataPath: string;
  homeDir: string;
}): string {
  return expandHomePath(
    profile.codexHome ?? path.join(appDataPath, 'codex-profiles', profile.id),
    homeDir,
  );
}

function optionalTrimmedString(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function buildClaudeModelEnvironment(profile: ApiProfile): Record<string, string> {
  const env: Record<string, string> = {};
  const primaryModel = optionalTrimmedString(profile.defaultModel);
  const haikuModel = optionalTrimmedString(profile.claudeHaikuModel);
  const sonnetModel = optionalTrimmedString(profile.claudeSonnetModel);
  const opusModel = optionalTrimmedString(profile.claudeOpusModel);

  if (primaryModel) {
    env.ANTHROPIC_MODEL = primaryModel;
  }
  if (haikuModel) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel;
  }
  if (sonnetModel) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel;
  }
  if (opusModel) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel;
  }

  return env;
}

export function buildClaudeOptionalEnvironment(profile: ApiProfile): Record<string, string> {
  const env: Record<string, string> = {
    ...buildClaudeModelEnvironment(profile),
  };

  if (profile.claudeCodeRetryWatchdog === true) {
    env.CLAUDE_CODE_RETRY_WATCHDOG = '1';
  }

  if (
    typeof profile.claudeCodeMaxRetries === 'number' &&
    Number.isFinite(profile.claudeCodeMaxRetries) &&
    profile.claudeCodeMaxRetries > 0
  ) {
    env.CLAUDE_CODE_MAX_RETRIES = String(Math.trunc(profile.claudeCodeMaxRetries));
  }

  const anthropicBetas = normalizeAnthropicBetas(profile.anthropicBetas);
  if (anthropicBetas) {
    env.ANTHROPIC_BETAS = anthropicBetas;
  }

  const httpProxy = normalizeProxyUrl(profile.httpProxy);
  if (httpProxy) {
    env.HTTP_PROXY = httpProxy;
  }

  const httpsProxy = normalizeProxyUrl(profile.httpsProxy);
  if (httpsProxy) {
    env.HTTPS_PROXY = httpsProxy;
  }

  if (profile.claudeCodeDisableNonessentialTraffic === true) {
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  }

  const attributionHeader = optionalTrimmedString(profile.claudeCodeAttributionHeader);
  if (attributionHeader) {
    env.CLAUDE_CODE_ATTRIBUTION_HEADER = attributionHeader;
  }

  if (profile.disableInstallationChecks === true) {
    env.DISABLE_INSTALLATION_CHECKS = '1';
  }

  return env;
}

export function buildLaunchEnvironment({
  profile,
  secret,
  appDataPath,
  homeDir = os.homedir(),
  anthropicBaseUrl,
}: BuildLaunchEnvironmentInput): Record<string, string> {
  if (profile.toolType === 'claude') {
    return {
      ANTHROPIC_BASE_URL: anthropicBaseUrl ?? profile.baseUrl,
      ANTHROPIC_AUTH_TOKEN: secret,
      ...buildClaudeOptionalEnvironment(profile),
    };
  }

  if (profile.toolType === 'codex') {
    return {
      OPENAI_BASE_URL: profile.baseUrl,
      OPENAI_API_KEY: secret,
      CODEX_HOME: resolveCodexHome({ profile, appDataPath, homeDir }),
    };
  }

  if (profile.toolType === 'grok') {
    const env: Record<string, string> = {
      GROK_HOME: resolveGrokHome({ profile, appDataPath, homeDir }),
    };

    if (profile.grokAuthMode !== 'oauth') {
      env.XAI_API_KEY = secret;
    }

    if (!isDefaultGrokBaseUrl(profile.baseUrl)) {
      const normalizedBaseUrl = profile.baseUrl.trim().replace(/\/+$/, '');
      env.GROK_CLI_CHAT_PROXY_BASE_URL = normalizedBaseUrl;
      env.GROK_MODELS_BASE_URL = normalizedBaseUrl;
    }

    return env;
  }

  return {};
}
