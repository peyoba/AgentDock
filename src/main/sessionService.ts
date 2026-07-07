import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentSession,
  ApiProfile,
  ClaudeLaunchMode,
  CloseSessionViewRequest,
  RuntimeOwner,
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
import type { KeychainAdapter } from './adapters/keychainAdapter.js';
import { createUnavailableKeychainAdapter } from './adapters/keychainAdapter.js';
import type { PtyAdapter, PtySession } from './adapters/ptyAdapter.js';
import { createUnavailablePtyAdapter } from './adapters/ptyAdapter.js';
import { resolveCclineCommand as locateCclineCommand } from './cclineLocator.js';
import { estimateContextPressure } from './contextBudgetEstimator.js';
import {
  createRestoreContextStore,
  type RestoreContextResult,
} from './restoreContextStore.js';
import { createSessionSummaryStore } from './sessionSummaryStore.js';
import { sanitizePersistedTerminalOutput } from './terminalOutputSanitizer.js';
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
};

type RestartSessionInput = {
  sessionId: string;
  profile: ApiProfile;
  workspace: Workspace;
  command?: string;
  claudeLaunchMode?: ClaudeLaunchMode;
};

type SummaryJobDelegate = (request: {
  session: AgentSession;
  workspace: Workspace;
  continueAfterSummary: boolean;
}) => Promise<SessionSummaryResult>;

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
  workspaceExists?: (workspacePath: string) => boolean;
  workspaceContext?: WorkspaceContextStore;
  historyStore?: SessionHistoryStore;
  restoreHistory?: boolean;
  /** 多窗口时注入每窗口唯一前缀，避免共享 workspace 上下文里的 session ID 冲突 */
  sessionIdPrefix?: string;
  runtimeOwnerId?: string;
  runtimeOwnerRegistry?: RuntimeOwnerRegistry;
  /** 解析 statusLine 使用的 ccline 命令；默认 PATH 已安装版本优先、内嵌二进制兜底 */
  resolveCclineCommand?: () => string;
  summaryJob?: SummaryJobDelegate;
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

function appendInitialPromptCommand(command: string, initialPrompt: string | undefined): string {
  const prompt = initialPrompt?.trim();
  return prompt ? `${command} ${shellQuote(prompt)}` : command;
}

function appendClaudeSystemPromptCommand(command: string, systemPrompt: string | undefined): string {
  const prompt = systemPrompt?.trim();
  return prompt ? `${command} --append-system-prompt ${shellQuote(prompt)}` : command;
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
  resolveCclineCommand: () => string,
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
    settings.statusLine = {
      type: 'command',
      command: shellSafeStatusLineCommand(resolveCclineCommand()),
      padding: 0,
    };
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
    const homeDir = process.env.HOME ?? process.cwd();
    return {
      clock: optionsOrClock,
      keychain: createUnavailableKeychainAdapter(),
      pty: createUnavailablePtyAdapter(),
      appDataPath: process.cwd(),
      homeDir,
      ensureDirectory: defaultEnsureDirectory,
      writeTextFile: defaultWriteTextFile,
      workspaceExists: undefined,
      workspaceContext: undefined,
      historyStore: undefined,
      restoreHistory: true,
      sessionIdPrefix: '',
      runtimeOwnerId: 'default-window',
      runtimeOwnerRegistry: createRuntimeOwnerRegistry(),
      resolveCclineCommand: () => locateCclineCommand({ homeDir }),
      summaryJob: undefined,
    };
  }

  const options = optionsOrClock as CreateSessionServiceOptions;
  const homeDir = options.homeDir ?? process.env.HOME ?? process.cwd();

  return {
    clock: options.clock ?? defaultClock,
    keychain: options.keychain ?? createUnavailableKeychainAdapter(),
    pty: options.pty ?? createUnavailablePtyAdapter(),
    appDataPath: options.appDataPath ?? process.cwd(),
    homeDir,
    ensureDirectory: options.ensureDirectory ?? defaultEnsureDirectory,
    writeTextFile: options.writeTextFile ?? defaultWriteTextFile,
    workspaceExists: options.workspaceExists,
    workspaceContext: options.workspaceContext,
    historyStore: options.historyStore,
    restoreHistory: options.restoreHistory ?? true,
    sessionIdPrefix: options.sessionIdPrefix ?? '',
    runtimeOwnerId: options.runtimeOwnerId ?? 'default-window',
    runtimeOwnerRegistry: options.runtimeOwnerRegistry ?? createRuntimeOwnerRegistry(),
    resolveCclineCommand:
      options.resolveCclineCommand ?? (() => locateCclineCommand({ homeDir })),
    summaryJob: options.summaryJob,
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

function isLocalShellCommand(command: string): boolean {
  const normalizedCommand = command.trim().split(/\s+/)[0] ?? '';
  const shellName = path.basename(normalizedCommand);
  return shellName === 'zsh' || shellName === 'bash';
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
    workspaceExists,
    workspaceContext,
    historyStore,
    restoreHistory,
    sessionIdPrefix,
    runtimeOwnerId,
    runtimeOwnerRegistry,
    resolveCclineCommand,
    summaryJob,
  } = normalizeOptions(optionsOrClock);
  const sessions: AgentSession[] = [];
  const ptySessions = new Map<string, PtySession>();
  const ptyUnsubscribers = new Map<string, () => void>();
  const terminalBuffers = new Map<string, string>();
  const workspacesBySessionId = new Map<string, Workspace>();
  const pendingHistoryOutput = new Map<string, string>();
  const historyOutputFlushes = new Map<string, Promise<void>>();
  const restoreContextStore = createRestoreContextStore();
  const sessionSummaryStore = createSessionSummaryStore();
  const terminalOutputListeners = new Set<TerminalOutputListener>();
  const sessionChangedListeners = new Set<SessionChangedListener>();
  let historyLoaded = false;

  const findSession = (sessionId: string): AgentSession | undefined =>
    sessions.find((session) => session.id === sessionId);

  const loadHistory = async (): Promise<void> => {
    if (historyLoaded) {
      return;
    }

    historyLoaded = true;
    if (!restoreHistory) {
      return;
    }

    const persistedSessions = await historyStore?.listSessions() ?? [];
    for (const persistedSession of persistedSessions) {
      const session = { ...persistedSession };
      if (session.status === 'running' || session.status === 'starting') {
        const activeOwner = runtimeOwnerRegistry.get(session.id);
        if (activeOwner) {
          session.status = 'running';
          session.runtimeOwner = activeOwner;
        } else {
          session.status = 'interrupted';
          delete session.runtimeOwner;
          await historyStore?.saveSession(session);
        }
      }
      sessions.push(session);
      terminalBuffers.set(session.id, await historyStore?.readBuffer(session.id) ?? '');
    }
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

  const persistSession = (session: AgentSession): void => {
    void historyStore?.saveSession(cloneSession(session)).catch(() => undefined);
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
        // Terminal replay remains available from the in-memory buffer; persistence catches up later.
      }
    }
  };

  const queueHistoryOutput = (sessionId: string, data: string): void => {
    if (!historyStore) {
      return;
    }

    const session = findSession(sessionId);
    if (!session || session.historyLimitReached) {
      return;
    }

    const persistedOutput = sanitizePersistedTerminalOutput(data);
    if (!persistedOutput) {
      return;
    }

    pendingHistoryOutput.set(
      sessionId,
      `${pendingHistoryOutput.get(sessionId) ?? ''}${persistedOutput}`,
    );
    if (!historyOutputFlushes.has(sessionId)) {
      const flush = flushHistoryOutput(sessionId);
      historyOutputFlushes.set(sessionId, flush);
    }
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

    queueHistoryOutput(event.sessionId, event.data);
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
    initialPrompt,
  }: {
    session: AgentSession;
    profile: ApiProfile;
    workspace: Workspace;
    command: string;
    claudeLaunchMode?: ClaudeLaunchMode;
    initialPrompt?: string;
  }): Promise<AgentSession> => {
    ensureWorkspaceAvailable(workspace);
    if (ptySessions.has(session.id)) {
      throw new Error('会话仍在运行，无法重启');
    }
    const startedAt = clock.now().toISOString();
    const owner: RuntimeOwner = { ownerId: runtimeOwnerId, startedAt };
    if (!runtimeOwnerRegistry.claim(session.id, owner)) {
      throw new Error('该会话正在另一窗口运行');
    }

    const effectiveClaudeLaunchMode =
      profile.toolType === 'claude' && !isLocalShellCommand(command)
        ? claudeLaunchMode ?? session.claudeLaunchMode
        : undefined;

    session.title = `${profile.name} · ${workspace.name}`;
    session.profileId = profile.id;
    session.workspaceId = workspace.id;
    session.command = command;
    if (effectiveClaudeLaunchMode) {
      session.claudeLaunchMode = effectiveClaudeLaunchMode;
    } else {
      delete session.claudeLaunchMode;
    }
    session.status = 'starting';
    session.startedAt = startedAt;
    session.runtimeOwner = owner;
    workspacesBySessionId.set(session.id, { ...workspace });
    delete session.exitedAt;
    delete session.exitCode;
    delete session.exitSignal;
    delete session.resumeCommand;
    delete session.memoryRestore;
    persistSession(session);

    try {
      const contextFiles = await workspaceContext?.startSession({ workspace, session });
      const baseEnv = isLocalShellCommand(command)
        ? {}
        : buildLaunchEnvironment({
            profile,
            secret: await keychain.readSecret(
              profile.keychainService,
              profile.keychainAccount,
            ),
            appDataPath,
            homeDir,
          });
      const env = {
        ...baseEnv,
        ...contextEnvironment(contextFiles),
      };
      let spawnCommand = command;

      if (env.CODEX_HOME) {
        await ensureDirectory(env.CODEX_HOME);
        if (profile.toolType === 'codex') {
          await writeTextFile(
            path.join(env.CODEX_HOME, 'config.toml'),
            buildCodexConfig(profile, workspace),
          );
        }
      }

      if (!isLocalShellCommand(command) && profile.toolType === 'claude') {
        const settings = buildClaudeSettings(profile, resolveCclineCommand);
        if (settings) {
          const settingsDirectory = path.join(appDataPath, 'claude-settings');
          const settingsPath = path.join(settingsDirectory, `${profile.id}.json`);
          await ensureDirectory(settingsDirectory);
          await writeTextFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
          spawnCommand = appendClaudeSettingsCommand(command, settingsPath);
        }

        if (effectiveClaudeLaunchMode === 'lite') {
          const mcpConfigDirectory = path.join(appDataPath, 'claude-mcp');
          const mcpConfigPath = path.join(mcpConfigDirectory, 'empty.json');
          await ensureDirectory(mcpConfigDirectory);
          await writeTextFile(mcpConfigPath, buildEmptyClaudeMcpConfig());
          spawnCommand = appendClaudeSettingSourcesCommand(spawnCommand);
          spawnCommand = appendClaudeMcpConfigCommand(spawnCommand, mcpConfigPath);
        }
      }

      spawnCommand = profile.toolType === 'claude' && !isLocalShellCommand(command)
        ? appendClaudeSystemPromptCommand(spawnCommand, initialPrompt)
        : appendInitialPromptCommand(spawnCommand, initialPrompt);

      const ptySession = await pty.spawn({
        sessionId: session.id,
        command: spawnCommand,
        cwd: workspace.path,
        env,
      });

      ptySessions.set(session.id, ptySession);
      const unsubscribeData = ptySession.onData((data) => {
        publishTerminalOutput({ sessionId: session.id, data });
        const persistedOutput = sanitizePersistedTerminalOutput(data);
        if (persistedOutput) {
          void workspaceContext?.appendOutput({
            workspace,
            sessionId: session.id,
            data: persistedOutput,
          }).catch(() => undefined);
        }
      });
      const unsubscribeExit = ptySession.onExit?.((event) => {
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
        session.resumeCommand = extractClaudeResumeCommand(
          terminalBuffers.get(session.id) ?? '',
        );
        persistSession(session);
        publishSessionChanged(session);
        publishTerminalOutput({
          sessionId: session.id,
          data: `\r\n\u001b[2m[AgentDock] 进程已退出（exit code ${event.exitCode}），会话已结束，可关闭此标签页。\u001b[0m\r\n`,
        });
      });
      ptyUnsubscribers.set(session.id, () => {
        unsubscribeData();
        unsubscribeExit?.();
      });
      session.status = 'running';
      session.runtimeOwner = owner;
      persistSession(session);
      return cloneSession(session);
    } catch (error) {
      runtimeOwnerRegistry.release(session.id, runtimeOwnerId);
      delete session.runtimeOwner;
      session.status = 'failed';
      persistSession(session);
      if (isSecretReadError(error)) {
        throw error;
      }
      throw new Error(`终端命令启动失败: "${command}"`);
    }
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

    const transcriptTail = terminalBuffers.get(session.id) ?? await historyStore?.readBuffer(session.id) ?? '';
    const latestSummary = await sessionSummaryStore.readLatestSummary({
      workspacePath: workspace.path,
      sessionId: session.id,
    });
    const summaryMarkdown = latestSummary?.handoffMarkdown ?? latestSummary?.summaryMarkdown;

    return restoreContextStore.writeRestoreContext({
      workspacePath: workspace.path,
      session,
      summaryMarkdown,
      transcriptTail,
    }).catch((error: unknown) => ({
      status: 'failed' as const,
      summary: '记忆恢复失败',
      error: error instanceof Error ? error.message : '未知错误',
    }));
  }

  return {
    async launch({
      profile,
      workspace,
      command,
      claudeLaunchMode,
    }: LaunchSessionInput): Promise<AgentSession> {
      await loadHistory();
      ensureWorkspaceAvailable(workspace);
      const session: AgentSession = {
        id: `session-${sessionIdPrefix}${sessions.length + 1}`,
        title: `${profile.name} · ${workspace.name}`,
        profileId: profile.id,
        workspaceId: workspace.id,
        command,
        status: 'starting',
        startedAt: clock.now().toISOString(),
      };

      sessions.push(session);
      return startSessionPty({ session, profile, workspace, command, claudeLaunchMode });
    },

    async restart({
      sessionId,
      profile,
      workspace,
      command,
      claudeLaunchMode,
    }: RestartSessionInput): Promise<AgentSession> {
      await loadHistory();
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      const nextCommand = command ?? session.command;
      const nativeResume = nativeResumeCommandForSession(session, profile);
      if (nativeResume) {
        await startSessionPty({
          session,
          profile,
          workspace,
          command: nativeResume.command,
          claudeLaunchMode,
        });
        session.memoryRestore = {
          method: 'native',
          status: 'loaded',
          summary: nativeResume.summary,
        };
        persistSession(session);
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
      await startSessionPty({
        session,
        profile,
        workspace,
        command: nextCommand,
        claudeLaunchMode,
        initialPrompt,
      });
      if (memoryRestore) {
        session.memoryRestore = {
          method: memoryRestore.status === 'loaded' ? 'agentdock' : 'none',
          status: memoryRestore.status,
          summary: memoryRestore.summary,
          contextFile: memoryRestore.contextFile,
          error: memoryRestore.error,
        };
        persistSession(session);
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
        ptySession.kill();
        ptyUnsubscribers.get(sessionId)?.();
        ptyUnsubscribers.delete(sessionId);
        ptySessions.delete(sessionId);
      }
      pendingHistoryOutput.delete(sessionId);
      session.status = 'stopped';
      runtimeOwnerRegistry.release(sessionId, runtimeOwnerId);
      delete session.runtimeOwner;
      await historyStore?.saveSession(session);
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
        ptySession.kill();
        ptyUnsubscribers.get(sessionId)?.();
        ptyUnsubscribers.delete(sessionId);
        ptySessions.delete(sessionId);
      }
      runtimeOwnerRegistry.release(sessionId, runtimeOwnerId);
      sessions.splice(sessionIndex, 1);
      terminalBuffers.delete(sessionId);
      pendingHistoryOutput.delete(sessionId);
      historyOutputFlushes.delete(sessionId);
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
        ptySession.kill();
        ptyUnsubscribers.get(sessionId)?.();
        const session = findSession(sessionId);
        if (session) {
          session.status = historyStore ? 'interrupted' : 'stopped';
          runtimeOwnerRegistry.release(sessionId, runtimeOwnerId);
          delete session.runtimeOwner;
          await historyStore?.saveSession(session);
        }
      }

      ptySessions.clear();
      ptyUnsubscribers.clear();
      terminalBuffers.clear();
      pendingHistoryOutput.clear();
      historyOutputFlushes.clear();
      terminalOutputListeners.clear();
      sessionChangedListeners.clear();
      await workspaceContext?.flush?.();
    },
  };
}
