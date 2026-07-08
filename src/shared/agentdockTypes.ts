export type ToolType = 'claude' | 'codex' | 'gemini' | 'opencode';
export type ClaudeLaunchMode = 'lite' | 'full';
export type ClaudeDefaultLaunchMode = 'default' | 'opus' | 'sonnet' | 'haiku' | 'custom';

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
  skipPermissions?: boolean;
  bypassApprovals?: boolean;
  claudeCodeRetryWatchdog?: boolean;
  claudeCodeMaxRetries?: number;
  anthropicBetas?: string;
  httpProxy?: string;
  httpsProxy?: string;
  claudeCodeDisableNonessentialTraffic?: boolean;
  claudeCodeAttributionHeader?: string;
  disableInstallationChecks?: boolean;
  claudeCleanupPeriodDays?: number;
  claudeDefaultLaunchMode?: ClaudeDefaultLaunchMode;
  claudeHaikuModel?: string;
  claudeSonnetModel?: string;
  claudeOpusModel?: string;
  claudeAlwaysThinkingEnabled?: boolean;
  claudeAnthropicCompatProxyEnabled?: boolean;
  claudeCclineStatusLineEnabled?: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  path: string;
};

export type AppBuildInfo = {
  version: string;
  buildId: string;
  buildTime: string;
  commit: string;
  commitShort: string;
  dirty: boolean;
};

export type SessionStatus =
  | 'starting'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'exited'
  | 'interrupted';

export type MemoryRestoreStatus = 'loaded' | 'empty' | 'failed';
export type MemoryRestoreMethod = 'native' | 'agentdock' | 'none';

export type MemoryRestoreState = {
  method?: MemoryRestoreMethod;
  status: MemoryRestoreStatus;
  summary: string;
  contextFile?: string;
  error?: string;
};

export type NativeResumeState = {
  tool: 'claude' | 'codex';
  status: 'verified' | 'partial' | 'unavailable';
  sessionId?: string;
  resumeCommand?: string;
  checkedAt?: string;
  reason?: string;
};

export type RuntimeOwner = {
  ownerId: string;
  startedAt: string;
};

export type AgentSession = {
  id: string;
  title: string;
  profileId: string;
  workspaceId: string;
  command: string;
  claudeLaunchMode?: ClaudeLaunchMode;
  status: SessionStatus;
  archived?: boolean;
  closedViewIds?: string[];
  runtimeOwner?: RuntimeOwner;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number;
  exitSignal?: number;
  resumeCommand?: string;
  nativeResume?: NativeResumeState;
  transcript?: {
    filePath: string;
    byteSize: number;
    tailBytes: number;
    tailTruncated: boolean;
  };
  historyLimitReached?: boolean;
  historyArchivePath?: string;
  memoryRestore?: MemoryRestoreState;
};

export type LaunchRequest = {
  profileId: string;
  workspaceId: string;
  command: string;
  claudeLaunchMode?: ClaudeLaunchMode;
};

export type RestartSessionRequest = {
  sessionId: string;
  command?: string;
  claudeLaunchMode?: ClaudeLaunchMode;
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

export type CloseSessionViewRequest = {
  sessionId: string;
  viewId: string;
};

export type SessionRecordRequest = {
  sessionId: string;
};

export type TerminalBufferRequest = {
  sessionId: string;
};

export type ContextPressureLevel = 'low' | 'medium' | 'high' | 'full';

export type SessionContextPressureRequest = {
  sessionId: string;
};

export type SessionContextPressureResult = {
  sessionId: string;
  level: ContextPressureLevel;
  score: number;
};

export type SessionHistoryArchiveRequest = {
  sessionId: string;
};

export type SessionHistoryArchiveResult = {
  filePath: string;
};

export type SessionSummaryRequest = {
  sessionId: string;
  continueAfterSummary?: boolean;
};

export type SessionSummaryResult = {
  status: 'success';
  summaryFile: string;
  handoffFile: string;
  handoffPrompt: string;
  continuationSession?: AgentSession;
};

export type TerminalOutputEvent = {
  sessionId: string;
  data: string;
};

export type WorkspaceContextReadRequest = {
  workspaceId: string;
};

export type WorkspaceContextReadResult = {
  filePath: string;
  content: string;
};

export type WorkspaceContextOpenRequest = {
  workspaceId: string;
};

export type WorkspaceFileStatus = 'M' | 'A' | 'D' | 'R' | '?';

export type WorkspaceFileTreeEntry = {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  gitStatus?: WorkspaceFileStatus;
  touchedInSession?: boolean;
  additions?: number;
  deletions?: number;
};

export type WorkspaceDirectoryRequest = {
  workspaceId: string;
  relativePath?: string;
  sessionId?: string;
};

export type WorkspaceDirectoryResult = {
  workspaceId: string;
  relativePath: string;
  entries: WorkspaceFileTreeEntry[];
};

export type SessionFileIndexEntry = {
  relativePath: string;
  gitStatus?: WorkspaceFileStatus;
  touchedInSession?: boolean;
  additions?: number;
  deletions?: number;
};

export type SessionFileIndex = {
  baselineAt?: string;
  files: SessionFileIndexEntry[];
};
