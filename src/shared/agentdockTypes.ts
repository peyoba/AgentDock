export type ToolType = 'claude' | 'codex' | 'grok' | 'gemini' | 'opencode';
export type GrokAuthMode = 'api-key' | 'oauth';
export type ClaudeLaunchMode = 'lite' | 'full';
export type CodexLaunchMode = 'native-responses' | 'newapi-tool-compatible';
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
  grokHome?: string;
  grokAuthMode?: GrokAuthMode;
  codexDefaultLaunchMode?: CodexLaunchMode;
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

export type AppUpdateCheckResult =
  | {
      status: 'available' | 'current';
      currentVersion: string;
      latestVersion: string;
      releaseName?: string;
      releaseUrl: string;
    }
  | {
      status: 'error';
      currentVersion: string;
      message: string;
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
  tool: 'claude' | 'codex' | 'grok';
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
  codexLaunchMode?: CodexLaunchMode;
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
  codexLaunchMode?: CodexLaunchMode;
};

export type RestartSessionStrategy = 'resume' | 'fresh';

export type RestartSessionRequest = {
  sessionId: string;
  strategy: RestartSessionStrategy;
  command?: string;
  claudeLaunchMode?: ClaudeLaunchMode;
  codexLaunchMode?: CodexLaunchMode;
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
  /** 编辑器里尚未保存的 Base URL；提供时用它替代已保存值发起拉取。 */
  baseUrlOverride?: string;
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

export type SessionRecordEventKind =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'status';

export type SessionRecordSource = 'claude' | 'codex' | 'grok' | 'agentdock';
export type SessionRecordTrust = 'native' | 'derived-status';
export type SessionRecordTimeSource = 'native' | 'read';
export type SessionRecordSyncStatus =
  | 'pending'
  | 'syncing'
  | 'ready'
  | 'partial'
  | 'stale'
  | 'failed'
  | 'unavailable';

type SessionRecordEventBase = {
  eventId: string;
  sessionId: string;
  runId: string;
  sequence?: number;
  occurredAt: string;
  timeSource: SessionRecordTimeSource;
  source: SessionRecordSource;
  trust: SessionRecordTrust;
  truncated: boolean;
};

export type SessionRecordEventDto =
  | (SessionRecordEventBase & {
      kind: 'user_message';
      trust: 'native';
      payload: { text: string };
    })
  | (SessionRecordEventBase & {
      kind: 'assistant_message';
      trust: 'native';
      payload: { text: string };
    })
  | (SessionRecordEventBase & {
      kind: 'tool_call';
      trust: 'native';
      payload: { toolName: string; argumentsSummary?: string };
    })
  | (SessionRecordEventBase & {
      kind: 'tool_result';
      trust: 'native';
      payload: { outcome: 'success' | 'failure' | 'partial'; text?: string };
    })
  | (SessionRecordEventBase & {
      kind: 'status';
      source: 'agentdock';
      trust: 'derived-status';
      payload: {
        code: 'started' | 'restored' | 'completed' | 'failed' | 'waiting';
        text?: string;
      };
    });

export type SessionRecordSnapshot = {
  sessionId: string;
  status: SessionRecordSyncStatus;
  source?: Exclude<SessionRecordSource, 'agentdock'>;
  events: SessionRecordEventDto[];
  eventCount: number;
  lastSyncedAt?: string;
  message?: string;
  truncated: boolean;
  hasMore: boolean;
};

export type SessionRecordListRequest = {
  sessionId: string;
  beforeEventId?: string;
  limit?: number;
};

export type SessionRecordRequest = {
  sessionId: string;
};

export type SessionRecordActionResult = {
  status: 'completed' | 'canceled' | 'unavailable';
  eventCount: number;
  stale: boolean;
  fileName?: string;
};

export type SessionDiagnosticsResult = {
  sessionId: string;
  text: string;
  truncated: boolean;
  label: '原始 PTY（诊断，不是正式记录）';
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
