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
      'saveProfileSecret',
      'launchSession',
      'listSessions',
      'writeTerminal',
      'resizeTerminal',
      'killTerminal',
      'readTerminalBuffer',
      'onTerminalOutput',
    ] satisfies Array<keyof AgentDockApi | 'saveProfile'>;

    expect(AGENT_DOCK_API_METHODS).toEqual(methodNames);
  });

  it('does not expose full secrets or full environment snapshots through the renderer API', () => {
    expect(AGENT_DOCK_API_METHODS).not.toContain('readSecret');
    expect(AGENT_DOCK_API_METHODS).not.toContain('getEnv');
    expect(AGENT_DOCK_API_METHODS).not.toContain('listEnvironment');
  });
});
