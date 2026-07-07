import type { AgentSession, ApiProfile, Workspace } from '../shared/agentdockTypes.js';
import type { SessionService } from './sessionService.js';

export type LaunchContinuationWithPromptInput = {
  service: SessionService;
  profile: ApiProfile;
  workspace: Workspace;
  sourceSession: AgentSession;
  handoffPrompt: string;
};

export async function launchContinuationWithPrompt({
  service,
  profile,
  workspace,
  sourceSession,
  handoffPrompt,
}: LaunchContinuationWithPromptInput): Promise<AgentSession> {
  const continuationSession = await service.launch({
    profile,
    workspace,
    command: sourceSession.command,
    claudeLaunchMode:
      profile.toolType === 'claude' ? sourceSession.claudeLaunchMode : undefined,
  });

  await service.writeTerminal({
    sessionId: continuationSession.id,
    input: continuationPromptTerminalInput(handoffPrompt),
  });

  return continuationSession;
}

function continuationPromptTerminalInput(handoffPrompt: string): string {
  return `${handoffPrompt.replace(/\s+/g, ' ').trim()}\r`;
}
