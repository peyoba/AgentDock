import type { AgentSession, ApiProfile, Workspace } from '../shared/agentdockTypes.js';

type Clock = {
  now(): Date;
};

type LaunchSessionInput = {
  profile: ApiProfile;
  workspace: Workspace;
  command: string;
};

export type SessionService = {
  launch(input: LaunchSessionInput): Promise<AgentSession>;
  list(): Promise<AgentSession[]>;
};

export function createSessionService(clock: Clock = { now: () => new Date() }): SessionService {
  const sessions: AgentSession[] = [];

  return {
    async launch({ profile, workspace, command }: LaunchSessionInput): Promise<AgentSession> {
      const session: AgentSession = {
        id: `session-${sessions.length + 1}`,
        title: `${profile.name} · ${workspace.name}`,
        profileId: profile.id,
        workspaceId: workspace.id,
        command,
        status: 'starting',
        startedAt: clock.now().toISOString(),
      };

      sessions.push(session);
      return session;
    },

    async list(): Promise<AgentSession[]> {
      return [...sessions];
    },
  };
}
