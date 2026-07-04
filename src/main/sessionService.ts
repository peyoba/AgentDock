import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentSession,
  ApiProfile,
  ClaudeLaunchMode,
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
  /** 多窗口时注入每窗口唯一前缀，避免共享 workspace 上下文里的 session ID 冲突 */
  sessionIdPrefix?: string;
  /** 解析 statusLine 使用的 ccline 命令；默认 PATH 已安装版本优先、内嵌二进制兜底 */
  resolveCclineCommand?: () => string;
};

type NormalizedSessionServiceOptions = Required<
  Omit<CreateSessionServiceOptions, 'workspaceExists' | 'workspaceContext'>
> & {
  workspaceExists?: (workspacePath: string) => boolean;
  workspaceContext?: WorkspaceContextStore;
};

type TerminalOutputListener = (event: TerminalOutputEvent) => void;
type ClaudeSettings = Record<string, unknown>;

export type SessionService = {
  launch(input: LaunchSessionInput): Promise<AgentSession>;
  list(): Promise<AgentSession[]>;
  writeTerminal(request: TerminalWriteRequest): Promise<void>;
  resizeTerminal(request: TerminalResizeRequest): Promise<void>;
  killTerminal(request: TerminalKillRequest): Promise<AgentSession>;
  readTerminalBuffer(request: TerminalBufferRequest): Promise<string>;
  onTerminalOutput(listener: TerminalOutputListener): () => void;
  dispose(): Promise<void>;
};

const MAX_TERMINAL_BUFFER_LENGTH = 5_000_000;

const defaultClock: Clock = { now: () => new Date() };

function defaultEnsureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function defaultWriteTextFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function buildCodexConfig(profile: ApiProfile): string {
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
      sessionIdPrefix: '',
      resolveCclineCommand: () => locateCclineCommand({ homeDir }),
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
    sessionIdPrefix: options.sessionIdPrefix ?? '',
    resolveCclineCommand:
      options.resolveCclineCommand ?? (() => locateCclineCommand({ homeDir })),
  };
}

function cloneSession(session: AgentSession): AgentSession {
  return { ...session };
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
    sessionIdPrefix,
    resolveCclineCommand,
  } = normalizeOptions(optionsOrClock);
  const sessions: AgentSession[] = [];
  const ptySessions = new Map<string, PtySession>();
  const ptyUnsubscribers = new Map<string, () => void>();
  const terminalBuffers = new Map<string, string>();
  const terminalOutputListeners = new Set<TerminalOutputListener>();

  const findSession = (sessionId: string): AgentSession | undefined =>
    sessions.find((session) => session.id === sessionId);

  const requirePtySession = (sessionId: string): PtySession => {
    const ptySession = ptySessions.get(sessionId);
    if (!ptySession) {
      throw new Error('未找到指定的终端会话');
    }
    return ptySession;
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

  return {
    async launch({
      profile,
      workspace,
      command,
      claudeLaunchMode,
    }: LaunchSessionInput): Promise<AgentSession> {
      if (
        workspaceExists &&
        !isMacosProtectedUserFolderPath(workspace.path) &&
        !workspaceExists(workspace.path)
      ) {
        throw new Error(`工作区路径不可用: ${workspace.path}`);
      }

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
            await writeTextFile(path.join(env.CODEX_HOME, 'config.toml'), buildCodexConfig(profile));
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

          if (claudeLaunchMode === 'lite') {
            const mcpConfigDirectory = path.join(appDataPath, 'claude-mcp');
            const mcpConfigPath = path.join(mcpConfigDirectory, 'empty.json');
            await ensureDirectory(mcpConfigDirectory);
            await writeTextFile(mcpConfigPath, buildEmptyClaudeMcpConfig());
            spawnCommand = appendClaudeSettingSourcesCommand(spawnCommand);
            spawnCommand = appendClaudeMcpConfigCommand(spawnCommand, mcpConfigPath);
          }
        }

        const ptySession = await pty.spawn({
          sessionId: session.id,
          command: spawnCommand,
          cwd: workspace.path,
          env,
        });

        ptySessions.set(session.id, ptySession);
        const unsubscribeData = ptySession.onData((data) => {
          publishTerminalOutput({ sessionId: session.id, data });
          void workspaceContext?.appendOutput({ workspace, sessionId: session.id, data }).catch(
            () => undefined,
          );
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
        return cloneSession(session);
      } catch (error) {
        session.status = 'failed';
        if (isSecretReadError(error)) {
          throw error;
        }
        throw new Error(`终端命令启动失败: "${command}"`);
      }
    },

    async list(): Promise<AgentSession[]> {
      return sessions.map(cloneSession);
    },

    async writeTerminal({ sessionId, input }: TerminalWriteRequest): Promise<void> {
      requirePtySession(sessionId).write(input);
    },

    async resizeTerminal({ sessionId, cols, rows }: TerminalResizeRequest): Promise<void> {
      requirePtySession(sessionId).resize(cols, rows);
    },

    async killTerminal({ sessionId }: TerminalKillRequest): Promise<AgentSession> {
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      // 进程自行退出后 PTY 已被清理；关闭标签页时只需收尾状态和缓冲
      const ptySession = ptySessions.get(sessionId);
      if (ptySession) {
        ptySession.kill();
        ptyUnsubscribers.get(sessionId)?.();
        ptyUnsubscribers.delete(sessionId);
        ptySessions.delete(sessionId);
      }
      terminalBuffers.delete(sessionId);
      session.status = 'stopped';
      return cloneSession(session);
    },

    async readTerminalBuffer({ sessionId }: TerminalBufferRequest): Promise<string> {
      const session = findSession(sessionId);
      if (!session) {
        throw new Error('未找到指定的终端会话');
      }

      return terminalBuffers.get(sessionId) ?? '';
    },

    onTerminalOutput(listener: TerminalOutputListener): () => void {
      terminalOutputListeners.add(listener);
      return () => {
        terminalOutputListeners.delete(listener);
      };
    },

    async dispose(): Promise<void> {
      for (const [sessionId, ptySession] of ptySessions.entries()) {
        ptySession.kill();
        ptyUnsubscribers.get(sessionId)?.();
        const session = findSession(sessionId);
        if (session) {
          session.status = 'stopped';
        }
      }

      ptySessions.clear();
      ptyUnsubscribers.clear();
      terminalBuffers.clear();
      terminalOutputListeners.clear();
      await workspaceContext?.flush?.();
    },
  };
}
