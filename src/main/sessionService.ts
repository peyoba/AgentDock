import type {
  AgentSession,
  ApiProfile,
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
import { buildLaunchEnvironment } from './launchEnvironment.js';

type Clock = {
  now(): Date;
};

type LaunchSessionInput = {
  profile: ApiProfile;
  workspace: Workspace;
  command: string;
};

type CreateSessionServiceOptions = {
  clock?: Clock;
  keychain?: KeychainAdapter;
  pty?: PtyAdapter;
  appDataPath?: string;
  workspaceExists?: (workspacePath: string) => boolean;
};

type NormalizedSessionServiceOptions = Required<Omit<CreateSessionServiceOptions, 'workspaceExists'>> & {
  workspaceExists?: (workspacePath: string) => boolean;
};

type TerminalOutputListener = (event: TerminalOutputEvent) => void;

export type SessionService = {
  launch(input: LaunchSessionInput): Promise<AgentSession>;
  list(): Promise<AgentSession[]>;
  writeTerminal(request: TerminalWriteRequest): Promise<void>;
  resizeTerminal(request: TerminalResizeRequest): Promise<void>;
  killTerminal(request: TerminalKillRequest): Promise<AgentSession>;
  onTerminalOutput(listener: TerminalOutputListener): () => void;
};

const defaultClock: Clock = { now: () => new Date() };

function normalizeOptions(
  optionsOrClock: Clock | CreateSessionServiceOptions = {},
): NormalizedSessionServiceOptions {
  if ('now' in optionsOrClock && typeof optionsOrClock.now === 'function') {
    return {
      clock: optionsOrClock,
      keychain: createUnavailableKeychainAdapter(),
      pty: createUnavailablePtyAdapter(),
      appDataPath: process.cwd(),
      workspaceExists: undefined,
    };
  }

  const options = optionsOrClock as CreateSessionServiceOptions;

  return {
    clock: options.clock ?? defaultClock,
    keychain: options.keychain ?? createUnavailableKeychainAdapter(),
    pty: options.pty ?? createUnavailablePtyAdapter(),
    appDataPath: options.appDataPath ?? process.cwd(),
    workspaceExists: options.workspaceExists,
  };
}

function cloneSession(session: AgentSession): AgentSession {
  return { ...session };
}

export function createSessionService(
  optionsOrClock?: Clock | CreateSessionServiceOptions,
): SessionService {
  const { clock, keychain, pty, appDataPath, workspaceExists } = normalizeOptions(optionsOrClock);
  const sessions: AgentSession[] = [];
  const ptySessions = new Map<string, PtySession>();
  const ptyUnsubscribers = new Map<string, () => void>();
  const terminalOutputListeners = new Set<TerminalOutputListener>();

  const findSession = (sessionId: string): AgentSession | undefined =>
    sessions.find((session) => session.id === sessionId);

  const requirePtySession = (sessionId: string): PtySession => {
    const ptySession = ptySessions.get(sessionId);
    if (!ptySession) {
      throw new Error('Terminal session was not found');
    }
    return ptySession;
  };

  const publishTerminalOutput = (event: TerminalOutputEvent): void => {
    for (const listener of terminalOutputListeners) {
      listener(event);
    }
  };

  return {
    async launch({ profile, workspace, command }: LaunchSessionInput): Promise<AgentSession> {
      if (workspaceExists && !workspaceExists(workspace.path)) {
        throw new Error(`Workspace path is not available: ${workspace.path}`);
      }

      const session: AgentSession = {
        id: `session-${sessions.length + 1}`,
        title: `${profile.name} · ${workspace.name}`,
        profileId: profile.id,
        workspaceId: workspace.id,
        command,
        status: 'starting',
        startedAt: clock.now().toISOString(),
      };

      sessions.push(session);

      try {
        const secret = await keychain.readSecret(
          profile.keychainService,
          profile.keychainAccount,
        );
        const env = buildLaunchEnvironment({ profile, secret, appDataPath });
        const ptySession = await pty.spawn({
          sessionId: session.id,
          command,
          cwd: workspace.path,
          env,
        });

        ptySessions.set(session.id, ptySession);
        ptyUnsubscribers.set(
          session.id,
          ptySession.onData((data) => publishTerminalOutput({ sessionId: session.id, data })),
        );
        session.status = 'running';
        return cloneSession(session);
      } catch (error) {
        session.status = 'failed';
        if (error instanceof Error && error.message.startsWith('Keychain secret was not found')) {
          throw error;
        }
        throw new Error(`Failed to launch terminal command "${command}"`);
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
      const ptySession = requirePtySession(sessionId);
      ptySession.kill();
      ptyUnsubscribers.get(sessionId)?.();
      ptyUnsubscribers.delete(sessionId);
      ptySessions.delete(sessionId);

      const session = findSession(sessionId);
      if (!session) {
        throw new Error('Terminal session was not found');
      }
      session.status = 'stopped';
      return cloneSession(session);
    },

    onTerminalOutput(listener: TerminalOutputListener): () => void {
      terminalOutputListeners.add(listener);
      return () => {
        terminalOutputListeners.delete(listener);
      };
    },
  };
}
