import type {
  AgentSession,
  ApiProfile,
  LaunchRequest,
  ProfileSecretSaveRequest,
  TerminalBufferRequest,
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
  chooseWorkspace(): Promise<Workspace | undefined>;
  saveProfile(profile: ApiProfile): Promise<ApiProfile>;
  saveProfileSecret(request: ProfileSecretSaveRequest): Promise<void>;
  launchSession(request: LaunchRequest): Promise<AgentSession>;
  listSessions(): Promise<AgentSession[]>;
  writeTerminal(request: TerminalWriteRequest): Promise<void>;
  resizeTerminal(request: TerminalResizeRequest): Promise<void>;
  killTerminal(request: TerminalKillRequest): Promise<AgentSession>;
  readTerminalBuffer(request: TerminalBufferRequest): Promise<string>;
  onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void;
};

export const AGENT_DOCK_API_METHODS = [
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
] as const satisfies ReadonlyArray<keyof AgentDockApi>;
