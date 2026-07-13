import { describe, expect, it } from 'vitest';
import { AGENT_DOCK_API_METHODS } from '../../src/shared/preloadTypes';
import type { AgentDockApi } from '../../src/shared/preloadTypes';
import type { CodexLaunchMode } from '../../src/shared/agentdockTypes';

describe('preloadTypes', () => {
  it('documents required renderer API methods', () => {
    const methodNames = [
      'version',
      'getBuildInfo',
      'checkForUpdates',
      'openUpdateDownload',
      'listProfiles',
      'listWorkspaces',
      'chooseWorkspace',
      'saveProfile',
      'deleteProfile',
      'saveProfileSecret',
      'readProfileSecret',
      'fetchProfileModels',
      'launchSession',
      'restartSession',
      'listSessions',
      'closeSessionView',
      'archiveSessionRecord',
      'deleteSessionRecord',
      'writeTerminal',
      'resizeTerminal',
      'killTerminal',
      'readTerminalBuffer',
      'archiveSessionHistory',
      'getSessionContextPressure',
      'summarizeSession',
      'onTerminalOutput',
      'onSessionChanged',
      'listWorkspaceDirectory',
      'readWorkspaceContext',
      'openWorkspaceContextFolder',
      'openNewWindow',
      'onMetadataChanged',
    ] satisfies Array<keyof AgentDockApi | 'saveProfile'>;

    expect(AGENT_DOCK_API_METHODS).toEqual(methodNames);
  });

  it('only exposes an explicit profile-secret read path and no raw secret/env APIs', () => {
    expect(AGENT_DOCK_API_METHODS).toContain('readProfileSecret');
    expect(AGENT_DOCK_API_METHODS).not.toContain('readSecret');
    expect(AGENT_DOCK_API_METHODS).not.toContain('getEnv');
    expect(AGENT_DOCK_API_METHODS).not.toContain('listEnvironment');
  });

  it('carries the selected Codex launch mode through launch and restart requests', () => {
    const supportedModes: CodexLaunchMode[] = ['native-responses', 'newapi-tool-compatible'];
    const launchRequest: Parameters<AgentDockApi['launchSession']>[0] = {
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'codex --no-alt-screen',
      codexLaunchMode: 'newapi-tool-compatible',
    };
    const restartRequest: Parameters<AgentDockApi['restartSession']>[0] = {
      sessionId: 'session-a',
      strategy: 'resume',
      command: 'codex --no-alt-screen',
      codexLaunchMode: 'native-responses',
    };

    expect(launchRequest.codexLaunchMode).toBe('newapi-tool-compatible');
    expect(restartRequest.codexLaunchMode).toBe('native-responses');
    expect(supportedModes).toEqual(['native-responses', 'newapi-tool-compatible']);
  });
});
