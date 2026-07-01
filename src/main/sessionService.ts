import type { AgentSession, ApiProfile, Workspace } from '../shared/agentdockTypes.js';
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
};

export type SessionService = {
  launch(input: LaunchSessionInput): Promise<AgentSession>;
  list(): Promise<AgentSession[]>;
};

const defaultClock: Clock = { now: () => new Date() };

function normalizeOptions(
  optionsOrClock: Clock | CreateSessionServiceOptions = {},
): Required<CreateSessionServiceOptions> {
  if ('now' in optionsOrClock && typeof optionsOrClock.now === 'function') {
    return {
      clock: optionsOrClock,
      keychain: createUnavailableKeychainAdapter(),
      pty: createUnavailablePtyAdapter(),
      appDataPath: process.cwd(),
    };
  }

  const options = optionsOrClock as CreateSessionServiceOptions;

  return {
    clock: options.clock ?? defaultClock,
    keychain: options.keychain ?? createUnavailableKeychainAdapter(),
    pty: options.pty ?? createUnavailablePtyAdapter(),
    appDataPath: options.appDataPath ?? process.cwd(),
  };
}

export function createSessionService(
  optionsOrClock?: Clock | CreateSessionServiceOptions,
): SessionService {
  const { clock, keychain, pty, appDataPath } = normalizeOptions(optionsOrClock);
  const sessions: AgentSession[] = [];
  const ptySessions = new Map<string, PtySession>();

  return {
    async launch({ profile, workspace, command }: LaunchSessionInput): Promise<AgentSession> {
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
      session.status = 'running';
      return { ...session };
    },

    async list(): Promise<AgentSession[]> {
      return sessions.map((session) => ({ ...session }));
    },
  };
}
