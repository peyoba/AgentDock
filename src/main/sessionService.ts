import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentSession,
  ApiProfile,
  ClaudeLaunchMode,
  CodexLaunchMode,
  CloseSessionViewRequest,
  RuntimeOwner,
  RestartSessionStrategy,
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
} from '../shared/agentdockTypes.js';
import { isLocalShellCommand } from '../shared/sessionCommands.js';
import type { KeychainAdapter } from './adapters/keychainAdapter.js';
import { createUnavailableKeychainAdapter } from './adapters/keychainAdapter.js';
import type { PtyAdapter, PtySession } from './adapters/ptyAdapter.js';
import { createUnavailablePtyAdapter } from './adapters/ptyAdapter.js';
import { resolveCclineCommand as locateCclineCommand } from './cclineLocator.js';
import {
  startClaudeCompatProxy as startDefaultClaudeCompatProxy,
  type ClaudeCompatProxyInstance,
  type StartClaudeCompatProxyInput,
} from './claudeCompatProxy.js';
import {
  startCodexToolCompatibilityProxy as startDefaultCodexToolCompatibilityProxy,
  type CodexToolCompatibilityProxyInstance,
  type StartCodexToolCompatibilityProxyInput,
} from './codexToolCompatibilityProxy.js';
import { estimateContextPressure } from './contextBudgetEstimator.js';
import {
  ensurePrivateDirectory as ensurePrivateDirectoryOnDisk,
  writePrivateFileAtomically as writePrivateFileAtomicallyOnDisk,
} from './privateFileSystem.js';
import {
  createRestoreContextStore,
  type RestoreContextResult,
} from './restoreContextStore.js';
import { createSessionSummaryStore } from './sessionSummaryStore.js';
import {
  createStreamingPersistenceSanitizer,
  type StreamingPersistenceSanitizer,
} from './streamingPersistenceSanitizer.js';
import {
  containsSensitiveCommandValue,
  redactCommandSecrets,
  redactSecrets,
  registerKnownSecret,
} from './secretRedaction.js';
import { createInitialPromptInjector } from './initialPromptInjector.js';
import type { SessionHistoryStore } from './stores/sessionHistoryStore.js';
import {
  buildClaudeOptionalEnvironment,
  buildLaunchEnvironment,
} from './launchEnvironment.js';
import type {
  WorkspaceContextFiles,
  WorkspaceContextStore,
} from './workspaceContextStore.js';

type Clock = {
  now(): Date;
};

type LaunchSessionInput = {
  profile: ApiProfile;
  workspace: Workspace;
  command: string;
  claudeLaunchMode?: ClaudeLaunchMode;
  codexLaunchMode?: CodexLaunchMode;
};

type RestartSessionInput = {
  sessionId: string;
  profile: ApiProfile;
  workspace: Workspace;
  strategy: RestartSessionStrategy;
  command?: string;
  claudeLaunchMode?: ClaudeLaunchMode;
  codexLaunchMode?: CodexLaunchMode;
};

type SummaryJobDelegate = (request: {
  session: AgentSession;
  workspace: Workspace;
  continueAfterSummary: boolean;
}) => Promise<SessionSummaryResult>;

type ClaudeCompatProxyFactory = (
  input: StartClaudeCompatProxyInput,
) => Promise<ClaudeCompatProxyInstance>;

type CodexToolCompatibilityProxyFactory = (
  input: StartCodexToolCompatibilityProxyInput,
) => Promise<CodexToolCompatibilityProxyInstance>;

export type RuntimeOwnerRegistry = {
  claim(sessionId: string, owner: RuntimeOwner): boolean;
  get(sessionId: string): RuntimeOwner | undefined;
  release(sessionId: string, ownerId: string): void;
};

type CreateSessionServiceOptions = {
  clock?: Clock;
  keychain?: KeychainAdapter;
  pty?: PtyAdapter;
  appDataPath?: string;
  homeDir?: string;
  ensureDirectory?: (directoryPath: string) => void | Promise<void>;
  writeTextFile?: (filePath: string, content: string) => void | Promise<void>;
  removeDirectory?: (directoryPath: string) => void | Promise<void>;
  ensurePrivateDirectory?: (directoryPath: string) => void | Promise<void>;
  writePrivateTextFile?: (filePath: string, content: string) => void | Promise<void>;
  workspaceExists?: (workspacePath: string) => boolean;
  workspaceContext?: WorkspaceContextStore;
  historyStore?: SessionHistoryStore;
  restoreHistory?: boolean;
  /** 多窗口时注入每窗口唯一前缀，避免共享 workspace 上下文里的 session ID 冲突 */
  sessionIdPrefix?: string;
  runtimeOwnerId?: string;
  runtimeOwnerRegistry?: RuntimeOwnerRegistry;
  /** 解析 statusLine 使用的 ccline 命令；默认 PATH 已安装版本优先、内嵌二进制兜底 */
  resolveCclineCommand?: () => string | undefined;
  summaryJob?: SummaryJobDelegate;
  startClaudeCompatProxy?: ClaudeCompatProxyFactory;
  startCodexToolCompatibilityProxy?: CodexToolCompatibilityProxyFactory;
};

type NormalizedSessionServiceOptions = Required<
  Omit<
    CreateSessionServiceOptions,
    'workspaceExists' | 'workspaceContext' | 'historyStore' | 'summaryJob'
  >
> & {
  workspaceExists?: (workspacePath: string) => boolean;
  workspaceContext?: WorkspaceContextStore;
  historyStore?: SessionHistoryStore;
  summaryJob?: SummaryJobDelegate;
};

type TerminalOutputListener = (event: TerminalOutputEvent) => void;
type SessionChangedListener = (session: AgentSession) => void;
type ClaudeSettings = Record<string, unknown>;

export type SessionService = {
  launch(input: LaunchSessionInput): Promise<AgentSession>;
  restart(input: RestartSessionInput): Promise<AgentSession>;
  list(): Promise<AgentSession[]>;
  writeTerminal(request: TerminalWriteRequest): Promise<void>;
  resizeTerminal(request: TerminalResizeRequest): Promise<void>;
  killTerminal(request: TerminalKillRequest): Promise<AgentSession>;
  closeSessionView(request: CloseSessionViewRequest): Promise<AgentSession>;
  archiveSessionRecord(request: SessionRecordRequest): Promise<AgentSession>;
  deleteSessionRecord(request: SessionRecordRequest): Promise<void>;
  readTerminalBuffer(request: TerminalBufferRequest): Promise<string>;
  archiveSessionHistory(request: SessionHistoryArchiveRequest): Promise<SessionHistoryArchiveResult>;
  getContextPressure(request: SessionContextPressureRequest): Promise<SessionContextPressureResult>;
  summarizeSession(request: SessionSummaryRequest): Promise<SessionSummaryResult>;
  onTerminalOutput(listener: TerminalOutputListener): () => void;
  onSessionChanged(listener: SessionChangedListener): () => void;
  dispose(): Promise<void>;
};

const MAX_TERMINAL_BUFFER_LENGTH = 5_000_000;

const defaultClock: Clock = { now: () => new Date() };

export function createRuntimeOwnerRegistry(): RuntimeOwnerRegistry {
  const owners = new Map<string, RuntimeOwner>();

  return {
    claim(sessionId: string, owner: RuntimeOwner): boolean {
      const existingOwner = owners.get(sessionId);
      if (existingOwner && existingOwner.ownerId !== owner.ownerId) {
        return false;
      }

      owners.set(sessionId, { ...owner });
      return true;
    },

    get(sessionId: string): RuntimeOwner | undefined {
      const owner = owners.get(sessionId);
      return owner ? { ...owner } : undefined;
    },

    release(sessionId: string, ownerId: string): void {
      if (owners.get(sessionId)?.ownerId === ownerId) {
        owners.delete(sessionId);
      }
    },
  };
}

function defaultEnsureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function defaultWriteTextFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
}

function defaultRemoveDirectory(directoryPath: string): void {
  fs.rmSync(directoryPath, { recursive: true, force: true });
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isAgentDockManagedCodexHome({
  codexHome,
  appDataPath,
  homeDir,
}: {
  codexHome: string;
  appDataPath: string;
  homeDir: string;
}): boolean {
  return [
    path.join(appDataPath, 'codex-profiles'),
    path.join(appDataPath, 'codex-session-runtimes'),
    path.join(homeDir, '.agentdock', 'codex-profiles'),
  ].some((managedRoot) => isPathInsideDirectory(codexHome, managedRoot));
}

function codexRuntimeDirectoryName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '-');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function buildCodexConfig(profile: ApiProfile, workspace: Workspace): string {
  return [
    `model = ${tomlString(profile.defaultModel ?? 'gpt-5-codex')}`,
    'model_provider = "agentdock"',
    '',
    '[model_providers.agentdock]',
    'name = "AgentDock"',
    `base_url = ${tomlString(profile.baseUrl)}`,
    'wire_api = "responses"',
    'env_key = "OPENAI_API_KEY"',
    '',
    `[projects.${tomlString(workspace.path)}]`,
    'trust_level = "trusted"',
    '',
  ].join('\n');
}

function optionalTrimmedString(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.trunc(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function restoreInstructionToInitialPrompt(instruction: string): string {
  return instruction.replace(/\r+$/g, '').trim();
}

type TerminalDataTransformer = {
  push(data: string): string;
  end(): string;
};

function createTerminalDataTransformer(
  proxy: CodexToolCompatibilityProxyInstance,
  realModel: string,
): TerminalDataTransformer {
  const internalModel = proxy.internalModel;
  let pendingData = '';

  const possibleAliasSuffixLength = (data: string): number => {
    const maximumLength = Math.min(data.length, internalModel.length - 1);
    for (let length = maximumLength; length > 0; length -= 1) {
      if (data.endsWith(internalModel.slice(0, length))) {
        return length;
      }
    }
    return 0;
  };

  return {
    push(data: string): string {
      pendingData += data;
      let visibleData = '';

      while (pendingData) {
        const aliasIndex = pendingData.indexOf(internalModel);
        if (aliasIndex >= 0) {
          visibleData += `${pendingData.slice(0, aliasIndex)}${realModel}`;
          pendingData = pendingData.slice(aliasIndex + internalModel.length);
          continue;
        }

        const retainedLength = possibleAliasSuffixLength(pendingData);
        visibleData += pendingData.slice(0, pendingData.length - retainedLength);
        pendingData = retainedLength > 0 ? pendingData.slice(-retainedLength) : '';
        break;
      }

      return visibleData;
    },

    end(): string {
      const visibleTail = possibleAliasSuffixLength(pendingData) > 0 ? '' : pendingData;
      pendingData = '';
      return visibleTail;
    },
  };
}

// statusLine.command 由 Claude Code 交给 shell 解析，绝对路径含特殊字符时需要引号
function shellSafeStatusLineCommand(command: string): string {
  return /^[A-Za-z0-9_\-./@+]+$/.test(command) ? command : shellQuote(command);
}

function claudeSettingsModel(profile: ApiProfile): string | undefined {
  const launchMode = profile.claudeDefaultLaunchMode ?? 'custom';
  if (launchMode === 'default') {
    return undefined;
  }

  if (launchMode === 'custom') {
    return optionalTrimmedString(profile.defaultModel);
  }

  return launchMode;
}

function buildClaudeSettings(
  profile: ApiProfile,
  resolveCclineCommand: () => string | undefined,
): ClaudeSettings | undefined {
  const settings: ClaudeSettings = {};
  const model = claudeSettingsModel(profile);
  const cleanupPeriodDays = positiveInteger(profile.claudeCleanupPeriodDays);
  const env = buildClaudeOptionalEnvironment(profile);

  if (model) {
    settings.model = model;
  }

  if (profile.claudeAlwaysThinkingEnabled === true) {
    settings.alwaysThinkingEnabled = true;
  }

  if (Object.keys(env).length > 0) {
    settings.env = env;
  }

  if (cleanupPeriodDays) {
    settings.cleanupPeriodDays = cleanupPeriodDays;
  }

  if (profile.claudeCclineStatusLineEnabled === true) {
    const cclineCommand = resolveCclineCommand();
    if (cclineCommand) {
      settings.statusLine = {
        type: 'command',
        command: shellSafeStatusLineCommand(cclineCommand),
        padding: 0,
      };
    }
  }

  return Object.keys(settings).length > 0 ? settings : undefined;
}

function appendClaudeSettingsCommand(command: string, settingsPath: string): string {
  return `${command} --settings ${shellQuote(settingsPath)}`;
}

function appendClaudeSettingSourcesCommand(command: string): string {
  return `${command} --setting-sources project,local`;
}

function buildEmptyClaudeMcpConfig(): string {
  return `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;
}

function appendClaudeMcpConfigCommand(command: string, mcpConfigPath: string): string {
  return `${command} --mcp-config ${shellQuote(mcpConfigPath)} --strict-mcp-config`;
}

function appendCodexCompatibilityOverrides(command: string, internalModel: string): string {
  const match = command.trim().match(/^(\S+)([\s\S]*)$/);
  if (!match) {
    throw new Error('Codex compatibility command is empty');
  }
  return `${match[1]} -c model_provider=agentdock -c model=${internalModel}${match[2]}`;
}

function contextEnvironment(files: WorkspaceContextFiles | undefined): Record<string, string> {
  if (!files) {
    return {};
  }

  return {
    AGENTDOCK_CONTEXT_DIR: files.contextDir,
    AGENTDOCK_SHARED_CONTEXT_FILE: files.sharedContextFile,
    AGENTDOCK_SESSION_TRANSCRIPT_FILE: files.sessionTranscriptFile,
  };
}

function normalizeOptions(
  optionsOrClock: Clock | CreateSessionServiceOptions = {},
): NormalizedSessionServiceOptions {
  if ('now' in optionsOrClock && typeof optionsOrClock.now === 'function') {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
    return {
      clock: optionsOrClock,
      keychain: createUnavailableKeychainAdapter(),
      pty: createUnavailablePtyAdapter(),
      appDataPath: process.cwd(),
      homeDir,
      ensureDirectory: defaultEnsureDirectory,
      writeTextFile: defaultWriteTextFile,
      removeDirectory: defaultRemoveDirectory,
      ensurePrivateDirectory: ensurePrivateDirectoryOnDisk,
      writePrivateTextFile: writePrivateFileAtomicallyOnDisk,
      workspaceExists: undefined,
      workspaceContext: undefined,
      historyStore: undefined,
      restoreHistory: true,
      sessionIdPrefix: '',
      runtimeOwnerId: 'default-window',
      runtimeOwnerRegistry: createRuntimeOwnerRegistry(),
      resolveCclineCommand: () => locateCclineCommand({
        homeDir,
        platform: process.platform,
      }),
      summaryJob: undefined,
      startClaudeCompatProxy: startDefaultClaudeCompatProxy,
      startCodexToolCompatibilityProxy: startDefaultCodexToolCompatibilityProxy,
    };
  }

  const options = optionsOrClock as CreateSessionServiceOptions;
  const homeDir = options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();

  return {
    clock: options.clock ?? defaultClock,
    keychain: options.keychain ?? createUnavailableKeychainAdapter(),
    pty: options.pty ?? createUnavailablePtyAdapter(),
    appDataPath: options.appDataPath ?? process.cwd(),
    homeDir,
    ensureDirectory: options.ensureDirectory ?? defaultEnsureDirectory,
    writeTextFile: options.writeTextFile ?? defaultWriteTextFile,
    removeDirectory: options.removeDirectory ?? defaultRemoveDirectory,
    ensurePrivateDirectory:
      options.ensurePrivateDirectory ?? options.ensureDirectory ?? ensurePrivateDirectoryOnDisk,
    writePrivateTextFile:
      options.writePrivateTextFile ?? options.writeTextFile ?? writePrivateFileAtomicallyOnDisk,
    workspaceExists: options.workspaceExists,
    workspaceContext: options.workspaceContext,
    historyStore: options.historyStore,
    restoreHistory: options.restoreHistory ?? true,
    sessionIdPrefix: options.sessionIdPrefix ?? '',
    runtimeOwnerId: options.runtimeOwnerId ?? 'default-window',
    runtimeOwnerRegistry: options.runtimeOwnerRegistry ?? createRuntimeOwnerRegistry(),
    resolveCclineCommand:
      options.resolveCclineCommand ?? (() => locateCclineCommand({
        homeDir,
        platform: process.platform,
      })),
    summaryJob: options.summaryJob,
    startClaudeCompatProxy: options.startClaudeCompatProxy ?? startDefaultClaudeCompatProxy,
    startCodexToolCompatibilityProxy:
      options.startCodexToolCompatibilityProxy ?? startDefaultCodexToolCompatibilityProxy,
  };
}

function cloneSession(session: AgentSession): AgentSession {
  return { ...session };
}

function extractClaudeResumeCommand(output: string): string | undefined {
  const match = output.match(/(?:^|[\r\n])\s*(claude\s+--resume\s+\S+)/);
  return match?.[1];
}

const SAFE_NATIVE_RESUME_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function safeResumeCommand(command: string | undefined, tool: 'claude' | 'codex'): string | undefined {
  const trimmedCommand = command?.trim();
  if (!trimmedCommand || /[\r\n]/.test(trimmedCommand)) {
    return undefined;
  }

  if (tool === 'claude' && /^claude\s+--resume\s+\S+/.test(trimmedCommand)) {
    return trimmedCommand;
  }
  if (tool === 'codex' && /^codex\s+(?:exec\s+)?resume\b/.test(trimmedCommand)) {
    return trimmedCommand;
  }
  return undefined;
}

function nativeResumeCommandForSession(
  session: AgentSession,
  profile: ApiProfile,
): { command: string; summary: string } | undefined {
  const nativeResume = session.nativeResume;
  if (
    !nativeResume ||
    nativeResume.status !== 'verified' ||
    nativeResume.tool !== profile.toolType
  ) {
    return undefined;
  }

  const explicitCommand = safeResumeCommand(nativeResume.resumeCommand, nativeResume.tool);
  if (explicitCommand) {
    return {
      command: explicitCommand,
      summary: nativeResume.tool === 'claude'
        ? '原生恢复已验证：使用 Claude 会话 ID 恢复。'
        : '原生恢复已验证：使用 Codex thread id 恢复。',
    };
  }

  const sessionId = nativeResume.sessionId?.trim();
  if (!sessionId || !SAFE_NATIVE_RESUME_ID_PATTERN.test(sessionId)) {
    return undefined;
  }

  if (nativeResume.tool === 'claude') {
    return {
      command: `claude --resume ${sessionId}`,
      summary: '原生恢复已验证：使用 Claude 会话 ID 恢复。',
    };
  }

  return {
    command: `codex resume ${sessionId}`,
    summary: '原生恢复已验证：使用 Codex thread id 恢复。',
  };
}

function assertSessionCommandHasNoSensitiveValues(command: string): void {
  if (containsSensitiveCommandValue(command)) {
    throw new Error('会话命令不得包含敏感凭证；请通过 API 配置保存密钥');
  }
}

function isMacosProtectedUserFolderPath(workspacePath: string): boolean {
  return /^\/Users\/[^/]+\/(Desktop|Documents|Downloads)(\/|$)/.test(
    path.normalize(workspacePath),
  );
}

function isSecretReadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/API key was not found for account/.test(error.message) ||
      /Keychain secret was not found for account/.test(error.message) ||
      /Unable to decrypt local API key vault entry/.test(error.message) ||
      /无法读取已保存的 API Key/.test(error.message))
  );
}

export function createSessionService(
  optionsOrClock?: Clock | CreateSessionServiceOptions,
): SessionService {
  const {
    clock,
    keychain,
    pty,
    appDataPath,
    homeDir,
    ensureDirectory,
    writeTextFile,
    removeDirectory,
    ensurePrivateDirectory,
    writePrivateTextFile,
    workspaceExists,
    workspaceContext,
    historyStore,
    restoreHistory,
    sessionIdPrefix,
    runtimeOwnerId,
    runtimeOwnerRegistry,
    resolveCclineCommand,
    summaryJob,
    startClaudeCompatProxy,
    startCodexToolCompatibilityProxy,
  } = normalizeOptions(optionsOrClock);
  const sessions: AgentSession[] = [];
  const ptySessions = new Map<string, PtySession>();
  const ptyUnsubscribers = new Map<string, () => void>();
  const terminalBuffers = new Map<string, string>();
  const claudeCompatProxies = new Map<string, ClaudeCompatProxyInstance>();
  const codexCompatibilityProxies = new Map<string, CodexToolCompatibilityProxyInstance>();
  const codexCompatibilityRuntimeHomes = new Map<string, string>();
  const terminalDataTransformers = new Map<string, TerminalDataTransformer>();
  const workspacesBySessionId = new Map<string, Workspace>();
  const persistenceSanitizers = new Map<string, StreamingPersistenceSanitizer>();
  const pendingHistoryOutput = new Map<string, string>();
  const historyOutputFlushes = new Map<string, Promise<void>>();
  const pendingWorkspaceOutput = new Map<string, string>();
  const workspaceOutputFlushes = new Map<string, Promise<void>>();
  const sessionLifecycleFinalizations = new Map<string, Promise<void>>();
  const initialPromptInjectors = new Map<
    string,
    ReturnType<typeof createInitialPromptInjector>
  >();
  const metadataSavePromises = new Set<Promise<void>>();
  const restoreContextStore = createRestoreContextStore();
  const sessionSummaryStore = createSessionSummaryStore();
  const terminalOutputListeners = new Set<TerminalOutputListener>();
  const sessionChangedListeners = new Set<SessionChangedListener>();
  let historyLoadPromise: Promise<void> | undefined;

  const findSession = (sessionId: string): AgentSession | undefined =>
    sessions.find((session) => session.id === sessionId);

  const closeClaudeCompatProxy = async (sessionId: string): Promise<void> => {
    const proxy = claudeCompatProxies.get(sessionId);
    if (!proxy) {
      return;
    }
    claudeCompatProxies.delete(sessionId);
    await proxy.close().catch(() => undefined);
  };

  const codexCompatibilityRuntimeRoot = path.join(appDataPath, 'codex-session-runtimes');

  const removeCodexCompatibilityRuntimeHome = async (sessionId: string): Promise<void> => {
    const runtimeHome = codexCompatibilityRuntimeHomes.get(sessionId);
    if (!runtimeHome) {
      return;
    }

    const resolvedRoot = path.resolve(codexCompatibilityRuntimeRoot);
    const resolvedRuntimeHome = path.resolve(runtimeHome);
    if (
      path.dirname(resolvedRuntimeHome) !== resolvedRoot ||
      path.basename(resolvedRuntimeHome).length === 0
    ) {
      throw new Error('拒绝清理非 AgentDock Session Codex 运行目录');
    }
    await removeDirectory(resolvedRuntimeHome);
    if (codexCompatibilityRuntimeHomes.get(sessionId) === runtimeHome) {
      codexCompatibilityRuntimeHomes.delete(sessionId);
    }
  };

  const closeCodexCompatibilityProxy = async (sessionId: string): Promise<void> => {
    const proxy = codexCompatibilityProxies.get(sessionId);
    if (proxy) {
      codexCompatibilityProxies.delete(sessionId);
      await proxy.close().catch(() => undefined);
    }
    await removeCodexCompatibilityRuntimeHome(sessionId);
  };

  const loadHistory = (): Promise<void> => {
    // 缓存同一个 Promise，避免并发调用在首次加载完成前拿到空的 sessions 列表。
    historyLoadPromise ??= (async () => {
      if (!restoreHistory) {
        return;
      }

      const persistedSessions = await historyStore?.listSessions() ?? [];
      for (const persistedSession of persistedSessions) {
        const session = { ...persistedSession };
        const redactedCommand = redactCommandSecrets(session.command);
        if (redactedCommand !== session.command) {
          session.command = redactedCommand;
          await saveSessionMetadata(session);
        }
        if (session.status === 'running' || session.status === 'starting') {
          const activeOwner = runtimeOwnerRegistry.get(session.id);
          if (activeOwner) {
            session.status = 'running';
            session.runtimeOwner = activeOwner;
          } else {
            session.status = 'interrupted';
            delete session.runtimeOwner;
            await saveSessionMetadata(session);
          }
        }
        sessions.push(session);
        terminalBuffers.set(session.id, await historyStore?.readBuffer(session.id) ?? '');
      }
    })();
    return historyLoadPromise;
  };

  const requirePtySession = (sessionId: string): PtySession => {
    const ptySession = ptySessions.get(sessionId);
    if (!ptySession) {
      throw new Error('未找到指定的终端会话');
    }
    return ptySession;
  };

  const publishSessionChanged = (session: AgentSession): void => {
    const clonedSession = cloneSession(session);
    for (const listener of sessionChangedListeners) {
      listener(clonedSession);
    }
  };

  const saveSessionMetadata = (session: AgentSession): Promise<void> => {
    if (!historyStore) {
      return Promise.resolve();
    }

    const savePromise = historyStore.saveSession(cloneSession(session));
    metadataSavePromises.add(savePromise);
    void savePromise.then(
      () => metadataSavePromises.delete(savePromise),
      () => metadataSavePromises.delete(savePromise),
    );
    return savePromise;
  };

  const waitForMetadataSaves = async (): Promise<void> => {
    while (metadataSavePromises.size > 0) {
      await Promise.allSettled([...metadataSavePromises]);
    }
  };

  const flushHistoryOutput = async (sessionId: string): Promise<void> => {
    while (true) {
      const data = pendingHistoryOutput.get(sessionId);
      if (!data) {
        pendingHistoryOutput.delete(sessionId);
        historyOutputFlushes.delete(sessionId);
        return;
      }

      pendingHistoryOutput.set(sessionId, '');
      try {
        const result = await historyStore?.appendOutput(sessionId, data);
        const session = findSession(sessionId);
        if (result?.limitReached && session && !session.historyLimitReached) {
          session.historyLimitReached = true;
          publishSessionChanged(session);
        }
      } catch {
        // 保留失败批次，下一次输出到来时再重试；不要在磁盘持续故障时热循环。
        pendingHistoryOutput.set(
          sessionId,
          `${data}${pendingHistoryOutput.get(sessionId) ?? ''}`,
        );
        historyOutputFlushes.delete(sessionId);
        console.error('[session-history] 终端历史写入失败，已保留待后续重试');
        return;
      }
    }
  };

  const waitForHistoryOutputFlush = async (sessionId: string): Promise<void> => {
    await historyOutputFlushes.get(sessionId);
  };

  const queueHistoryOutput = (sessionId: string, data: string): void => {
    if (!historyStore) {
      return;
    }

    const session = findSession(sessionId);
    if (!session || session.historyLimitReached) {
      return;
    }

    if (!data) {
      return;
    }

    pendingHistoryOutput.set(
      sessionId,
      `${pendingHistoryOutput.get(sessionId) ?? ''}${data}`,
    );
    if (!historyOutputFlushes.has(sessionId)) {
      const flush = flushHistoryOutput(sessionId);
      historyOutputFlushes.set(sessionId, flush);
    }
  };

  const flushWorkspaceOutput = async (
    sessionId: string,
    workspace: Workspace,
  ): Promise<void> => {
    while (true) {
      const data = pendingWorkspaceOutput.get(sessionId);
      if (!data) {
        pendingWorkspaceOutput.delete(sessionId);
        workspaceOutputFlushes.delete(sessionId);
        return;
      }

      pendingWorkspaceOutput.set(sessionId, '');
      try {
        await workspaceContext?.appendOutput({ workspace, sessionId, data });
      } catch {
        pendingWorkspaceOutput.set(
          sessionId,
          `${data}${pendingWorkspaceOutput.get(sessionId) ?? ''}`,
        );
        workspaceOutputFlushes.delete(sessionId);
        console.error('[workspace-context] 终端上下文写入失败，已保留安全文本待后续重试');
        return;
      }
    }
  };

  const queueWorkspaceOutput = (
    sessionId: string,
    workspace: Workspace,
    data: string,
  ): void => {
    if (!workspaceContext || !data) {
      return;
    }

    pendingWorkspaceOutput.set(
      sessionId,
      `${pendingWorkspaceOutput.get(sessionId) ?? ''}${data}`,
    );
    if (!workspaceOutputFlushes.has(sessionId)) {
      const flush = flushWorkspaceOutput(sessionId, workspace);
      workspaceOutputFlushes.set(sessionId, flush);
    }
  };

  const queueCanonicalPersistenceOutput = (
    sessionId: string,
    workspace: Workspace,
    data: string,
  ): void => {
    if (!data) {
      return;
    }
    queueHistoryOutput(sessionId, data);
    queueWorkspaceOutput(sessionId, workspace, data);
  };

  const publishTerminalOutput = (event: TerminalOutputEvent): void => {
    const currentBuffer = terminalBuffers.get(event.sessionId) ?? '';
    terminalBuffers.set(
      event.sessionId,
      `${currentBuffer}${event.data}`.slice(-MAX_TERMINAL_BUFFER_LENGTH),
    );

    for (const listener of terminalOutputListeners) {
      listener(event);
    }
  };

  const flushTerminalDataTransformer = (
    sessionId: string,
    workspace: Workspace,
  ): void => {
    const transformer = terminalDataTransformers.get(sessionId);
    if (!transformer) {
      return;
    }
    terminalDataTransformers.delete(sessionId);
    const visibleTail = transformer.end();
    if (!visibleTail) {
      return;
    }

    publishTerminalOutput({ sessionId, data: visibleTail });
    const sanitizer = persistenceSanitizers.get(sessionId);
    queueCanonicalPersistenceOutput(
      sessionId,
      workspace,
      sanitizer ? sanitizer.push(visibleTail) : visibleTail,
    );
  };

  const endPersistenceStream = async (
    sessionId: string,
    workspace: Workspace,
  ): Promise<void> => {
    const sanitizer = persistenceSanitizers.get(sessionId);
    if (sanitizer) {
      persistenceSanitizers.delete(sessionId);
      queueCanonicalPersistenceOutput(sessionId, workspace, sanitizer.end());
    }
    await Promise.all([
      historyOutputFlushes.get(sessionId),
      workspaceOutputFlushes.get(sessionId),
    ]);
  };

  const flushPersistenceStream = async (
    sessionId: string,
    workspace: Workspace,
  ): Promise<void> => {
    const sanitizer = persistenceSanitizers.get(sessionId);
    if (sanitizer) {
      queueCanonicalPersistenceOutput(sessionId, workspace, sanitizer.flush());
    }
    await Promise.all([
      historyOutputFlushes.get(sessionId),
      workspaceOutputFlushes.get(sessionId),
    ]);
  };

  const ensureWorkspaceAvailable = (workspace: Workspace): void => {
    if (
      workspaceExists &&
      !isMacosProtectedUserFolderPath(workspace.path) &&
      !workspaceExists(workspace.path)
    ) {
      throw new Error(`工作区路径不可用: ${workspace.path}`);
    }
  };

  const startSessionPty = async ({
    session,
    profile,
    workspace,
    command,
    claudeLaunchMode,
    codexLaunchMode,
    initialPrompt,
    sessionCommand,
    resumeCommand,
    resetTerminalBuffer = false,
  }: {
    session: AgentSession;
    profile: ApiProfile;
    workspace: Workspace;
    command: string;
    claudeLaunchMode?: ClaudeLaunchMode;
    codexLaunchMode?: CodexLaunchMode;
    initialPrompt?: string;
    sessionCommand?: string;
    resumeCommand?: string;
    resetTerminalBuffer?: boolean;
  }): Promise<{ session: AgentSession; initialPromptError?: string }> => {
    assertSessionCommandHasNoSensitiveValues(command);
    ensureWorkspaceAvailable(workspace);
    if (ptySessions.has(session.id)) {
      throw new Error('会话仍在运行，无法重启');
    }
    await sessionLifecycleFinalizations.get(session.id);
    await closeCodexCompatibilityProxy(session.id);
    const startedAt = clock.now().toISOString();
    const owner: RuntimeOwner = { ownerId: runtimeOwnerId, startedAt };
    if (!runtimeOwnerRegistry.claim(session.id, owner)) {
      throw new Error('该会话正在另一窗口运行');
    }

    const effectiveClaudeLaunchMode =
      profile.toolType === 'claude' && !isLocalShellCommand(command)
        ? claudeLaunchMode ?? session.claudeLaunchMode
        : undefined;
    const effectiveCodexLaunchMode =
      profile.toolType === 'codex' && !isLocalShellCommand(command)
        ? codexLaunchMode ?? session.codexLaunchMode ?? profile.codexDefaultLaunchMode ?? 'native-responses'
        : undefined;

    session.title = `${profile.name} · ${workspace.name}`;
    session.profileId = profile.id;
    session.workspaceId = workspace.id;
    session.command = sessionCommand ?? command;
    if (effectiveClaudeLaunchMode) {
      session.claudeLaunchMode = effectiveClaudeLaunchMode;
    } else {
      delete session.claudeLaunchMode;
    }
    if (effectiveCodexLaunchMode) {
      session.codexLaunchMode = effectiveCodexLaunchMode;
    } else {
      delete session.codexLaunchMode;
    }
    session.status = 'starting';
    session.startedAt = startedAt;
    session.runtimeOwner = owner;
    workspacesBySessionId.set(session.id, { ...workspace });
    delete session.exitedAt;
    delete session.exitCode;
    delete session.exitSignal;
    if (resumeCommand) {
      session.resumeCommand = resumeCommand;
    } else {
      delete session.resumeCommand;
    }
    delete session.memoryRestore;

    try {
      const contextFiles = await workspaceContext?.startSession({ workspace, session });
      const secret = isLocalShellCommand(command)
        ? undefined
        : await keychain.readSecret(profile.keychainService, profile.keychainAccount);
      registerKnownSecret(secret ?? undefined);
      const compatProxy =
        !isLocalShellCommand(command) &&
        profile.toolType === 'claude' &&
        profile.claudeAnthropicCompatProxyEnabled === true
          ? await startClaudeCompatProxy({
              upstreamBaseUrl: profile.baseUrl,
              profileId: profile.id,
              sessionId: session.id,
            })
          : undefined;
      if (compatProxy) {
        claudeCompatProxies.set(session.id, compatProxy);
      }
      const realCodexModel = profile.defaultModel ?? 'gpt-5-codex';
      const codexCompatibilityProxy =
        effectiveCodexLaunchMode === 'newapi-tool-compatible'
          ? await startCodexToolCompatibilityProxy({
              upstreamBaseUrl: profile.baseUrl,
              upstreamApiKey: secret ?? '',
              upstreamModel: realCodexModel,
              profileId: profile.id,
              sessionId: session.id,
            })
          : undefined;
      if (codexCompatibilityProxy) {
        codexCompatibilityProxies.set(session.id, codexCompatibilityProxy);
        registerKnownSecret(codexCompatibilityProxy.localApiKey);
      }
      const codexCompatibilityRuntimeHome = codexCompatibilityProxy
        ? path.join(codexCompatibilityRuntimeRoot, codexRuntimeDirectoryName(session.id))
        : undefined;
      if (codexCompatibilityRuntimeHome) {
        codexCompatibilityRuntimeHomes.set(session.id, codexCompatibilityRuntimeHome);
      }
      const runtimeProfile = codexCompatibilityProxy
        ? {
            ...profile,
            baseUrl: codexCompatibilityProxy.baseUrl,
            defaultModel: codexCompatibilityProxy.internalModel,
            codexHome: codexCompatibilityRuntimeHome,
          }
        : profile;
      const runtimeSecret = codexCompatibilityProxy?.localApiKey ?? secret ?? '';
      const persistenceSanitizer = createStreamingPersistenceSanitizer({
        knownSecrets: [secret, codexCompatibilityProxy?.localApiKey].filter(
          (value): value is string => Boolean(value),
        ),
      });
      persistenceSanitizers.set(session.id, persistenceSanitizer);
      if (codexCompatibilityProxy) {
        terminalDataTransformers.set(
          session.id,
          createTerminalDataTransformer(codexCompatibilityProxy, realCodexModel),
        );
      }
      const baseEnv = isLocalShellCommand(command)
        ? {}
        : buildLaunchEnvironment({
            profile: runtimeProfile,
            secret: runtimeSecret,
            appDataPath,
            homeDir,
            anthropicBaseUrl: compatProxy?.baseUrl,
          });
      const env = {
        ...baseEnv,
        ...contextEnvironment(contextFiles),
      };
      let spawnCommand = command;

      if (codexCompatibilityProxy) {
        spawnCommand = appendCodexCompatibilityOverrides(
          spawnCommand,
          codexCompatibilityProxy.internalModel,
        );
      }

      if (env.CODEX_HOME) {
        const agentDockManagesCodexHome = isAgentDockManagedCodexHome({
          codexHome: env.CODEX_HOME,
          appDataPath,
          homeDir,
        });
        if (agentDockManagesCodexHome) {
          await ensurePrivateDirectory(env.CODEX_HOME);
        } else {
          await ensureDirectory(env.CODEX_HOME);
        }
        if (profile.toolType === 'codex') {
          const codexConfigPath = path.join(env.CODEX_HOME, 'config.toml');
          const codexConfig = buildCodexConfig(runtimeProfile, workspace);
          if (agentDockManagesCodexHome) {
            await writePrivateTextFile(codexConfigPath, codexConfig);
          } else {
            await writeTextFile(codexConfigPath, codexConfig);
          }
        }
      }

      if (!isLocalShellCommand(command) && profile.toolType === 'claude') {
        const settings = buildClaudeSettings(profile, resolveCclineCommand);
        if (settings) {
          const settingsDirectory = path.join(appDataPath, 'claude-settings');
          const settingsPath = path.join(settingsDirectory, `${profile.id}.json`);
          await ensurePrivateDirectory(settingsDirectory);
          await writePrivateTextFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
          spawnCommand = appendClaudeSettingsCommand(command, settingsPath);
        }

        if (effectiveClaudeLaunchMode === 'lite') {
          const mcpConfigDirectory = path.join(appDataPath, 'claude-mcp');
          const mcpConfigPath = path.join(mcpConfigDirectory, 'empty.json');
          await ensurePrivateDirectory(mcpConfigDirectory);
          await writePrivateTextFile(mcpConfigPath, buildEmptyClaudeMcpConfig());
          spawnCommand = appendClaudeSettingSourcesCommand(spawnCommand);
          spawnCommand = appendClaudeMcpConfigCommand(spawnCommand, mcpConfigPath);
        }
      }

      if (resetTerminalBuffer) {
        terminalBuffers.set(session.id, '');
      }

      const ptySession = await pty.spawn({
        sessionId: session.id,
        command: spawnCommand,
        cwd: workspace.path,
        env,
      });

      ptySessions.set(session.id, ptySession);
      let initialPromptInjector: ReturnType<typeof createInitialPromptInjector> | undefined;
      let initialPromptOutcome: Promise<{ error?: string }> | undefined;
      let pendingInitialOutput = '';
      let exitedBeforeInitialPromptInjector = false;
      const unsubscribeData = ptySession.onData((data) => {
        if (initialPromptInjector) {
          initialPromptInjector.acceptOutput(data);
        } else {
          pendingInitialOutput = `${pendingInitialOutput}${data}`.slice(-(32 * 1024));
        }
        const visibleData = terminalDataTransformers.get(session.id)?.push(data) ?? data;
        if (!visibleData) {
          return;
        }
        publishTerminalOutput({ sessionId: session.id, data: visibleData });
        queueCanonicalPersistenceOutput(
          session.id,
          workspace,
          persistenceSanitizer.push(visibleData),
        );
      });
      const unsubscribeExit = ptySession.onExit?.((event) => {
        if (initialPromptInjector) {
          initialPromptInjector.exit();
        } else {
          exitedBeforeInitialPromptInjector = true;
        }
        // killTerminal/dispose 已经清理过的会话不再处理（kill 也会触发 onExit）
        if (ptySessions.get(session.id) !== ptySession) {
          return;
        }
        ptyUnsubscribers.get(session.id)?.();
        ptyUnsubscribers.delete(session.id);
        ptySessions.delete(session.id);
        session.status = 'exited';
        runtimeOwnerRegistry.release(session.id, runtimeOwnerId);
        delete session.runtimeOwner;
        session.exitCode = event.exitCode;
        session.exitSignal = event.signal;
        session.exitedAt = clock.now().toISOString();
        const extractedResumeCommand = extractClaudeResumeCommand(
          terminalBuffers.get(session.id) ?? '',
        );
        if (extractedResumeCommand) {
          session.resumeCommand = extractedResumeCommand;
        }
        publishSessionChanged(session);
        flushTerminalDataTransformer(session.id, workspace);
        const exitNotice =
          `\r\n\u001b[2m[AgentDock] 进程已退出（exit code ${event.exitCode}），会话已结束，可关闭此标签页。\u001b[0m\r\n`;
        publishTerminalOutput({
          sessionId: session.id,
          data: exitNotice,
        });
        queueCanonicalPersistenceOutput(
          session.id,
          workspace,
          persistenceSanitizer.push(exitNotice),
        );
        const finalization = Promise.all([
          endPersistenceStream(session.id, workspace),
          closeClaudeCompatProxy(session.id),
          closeCodexCompatibilityProxy(session.id),
        ]).then(async () => {
          await saveSessionMetadata(session);
        }).finally(() => {
          if (sessionLifecycleFinalizations.get(session.id) === finalization) {
            sessionLifecycleFinalizations.delete(session.id);
          }
        });
        sessionLifecycleFinalizations.set(session.id, finalization);
        void finalization.catch(() => {
          console.error('[session-lifecycle] 会话退出状态持久化失败');
        });
      });
      ptyUnsubscribers.set(session.id, () => {
        unsubscribeData();
        unsubscribeExit?.();
      });
      if (
        initialPrompt?.trim() &&
        (profile.toolType === 'claude' || profile.toolType === 'codex')
      ) {
        initialPromptInjector = createInitialPromptInjector({
          tool: profile.toolType,
          prompt: initialPrompt,
          write: (input) => ptySession.write(input),
        });
        initialPromptOutcome = initialPromptInjector.completion.then(
          () => ({}),
          (error: unknown) => ({
            error: redactSecrets(
              error instanceof Error ? error.message : 'Initial prompt injection failed',
            ),
          }),
        );
        initialPromptInjectors.set(session.id, initialPromptInjector);
        initialPromptInjector.acceptOutput(pendingInitialOutput);
        if (exitedBeforeInitialPromptInjector) {
          initialPromptInjector.exit();
        }
      }
      pendingInitialOutput = '';
      if (ptySessions.get(session.id) === ptySession) {
        session.status = 'running';
        session.runtimeOwner = owner;
      }
      await saveSessionMetadata(session);
      let initialPromptError: string | undefined;
      if (initialPromptInjector && initialPromptOutcome) {
        try {
          const outcome = await initialPromptOutcome;
          initialPromptError = outcome.error;
        } finally {
          if (initialPromptInjectors.get(session.id) === initialPromptInjector) {
            initialPromptInjectors.delete(session.id);
          }
        }
      }
      return { session: cloneSession(session), initialPromptError };
    } catch (error) {
      initialPromptInjectors.get(session.id)?.cancel();
      initialPromptInjectors.delete(session.id);
      persistenceSanitizers.get(session.id)?.end();
      persistenceSanitizers.delete(session.id);
      terminalDataTransformers.delete(session.id);
      runtimeOwnerRegistry.release(session.id, runtimeOwnerId);
      await Promise.all([
        closeClaudeCompatProxy(session.id),
        closeCodexCompatibilityProxy(session.id),
      ]);
      delete session.runtimeOwner;
      session.status = 'failed';
      await saveSessionMetadata(session);
      if (isSecretReadError(error)) {
        throw error;
      }
      throw new Error('终端命令启动失败');
    }
  };

  // 基于数组长度生成 ID 会在删除历史记录后复用已有编号，导致新旧会话互相覆盖；
  // 这里改为“不小于现存最大编号”的单调递增计数器。
  let sessionIdCounter = 0;
  const nextSessionId = (): string => {
    const escapedPrefix = sessionIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const idPattern = new RegExp(`^session-${escapedPrefix}(\\d+)$`);
    for (const existingSession of sessions) {
      const match = idPattern.exec(existingSession.id);
      if (match) {
        sessionIdCounter = Math.max(sessionIdCounter, Number(match[1]));
      }
    }
    sessionIdCounter += 1;
    return `session-${sessionIdPrefix}${sessionIdCounter}`;
  };

  async function restoreContextForRestart({
    session,
    profile,
    workspace,
    command,
  }: {
    session: AgentSession;
    profile: ApiProfile;
    workspace: Workspace;
    command: string;
  }): Promise<RestoreContextResult | undefined> {
    if (isLocalShellCommand(command) || !['claude', 'codex'].includes(profile.toolType)) {
      return undefined;
    }

    try {
      const transcriptTail =
        terminalBuffers.get(session.id) ?? await historyStore?.readBuffer(session.id) ?? '';
      const latestSummary = await sessionSummaryStore.readLatestSummary({
        workspacePath: workspace.path,
        sessionId: session.id,
      });
      const summaryMarkdown = latestSummary?.handoffMarkdown ?? latestSummary?.summaryMarkdown;

      return await restoreContextStore.writeRestoreContext({
        workspacePath: workspace.path,
        session,
        summaryMarkdown,
        transcriptTail,
      });
    } catch (error) {
      // Context recovery is best-effort. A missing or inaccessible context path
      // must not prevent the user from restarting the underlying CLI session.
      return {
        status: 'failed',
        summary: '记忆恢复失败',
        error: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  return {
    async launch({
      profile,
      workspace,
      command,
      claudeLaunchMode,
      codexLaunchMode,
    }: LaunchSessionInput): Promise<AgentSession> {
      await loadHistory();
      assertSessionCommandHasNoSensitiveValues(command);
      ensureWorkspaceAvailable(workspace);
      const session: AgentSession = {
        id: nextSessionId(),
        title: `${profile.name} · ${workspace.name}`,
        profileId: profile.id,
        workspaceId: workspace.id,
        command,
        status: 'starting',
        startedAt: clock.now().toISOString(),
      };

      sessions.push(session);
      const started = await startSessionPty({
        session,
        profile,
        workspace,
        command,
        claudeLaunchMode,
        codexLaunchMode,
      });
      return started.session;
    },

    async restart({
      sessionId,
      profile,
      workspace,
      strategy,
      command,
      claudeLaunchMode,
      codexLaunchMode,
    }: RestartSessionInput): Promise<AgentSession> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      const nextCommand = command ?? (
        strategy === 'resume' ? session.resumeCommand : undefined
      ) ?? session.command;
      assertSessionCommandHasNoSensitiveValues(nextCommand);
      const restartCodexLaunchMode =
        profile.toolType === 'codex' && !isLocalShellCommand(nextCommand)
          ? session.codexLaunchMode ?? 'native-responses'
          : codexLaunchMode;
      if (strategy === 'fresh') {
        const started = await startSessionPty({
          session,
          profile,
          workspace,
          command: nextCommand,
          claudeLaunchMode,
          codexLaunchMode: restartCodexLaunchMode,
          resetTerminalBuffer: true,
        });
        return started.session;
      }

      const nativeResume = nativeResumeCommandForSession(session, profile);
      if (nativeResume) {
        const baseCommand = session.command;
        await startSessionPty({
          session,
          profile,
          workspace,
          command: nativeResume.command,
          claudeLaunchMode,
          codexLaunchMode: restartCodexLaunchMode,
          sessionCommand: baseCommand,
          resumeCommand: nativeResume.command,
          resetTerminalBuffer: true,
        });
        session.memoryRestore = {
          method: 'native',
          status: 'loaded',
          summary: nativeResume.summary,
        };
        await saveSessionMetadata(session);
        publishSessionChanged(session);
        return cloneSession(session);
      }

      const memoryRestore = await restoreContextForRestart({
        session: cloneSession(session),
        profile,
        workspace,
        command: nextCommand,
      });
      const initialPrompt = memoryRestore?.status === 'loaded' && memoryRestore.instruction
        ? restoreInstructionToInitialPrompt(memoryRestore.instruction)
        : undefined;
      const started = await startSessionPty({
        session,
        profile,
        workspace,
        command: nextCommand,
        claudeLaunchMode,
        codexLaunchMode: restartCodexLaunchMode,
        initialPrompt,
        sessionCommand: session.command,
        resumeCommand: nextCommand !== session.command ? nextCommand : undefined,
        resetTerminalBuffer: true,
      });
      if (!findSession(session.id)) {
        return cloneSession(session);
      }
      if (memoryRestore) {
        const restoreFailed = memoryRestore.status === 'loaded' && started.initialPromptError;
        session.memoryRestore = {
          method: memoryRestore.status === 'loaded' && !restoreFailed ? 'agentdock' : 'none',
          status: restoreFailed ? 'failed' : memoryRestore.status,
          summary: restoreFailed ? '记忆恢复失败' : memoryRestore.summary,
          contextFile: memoryRestore.contextFile,
          error: restoreFailed ? started.initialPromptError : memoryRestore.error,
        };
        await saveSessionMetadata(session);
        publishSessionChanged(session);
      }
      return cloneSession(session);
    },

    async list(): Promise<AgentSession[]> {
      await loadHistory();
      return sessions.map(cloneSession);
    },

    async writeTerminal({ sessionId, input }: TerminalWriteRequest): Promise<void> {
      requirePtySession(sessionId).write(input);
    },

    async resizeTerminal({ sessionId, cols, rows }: TerminalResizeRequest): Promise<void> {
      requirePtySession(sessionId).resize(cols, rows);
    },

    async killTerminal({ sessionId }: TerminalKillRequest): Promise<AgentSession> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      // Stop only affects the active PTY process. The long-lived Session Record
      // and transcript stay available for later resume or deletion.
      const ptySession = ptySessions.get(sessionId);
      if (ptySession) {
        initialPromptInjectors.get(sessionId)?.cancel();
        initialPromptInjectors.delete(sessionId);
        ptyUnsubscribers.get(sessionId)?.();
        ptyUnsubscribers.delete(sessionId);
        ptySessions.delete(sessionId);
        ptySession.kill();
      }
      await Promise.all([
        closeClaudeCompatProxy(sessionId),
        closeCodexCompatibilityProxy(sessionId),
      ]);
      const workspace = workspacesBySessionId.get(sessionId);
      if (workspace) {
        flushTerminalDataTransformer(sessionId, workspace);
        await endPersistenceStream(sessionId, workspace);
      }
      await waitForHistoryOutputFlush(sessionId);
      pendingHistoryOutput.delete(sessionId);
      pendingWorkspaceOutput.delete(sessionId);
      session.status = 'stopped';
      runtimeOwnerRegistry.release(sessionId, runtimeOwnerId);
      delete session.runtimeOwner;
      await saveSessionMetadata(session);
      publishSessionChanged(session);
      return cloneSession(session);
    },

    async closeSessionView({ sessionId, viewId }: CloseSessionViewRequest): Promise<AgentSession> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      session.closedViewIds = Array.from(new Set([...(session.closedViewIds ?? []), viewId]));
      await historyStore?.closeView(sessionId, viewId);
      publishSessionChanged(session);
      return cloneSession(session);
    },

    async archiveSessionRecord({ sessionId }: SessionRecordRequest): Promise<AgentSession> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      session.archived = true;
      await closeCodexCompatibilityProxy(sessionId);
      await historyStore?.archiveSession(sessionId);
      publishSessionChanged(session);
      return cloneSession(session);
    },

    async deleteSessionRecord({ sessionId }: SessionRecordRequest): Promise<void> {
      await loadHistory();
      const sessionIndex = sessions.findIndex((session) => session.id === sessionId);
      if (sessionIndex === -1) {
        throw new Error('未找到指定的终端会话');
      }

      const ptySession = ptySessions.get(sessionId);
      if (ptySession) {
        initialPromptInjectors.get(sessionId)?.cancel();
        initialPromptInjectors.delete(sessionId);
        ptyUnsubscribers.get(sessionId)?.();
        ptyUnsubscribers.delete(sessionId);
        ptySessions.delete(sessionId);
        ptySession.kill();
      }
      await Promise.all([
        closeClaudeCompatProxy(sessionId),
        closeCodexCompatibilityProxy(sessionId),
      ]);
      const workspace = workspacesBySessionId.get(sessionId);
      if (workspace) {
        flushTerminalDataTransformer(sessionId, workspace);
        await endPersistenceStream(sessionId, workspace);
      }
      await waitForHistoryOutputFlush(sessionId);
      runtimeOwnerRegistry.release(sessionId, runtimeOwnerId);
      sessions.splice(sessionIndex, 1);
      terminalBuffers.delete(sessionId);
      pendingHistoryOutput.delete(sessionId);
      historyOutputFlushes.delete(sessionId);
      pendingWorkspaceOutput.delete(sessionId);
      workspaceOutputFlushes.delete(sessionId);
      persistenceSanitizers.delete(sessionId);
      terminalDataTransformers.delete(sessionId);
      workspacesBySessionId.delete(sessionId);
      await historyStore?.deleteRecord(sessionId);
    },

    async readTerminalBuffer({ sessionId }: TerminalBufferRequest): Promise<string> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      return terminalBuffers.get(sessionId) ?? await historyStore?.readBuffer(sessionId) ?? '';
    },

    async archiveSessionHistory({
      sessionId,
    }: SessionHistoryArchiveRequest): Promise<SessionHistoryArchiveResult> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }
      if (!historyStore) {
        throw new Error('会话历史存储不可用');
      }

      const workspace = workspacesBySessionId.get(sessionId);
      if (workspace) {
        await flushPersistenceStream(sessionId, workspace);
      } else {
        await waitForHistoryOutputFlush(sessionId);
      }
      const archive = await historyStore.archiveBuffer(sessionId);
      session.historyLimitReached = false;
      session.historyArchivePath = archive.filePath;
      terminalBuffers.set(sessionId, '');
      pendingHistoryOutput.delete(sessionId);
      publishSessionChanged(session);
      return archive;
    },

    async getContextPressure({
      sessionId,
    }: SessionContextPressureRequest): Promise<SessionContextPressureResult> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      const pressure = estimateContextPressure({
        historyBufferBytes: Buffer.byteLength(terminalBuffers.get(sessionId) ?? '', 'utf-8'),
        transcriptBytes: 0,
        sharedContextBytes: 0,
        recentOutputBytesPerMinute: 0,
        historyLimitReached: session.historyLimitReached === true,
      });
      return { sessionId, ...pressure };
    },

    async summarizeSession({
      sessionId,
      continueAfterSummary = false,
    }: SessionSummaryRequest): Promise<SessionSummaryResult> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      const workspace = workspacesBySessionId.get(sessionId);
      if (!workspace) {
        throw new Error('无法找到会话工作区，不能生成摘要');
      }
      if (!summaryJob) {
        throw new Error('总结器尚不可用，请稍后配置真实 CLI runner');
      }

      await flushPersistenceStream(sessionId, workspace);

      return summaryJob({
        session: cloneSession(session),
        workspace: { ...workspace },
        continueAfterSummary,
      });
    },

    onTerminalOutput(listener: TerminalOutputListener): () => void {
      terminalOutputListeners.add(listener);
      return () => {
        terminalOutputListeners.delete(listener);
      };
    },

    onSessionChanged(listener: SessionChangedListener): () => void {
      sessionChangedListeners.add(listener);
      return () => {
        sessionChangedListeners.delete(listener);
      };
    },

    async dispose(): Promise<void> {
      for (const [sessionId, ptySession] of ptySessions.entries()) {
        initialPromptInjectors.get(sessionId)?.cancel();
        initialPromptInjectors.delete(sessionId);
        ptyUnsubscribers.get(sessionId)?.();
        ptyUnsubscribers.delete(sessionId);
        ptySessions.delete(sessionId);
        ptySession.kill();
        const workspace = workspacesBySessionId.get(sessionId);
        if (workspace) {
          flushTerminalDataTransformer(sessionId, workspace);
          await endPersistenceStream(sessionId, workspace);
        }
        const session = findSession(sessionId);
        if (session) {
          session.status = historyStore ? 'interrupted' : 'stopped';
          runtimeOwnerRegistry.release(sessionId, runtimeOwnerId);
          await Promise.all([
            closeClaudeCompatProxy(sessionId),
            closeCodexCompatibilityProxy(sessionId),
          ]);
          delete session.runtimeOwner;
          await saveSessionMetadata(session);
        }
      }

      await Promise.allSettled([
        ...historyOutputFlushes.values(),
        ...workspaceOutputFlushes.values(),
        ...sessionLifecycleFinalizations.values(),
      ]);
      await waitForMetadataSaves();

      ptySessions.clear();
      ptyUnsubscribers.clear();
      initialPromptInjectors.clear();
      // findSession 未命中（会话已被并发删除）时上面的循环不会关闭对应 proxy，这里兜底。
      for (const proxy of claudeCompatProxies.values()) {
        await proxy.close().catch(() => undefined);
      }
      claudeCompatProxies.clear();
      for (const proxy of codexCompatibilityProxies.values()) {
        await proxy.close().catch(() => undefined);
      }
      codexCompatibilityProxies.clear();
      for (const sessionId of [...codexCompatibilityRuntimeHomes.keys()]) {
        await removeCodexCompatibilityRuntimeHome(sessionId);
      }
      terminalBuffers.clear();
      pendingHistoryOutput.clear();
      historyOutputFlushes.clear();
      pendingWorkspaceOutput.clear();
      workspaceOutputFlushes.clear();
      sessionLifecycleFinalizations.clear();
      metadataSavePromises.clear();
      persistenceSanitizers.clear();
      terminalDataTransformers.clear();
      terminalOutputListeners.clear();
      sessionChangedListeners.clear();
      await workspaceContext?.flush?.();
    },
  };
}
