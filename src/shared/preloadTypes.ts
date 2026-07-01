import type {
  AgentSession,
  ApiProfile,
  LaunchRequest,
  Workspace,
} from './agentdockTypes.js';

export type AgentDockApi = {
  version: string;
  listProfiles(): Promise<ApiProfile[]>;
  listWorkspaces(): Promise<Workspace[]>;
  launchSession(request: LaunchRequest): Promise<AgentSession>;
  listSessions(): Promise<AgentSession[]>;
};

export const AGENT_DOCK_API_METHODS = [
  'version',
  'listProfiles',
  'listWorkspaces',
  'launchSession',
  'listSessions',
] as const satisfies ReadonlyArray<keyof AgentDockApi>;
