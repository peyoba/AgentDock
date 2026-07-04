import os from 'node:os';
import path from 'node:path';
import type { ApiProfile } from '../shared/agentdockTypes.js';
import {
  normalizeAnthropicBetas,
  normalizeProxyUrl,
} from '../shared/claudeProfileDefaults.js';

type BuildLaunchEnvironmentInput = {
  profile: ApiProfile;
  secret: string;
  appDataPath: string;
  homeDir?: string;
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

export function buildClaudeOptionalEnvironment(profile: ApiProfile): Record<string, string> {
  const env: Record<string, string> = {};

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
}: BuildLaunchEnvironmentInput): Record<string, string> {
  if (profile.toolType === 'claude') {
    return {
      ANTHROPIC_BASE_URL: profile.baseUrl,
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

  return {};
}
