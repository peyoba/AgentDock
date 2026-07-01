export type ToolType = 'claude' | 'codex' | 'gemini' | 'opencode';

export type ApiProfile = {
  id: string;
  name: string;
  toolType: ToolType;
  baseUrl: string;
  defaultModel?: string;
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
