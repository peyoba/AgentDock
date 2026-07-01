import path from 'node:path';
import type { ApiProfile } from '../shared/agentdockTypes.js';

type BuildLaunchEnvironmentInput = {
  profile: ApiProfile;
  secret: string;
  appDataPath: string;
};

export function buildLaunchEnvironment({
  profile,
  secret,
  appDataPath,
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
      CODEX_HOME:
        profile.codexHome ??
        path.join(appDataPath, 'codex-profiles', profile.id),
    };
  }

  return {};
}
