import type {
  AgentSession,
  ApiProfile,
  CloseSessionViewRequest,
  LaunchRequest,
  ProfileModelsFetchRequest,
  ProfileSecretReadRequest,
  ProfileSecretSaveRequest,
  RestartSessionRequest,
  SessionContextPressureRequest,
  SessionContextPressureResult,
  SessionHistoryArchiveRequest,
  SessionHistoryArchiveResult,
  SessionRecordRequest,
  SessionSummaryRequest,
  SessionSummaryResult,
  TerminalBufferRequest,
  TerminalKillRequest,
  TerminalOutputEvent,
  TerminalResizeRequest,
  TerminalWriteRequest,
  Workspace,
  WorkspaceContextOpenRequest,
  WorkspaceContextReadRequest,
  WorkspaceContextReadResult,
} from './agentdockTypes.js';

export type AgentDockApi = {
  version: string;
  listProfiles(): Promise<ApiProfile[]>;
  listWorkspaces(): Promise<Workspace[]>;
  chooseWorkspace(): Promise<Workspace | undefined>;
  saveProfile(profile: ApiProfile): Promise<ApiProfile>;
  deleteProfile(profileId: string): Promise<void>;
  saveProfileSecret(request: ProfileSecretSaveRequest): Promise<void>;
  readProfileSecret(request: ProfileSecretReadRequest): Promise<string>;
  fetchProfileModels(request: ProfileModelsFetchRequest): Promise<string[]>;
  launchSession(request: LaunchRequest): Promise<AgentSession>;
  restartSession(request: RestartSessionRequest): Promise<AgentSession>;
  listSessions(): Promise<AgentSession[]>;
  closeSessionView(request: CloseSessionViewRequest): Promise<AgentSession>;
  archiveSessionRecord(request: SessionRecordRequest): Promise<AgentSession>;
  deleteSessionRecord(request: SessionRecordRequest): Promise<void>;
  writeTerminal(request: TerminalWriteRequest): Promise<void>;
  resizeTerminal(request: TerminalResizeRequest): Promise<void>;
  killTerminal(request: TerminalKillRequest): Promise<AgentSession>;
  readTerminalBuffer(request: TerminalBufferRequest): Promise<string>;
  archiveSessionHistory(request: SessionHistoryArchiveRequest): Promise<SessionHistoryArchiveResult>;
  getSessionContextPressure(request: SessionContextPressureRequest): Promise<SessionContextPressureResult>;
  summarizeSession(request: SessionSummaryRequest): Promise<SessionSummaryResult>;
  onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void;
  onSessionChanged(listener: (session: AgentSession) => void): () => void;
  readWorkspaceContext(request: WorkspaceContextReadRequest): Promise<WorkspaceContextReadResult>;
  openWorkspaceContextFolder(request: WorkspaceContextOpenRequest): Promise<void>;
  openNewWindow(): Promise<void>;
  onMetadataChanged(listener: () => void): () => void;
};

export const AGENT_DOCK_API_METHODS = [
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
  'readWorkspaceContext',
  'openWorkspaceContextFolder',
  'openNewWindow',
  'onMetadataChanged',
] as const satisfies ReadonlyArray<keyof AgentDockApi>;
