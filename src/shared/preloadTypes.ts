import type {
  AgentSession,
  ApiProfile,
  LaunchRequest,
  TerminalKillRequest,
  TerminalOutputEvent,
  TerminalResizeRequest,
  TerminalWriteRequest,
  Workspace,
} from './agentdockTypes.js';

export type AgentDockApi = {
  version: string;
  listProfiles(): Promise<ApiProfile[]>;
  listWorkspaces(): Promise<Workspace[]>;
  launchSession(request: LaunchRequest): Promise<AgentSession>;
  listSessions(): Promise<AgentSession[]>;
  writeTerminal(request: TerminalWriteRequest): Promise<void>;
  resizeTerminal(request: TerminalResizeRequest): Promise<void>;
  killTerminal(request: TerminalKillRequest): Promise<AgentSession>;
  onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void;
};

export const AGENT_DOCK_API_METHODS = [
  'version',
  'listProfiles',
  'listWorkspaces',
  'launchSession',
  'listSessions',
  'writeTerminal',
  'resizeTerminal',
  'killTerminal',
  'onTerminalOutput',
] as const satisfies ReadonlyArray<keyof AgentDockApi>;
