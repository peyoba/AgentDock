import { describe, expect, it } from 'vitest';
import { AGENT_DOCK_API_METHODS } from '../../src/shared/preloadTypes';
import type { AgentDockApi } from '../../src/shared/preloadTypes';

describe('terminal IPC renderer API contract', () => {
  it('exposes terminal input, resize, kill, and output subscription methods only through the whitelist', () => {
    const terminalMethods = [
      'writeTerminal',
      'resizeTerminal',
      'killTerminal',
      'onTerminalOutput',
    ] satisfies Array<keyof AgentDockApi>;

    for (const method of terminalMethods) {
      expect(AGENT_DOCK_API_METHODS).toContain(method);
    }
  });

  it('does not expose complete secret or environment IPC helpers', () => {
    expect(AGENT_DOCK_API_METHODS).not.toContain('readSecret');
    expect(AGENT_DOCK_API_METHODS).not.toContain('getEnv');
    expect(AGENT_DOCK_API_METHODS).not.toContain('listEnvironment');
    expect(AGENT_DOCK_API_METHODS).not.toContain('getTerminalEnvironment');
  });
});
