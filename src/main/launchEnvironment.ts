import os from 'node:os';
import path from 'node:path';
import type { ApiProfile } from '../shared/agentdockTypes.js';

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
