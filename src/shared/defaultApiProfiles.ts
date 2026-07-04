import type { ApiProfile } from './agentdockTypes.js';
import {
  ANYROUTER_CLAUDE_BETA,
  ANYROUTER_CLAUDE_HAIKU_MODEL,
  ANYROUTER_CLAUDE_OPUS_MODEL,
  ANYROUTER_CLAUDE_PRIMARY_MODEL,
  ANYROUTER_CLAUDE_SONNET_MODEL,
} from './claudeProfileDefaults.js';

export const defaultApiProfiles: ApiProfile[] = [
  {
    id: 'claude-anyrouter',
    name: 'Claude · AnyRouter A',
    toolType: 'claude',
    baseUrl: 'https://anyrouter.top',
    defaultModel: ANYROUTER_CLAUDE_PRIMARY_MODEL,
    claudeHaikuModel: ANYROUTER_CLAUDE_HAIKU_MODEL,
    claudeSonnetModel: ANYROUTER_CLAUDE_SONNET_MODEL,
    claudeOpusModel: ANYROUTER_CLAUDE_OPUS_MODEL,
    claudeDefaultLaunchMode: 'default',
    keychainService: 'AgentDock',
    keychainAccount: 'claude-anyrouter',
    skipPermissions: true,
    claudeCodeRetryWatchdog: true,
    claudeCodeMaxRetries: 100,
    anthropicBetas: ANYROUTER_CLAUDE_BETA,
    claudeCodeDisableNonessentialTraffic: true,
    claudeCodeAttributionHeader: '0',
    disableInstallationChecks: true,
    claudeCleanupPeriodDays: 720,
  },
  {
    id: 'codex-openai',
    name: 'Codex · AnyRouter',
    toolType: 'codex',
    baseUrl: 'https://anyrouter.top/v1',
    defaultModel: 'gpt-5-codex',
    keychainService: 'AgentDock',
    keychainAccount: 'codex-openai',
    codexHome: '~/.agentdock/codex-profiles/codex-openai',
    bypassApprovals: true,
  },
];

export function isDefaultApiProfileId(profileId: string): boolean {
  return defaultApiProfiles.some((profile) => profile.id === profileId);
}
