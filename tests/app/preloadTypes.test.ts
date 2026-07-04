import { describe, expect, it } from 'vitest';
import { AGENT_DOCK_API_METHODS } from '../../src/shared/preloadTypes';
import type { AgentDockApi } from '../../src/shared/preloadTypes';

describe('preloadTypes', () => {
  it('documents required renderer API methods', () => {
    const methodNames = [
      'version',
      'listProfiles',
      'listWorkspaces',
      'chooseWorkspace',
      'saveProfile',
      'deleteProfile',
      'saveProfileSecret',
      'readProfileSecret',
      'fetchProfileModels',
      'launchSession',
      'listSessions',
      'writeTerminal',
      'resizeTerminal',
      'killTerminal',
      'readTerminalBuffer',
      'onTerminalOutput',
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
});
