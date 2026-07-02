export type ToolType = 'claude' | 'codex' | 'gemini' | 'opencode';

export type ApiProfile = {
  id: string;
  name: string;
  toolType: ToolType;
  baseUrl: string;
  defaultModel?: string;
  availableModels?: string[];
  keychainService: string;
  keychainAccount: string;
  codexHome?: string;
};

export type Workspace = {
  id: string;
  name: string;
  path: string;
};

export type SessionStatus = 'starting' | 'running' | 'stopped' | 'failed';

export type AgentSession = {
  id: string;
  title: string;
  profileId: string;
  workspaceId: string;
  command: string;
  status: SessionStatus;
  startedAt: string;
};

export type LaunchRequest = {
  profileId: string;
  workspaceId: string;
  command: string;
};

export type ProfileSecretSaveRequest = {
  keychainService: string;
  keychainAccount: string;
  secret: string;
};

export type ProfileSecretReadRequest = {
  keychainService: string;
  keychainAccount: string;
};

export type ProfileModelsFetchRequest = {
  profileId: string;
};

export type TerminalWriteRequest = {
  sessionId: string;
  input: string;
};

export type TerminalResizeRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};

export type TerminalKillRequest = {
  sessionId: string;
};

export type TerminalBufferRequest = {
  sessionId: string;
};

export type TerminalOutputEvent = {
  sessionId: string;
  data: string;
};
