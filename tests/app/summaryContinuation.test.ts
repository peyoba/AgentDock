import { describe, expect, it, vi } from 'vitest';
import { launchContinuationWithPrompt } from '../../src/main/summaryContinuation';
import type { SessionService } from '../../src/main/sessionService';
import type { AgentSession, ApiProfile, Workspace } from '../../src/shared/agentdockTypes';

const profile: ApiProfile = {
  id: 'profile-a',
  name: 'Claude A',
  toolType: 'claude',
  baseUrl: 'https://example.invalid/v1',
  keychainService: 'AgentDock',
  keychainAccount: 'profile-a',
};

const workspace: Workspace = {
  id: 'workspace-a',
  name: 'AgentDock',
  path: '/Users/example/Desktop/web/AgentDock',
};

const sourceSession: AgentSession = {
  id: 'session-1',
  title: 'Claude A · AgentDock',
  profileId: 'profile-a',
  workspaceId: 'workspace-a',
  command: 'claude --dangerously-skip-permissions',
  claudeLaunchMode: 'lite',
  status: 'running',
  startedAt: '2026-07-06T00:00:00.000Z',
};

const continuationSession: AgentSession = {
  ...sourceSession,
  id: 'session-2',
  startedAt: '2026-07-06T00:01:00.000Z',
};

function createFakeService(): SessionService {
  return {
    launch: vi.fn().mockResolvedValue(continuationSession),
    writeTerminal: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionService;
}

describe('launchContinuationWithPrompt', () => {
  it('launches the continuation session and sends the handoff prompt to its terminal', async () => {
    const service = createFakeService();

    const result = await launchContinuationWithPrompt({
      service,
      profile,
      workspace,
      sourceSession,
      handoffPrompt: [
        'Read the AgentDock handoff first, then continue the task:',
        '/Users/example/Desktop/web/AgentDock/.agentdock/context/handoffs/session-1.md',
      ].join('\n'),
    });

    expect(result).toEqual(continuationSession);
    expect(service.launch).toHaveBeenCalledWith({
      profile,
      workspace,
      command: sourceSession.command,
      claudeLaunchMode: 'lite',
    });
    expect(service.writeTerminal).toHaveBeenCalledWith({
      sessionId: continuationSession.id,
      input:
        'Read the AgentDock handoff first, then continue the task: /Users/example/Desktop/web/AgentDock/.agentdock/context/handoffs/session-1.md\r',
    });
  });
});
