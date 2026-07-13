import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { ApiConfigPanel, type ApiConfigFilter } from './components/ApiConfigPanel';
import { AppHeader } from './components/AppHeader';
import { CommandBar, type LaunchModeSelection } from './components/CommandBar';
import { ProjectPanel } from './components/ProjectPanel';
import { SessionDetailsDrawer } from './components/SessionDetailsDrawer';
import { SessionLibrary } from './components/SessionLibrary';
import { TerminalPane } from './components/TerminalPane';
import { defaultApiProfiles } from '../shared/defaultApiProfiles';
import { sessionStatusLabel } from '../shared/sessionStatusLabels';
import { readableSessionHistory, terminalOutputToPlainText } from '../shared/terminalText';
import type {
  AgentSession,
  AppBuildInfo,
  AppUpdateCheckResult,
  ApiProfile,
  ClaudeLaunchMode,
  CodexLaunchMode,
  LaunchRequest,
  RestartSessionRequest,
  SessionContextPressureResult,
  WorkspaceDirectoryRequest,
  WorkspaceDirectoryResult,
  Workspace,
} from '../shared/agentdockTypes';

type ActivePage = 'workbench' | 'apiConfig';

const fallbackProfiles: ApiProfile[] = defaultApiProfiles;

const fallbackWorkspaces: Workspace[] = [
  {
    id: 'agentdock',
    name: 'AgentDock 预览',
    path: '/tmp/agentdock-preview',
  },
];

const fallbackSessions: AgentSession[] = [
  {
    id: 'claude-anyrouter',
    title: 'Claude AnyRouter · AgentDock',
    profileId: 'claude-anyrouter',
    workspaceId: 'agentdock',
    command: 'claude',
    status: 'running',
    startedAt: '2026-07-02T00:00:00.000Z',
  },
  {
    id: 'codex-openai',
    title: 'Codex OpenAI · AgentDock',
    profileId: 'codex-openai',
    workspaceId: 'agentdock',
    command: 'codex',
    status: 'running',
    startedAt: '2026-07-02T00:00:00.000Z',
  },
  {
    id: 'claude-kimi',
    title: 'Claude Kimi · 文档库',
    profileId: 'claude-kimi',
    workspaceId: 'agentdock',
    command: 'claude',
    status: 'running',
    startedAt: '2026-07-02T00:00:00.000Z',
  },
];

const fallbackBuildInfo: AppBuildInfo = {
  version: '0.1.0',
  buildId: 'preview',
  buildTime: '2026-07-08T00:00:00.000Z',
  commit: 'unknown',
  commitShort: 'unknown',
  dirty: false,
};

const SESSION_LIBRARY_DEFAULT_WIDTH = 260;
const SESSION_LIBRARY_MIN_WIDTH = 220;
const SESSION_LIBRARY_MAX_WIDTH = 420;
const PROJECT_PANEL_DEFAULT_WIDTH = 360;
const PROJECT_PANEL_MIN_WIDTH = 280;
const PROJECT_PANEL_MAX_WIDTH = 520;
const PANEL_KEYBOARD_RESIZE_STEP = 10;

function defaultCommandFor(profile?: ApiProfile): string {
  if (profile?.toolType === 'codex') {
    const bypass = profile.bypassApprovals ?? true;
    return bypass
      ? 'codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust'
      : 'codex --no-alt-screen';
  }

  if (profile?.toolType === 'claude') {
    const skip = profile.skipPermissions ?? true;
    return skip ? 'claude --dangerously-skip-permissions' : 'claude';
  }

  return profile?.toolType ?? 'claude --dangerously-skip-permissions';
}

function defaultLaunchModeFor(profile: ApiProfile | undefined): LaunchModeSelection {
  return profile?.toolType === 'codex'
    ? profile.codexDefaultLaunchMode ?? 'native-responses'
    : 'lite';
}

function launchModeMatchesProfile(
  launchMode: LaunchModeSelection,
  profile: ApiProfile | undefined,
): boolean {
  if (launchMode === 'local-shell') {
    return profile?.toolType === 'claude' || profile?.toolType === 'codex';
  }
  if (profile?.toolType === 'claude') {
    return launchMode === 'lite' || launchMode === 'full';
  }
  if (profile?.toolType === 'codex') {
    return launchMode === 'native-responses' || launchMode === 'newapi-tool-compatible';
  }
  return false;
}

function safeLaunchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return '启动失败，请检查配置。';
  }

  const [firstLine] = error.message.split(/[;\n]/);
  return firstLine || '启动失败，请检查配置。';
}

function upsertWorkspace(workspaces: Workspace[], nextWorkspace: Workspace): Workspace[] {
  const existingIndex = workspaces.findIndex(
    (workspace) => workspace.id === nextWorkspace.id || workspace.path === nextWorkspace.path,
  );

  if (existingIndex === -1) {
    return [...workspaces, nextWorkspace];
  }

  return workspaces.map((workspace, index) => (index === existingIndex ? nextWorkspace : workspace));
}

function upsertSession(sessions: AgentSession[], nextSession: AgentSession): AgentSession[] {
  if (!sessions.some((session) => session.id === nextSession.id)) {
    return [...sessions, nextSession];
  }

  return sessions.map((session) => (session.id === nextSession.id ? nextSession : session));
}

function exitedSessionLabel(session: AgentSession): string {
  const exitCode = session.exitCode ?? 'unknown';
  return session.exitCode === 0
    ? `会话已退出 · exit code ${exitCode}`
    : `异常退出 · exit code ${exitCode}`;
}

function inactiveSessionLabel(session: AgentSession): string {
  if (session.status === 'interrupted') {
    return '会话已中断 · 可重新启动';
  }
  if (session.status === 'failed') {
    return '启动失败 · 可重新启动';
  }
  return exitedSessionLabel(session);
}

function isLiveSession(session: AgentSession | undefined): boolean {
  return session?.status === 'running' || session?.status === 'starting';
}

function commandExecutableName(command: string): string {
  const executable = command.trim().split(/\s+/)[0] ?? '';
  return executable.split('/').pop() ?? executable;
}

function compactCommandLabel(command: string): string {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 3) {
    return command;
  }

  return `${parts.slice(0, 2).join(' ')} ... ${parts[parts.length - 1]}`;
}

function isSummarySupportedAgentSession(
  session: AgentSession | undefined,
  profile: ApiProfile | undefined,
): session is AgentSession {
  if (!session || !profile) {
    return false;
  }

  const executable = commandExecutableName(session.command);
  return (
    (profile.toolType === 'claude' && executable === 'claude') ||
    (profile.toolType === 'codex' && executable === 'codex')
  );
}

function addSessionLaunchMode(
  request: LaunchRequest | RestartSessionRequest,
  session: AgentSession,
  profile: ApiProfile | undefined,
): void {
  const executable = commandExecutableName(session.command);
  if (profile?.toolType === 'claude' && executable === 'claude' && session.claudeLaunchMode) {
    request.claudeLaunchMode = session.claudeLaunchMode;
  } else if (profile?.toolType === 'codex' && executable === 'codex' && session.codexLaunchMode) {
    request.codexLaunchMode = session.codexLaunchMode;
  }
}

function isRecoverableSession(session: AgentSession | undefined): session is AgentSession {
  return (
    session?.status === 'stopped' ||
    session?.status === 'exited' ||
    session?.status === 'interrupted' ||
    session?.status === 'failed'
  );
}

function SessionRecoveryBar({
  session,
  onResume,
  onFreshRestart,
  onCopyOutput,
}: {
  session: AgentSession;
  onResume(): void;
  onFreshRestart(): void;
  onCopyOutput(): void;
}): React.JSX.Element {
  const isErrorExit = session.status === 'exited' && session.exitCode !== 0;

  return (
    <div
      className={isErrorExit ? 'session-exit-bar session-exit-bar-error' : 'session-exit-bar'}
      role="status"
      aria-label="会话退出状态"
    >
      <span>{inactiveSessionLabel(session)}</span>
      <div className="session-exit-actions">
        <button type="button" onClick={onResume}>
          继续上次对话
        </button>
        <button type="button" onClick={onFreshRestart}>
          按原配置重新开始
        </button>
        <button type="button" onClick={onCopyOutput}>
          复制输出
        </button>
      </div>
    </div>
  );
}

function SessionContextBar({
  pressure,
  handoffPrompt,
  onSummarize,
  onSummarizeAndContinue,
  onCopyPrompt,
}: {
  pressure: SessionContextPressureResult;
  handoffPrompt?: string;
  onSummarize(): void;
  onSummarizeAndContinue(): void;
  onCopyPrompt(): void;
}): React.JSX.Element | null {
  if (pressure.level !== 'high' && pressure.level !== 'full') {
    return null;
  }

  return (
    <div className="session-context-bar" role="status" aria-label="上下文压力状态">
      <span>
        {pressure.level === 'full' ? '续接材料已达上限' : '续接材料偏大'} · {pressure.score}
      </span>
      <div className="session-exit-actions">
        <button type="button" onClick={onSummarize}>
          总结当前会话
        </button>
        <button type="button" onClick={onSummarizeAndContinue}>
          总结并续开
        </button>
        {handoffPrompt ? (
          <button type="button" onClick={onCopyPrompt}>
            复制续接提示
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SessionMemoryRestoreBar({
  restore,
  onDismiss,
}: {
  restore?: AgentSession['memoryRestore'];
  onDismiss?(): void;
}): React.JSX.Element | null {
  if (!restore) {
    return null;
  }

  const className = restore.status === 'failed'
    ? 'session-memory-restore session-memory-restore-error'
    : 'session-memory-restore';
  const summary = terminalOutputToPlainText(restore.summary)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0] ?? '记忆恢复状态不可读';

  return (
    <div className={className} role="status" aria-label="记忆恢复状态">
      <span>{summary}</span>
      {onDismiss ? (
        <button
          type="button"
          className="session-memory-restore-dismiss"
          aria-label="隐藏记忆恢复提示"
          title="隐藏这条提示"
          onClick={onDismiss}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

export default function App(): React.JSX.Element {
  const api = typeof window === 'undefined' ? undefined : window.agentDock;
  const rendererProtocol = typeof window === 'undefined' ? '' : window.location.protocol;
  const isPackagedRenderer = rendererProtocol === 'file:';
  if (!api && isPackagedRenderer) {
    return (
      <main className="app-shell">
        <section role="alert" className="launch-error">
          AgentDock 主进程连接失败，请重新启动应用。若问题持续，请重新安装当前版本。
        </section>
      </main>
    );
  }

  const [activePage, setActivePage] = React.useState<ActivePage>('workbench');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [projectPanelOpen, setProjectPanelOpen] = React.useState(false);
  const [sessionLibraryWidth, setSessionLibraryWidth] = React.useState(
    SESSION_LIBRARY_DEFAULT_WIDTH,
  );
  const [projectPanelWidth, setProjectPanelWidth] = React.useState(
    PROJECT_PANEL_DEFAULT_WIDTH,
  );
  const [profiles, setProfiles] = React.useState<ApiProfile[]>(api ? [] : fallbackProfiles);
  const profilesRef = React.useRef(profiles);
  profilesRef.current = profiles;
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>(api ? [] : fallbackWorkspaces);
  const [sessions, setSessions] = React.useState<AgentSession[]>(api ? [] : fallbackSessions);
  const sessionsRef = React.useRef(sessions);
  React.useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const [buildInfo, setBuildInfo] = React.useState<AppBuildInfo | undefined>(
    api ? undefined : fallbackBuildInfo,
  );
  const [updateResult, setUpdateResult] = React.useState<AppUpdateCheckResult | undefined>();
  const [checkingForUpdates, setCheckingForUpdates] = React.useState(false);
  const updateCheckInFlightRef = React.useRef(false);
  const [selectedProfileId, setSelectedProfileId] = React.useState<string | undefined>(
    api ? undefined : fallbackProfiles[0]?.id,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string | undefined>(
    api ? undefined : fallbackWorkspaces[0]?.id,
  );
  const [launchMode, setLaunchMode] = React.useState<LaunchModeSelection>('lite');
  const launchModeRef = React.useRef(launchMode);
  launchModeRef.current = launchMode;
  const selectedProfileIdRef = React.useRef(selectedProfileId);
  selectedProfileIdRef.current = selectedProfileId;
  const [apiConfigFilter, setApiConfigFilter] = React.useState<ApiConfigFilter>('all');
  const [activeSessionId, setActiveSessionId] = React.useState<string | undefined>(
    api ? undefined : fallbackSessions[0]?.id,
  );
  const [pendingLaunchCount, setPendingLaunchCount] = React.useState(0);
  const launching = pendingLaunchCount > 0;
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  const [actionStatus, setActionStatus] = React.useState<string | null>(null);
  const [contextPressureBySessionId, setContextPressureBySessionId] = React.useState<
    Record<string, SessionContextPressureResult>
  >({});
  const [summaryHandoffPrompt, setSummaryHandoffPrompt] = React.useState<string | undefined>();
  const [pendingMemoryRestoreSessionIds, setPendingMemoryRestoreSessionIds] = React.useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const pendingRestartSessionIdsRef = React.useRef(new Set<string>());
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false);
  const [dismissedRestoreSessionIds, setDismissedRestoreSessionIds] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const refreshMetadata = React.useCallback(async (): Promise<void> => {
    if (!api) {
      return;
    }

    const [nextProfiles, nextWorkspaces] = await Promise.all([
      api.listProfiles(),
      api.listWorkspaces(),
    ]);
    const previousProfileId = selectedProfileIdRef.current;
    const previousProfile = profilesRef.current.find(
      (profile) => profile.id === previousProfileId,
    );
    const nextProfileId =
      previousProfileId && nextProfiles.some((profile) => profile.id === previousProfileId)
        ? previousProfileId
        : nextProfiles[0]?.id;
    const nextProfile = nextProfiles.find((profile) => profile.id === nextProfileId);
    const currentLaunchMode = launchModeRef.current;
    const shouldSyncLaunchMode =
      nextProfileId !== previousProfileId ||
      nextProfile?.toolType !== previousProfile?.toolType ||
      !launchModeMatchesProfile(currentLaunchMode, nextProfile);

    profilesRef.current = nextProfiles;
    selectedProfileIdRef.current = nextProfileId;
    setProfiles(nextProfiles);
    setWorkspaces(nextWorkspaces);
    setSelectedProfileId(nextProfileId);
    if (shouldSyncLaunchMode) {
      const nextLaunchMode = defaultLaunchModeFor(nextProfile);
      launchModeRef.current = nextLaunchMode;
      setLaunchMode(nextLaunchMode);
    }
    setSelectedWorkspaceId((current) =>
      current && nextWorkspaces.some((workspace) => workspace.id === current)
        ? current
        : nextWorkspaces[0]?.id,
    );
  }, [api]);

  React.useEffect(() => {
    if (!api) {
      return undefined;
    }

    let cancelled = false;
    void Promise.all([api.listProfiles(), api.listWorkspaces(), api.listSessions()])
      .then(([nextProfiles, nextWorkspaces, nextSessions]) => {
        if (cancelled) {
          return;
        }
        setProfiles(nextProfiles);
        setWorkspaces(nextWorkspaces);
        // 初始化请求可能晚于实时 session 事件返回；当前状态中的事件版本优先。
        setSessions((current) => {
          const mergedSessions = current.reduce(
            (mergedSessions, currentSession) => upsertSession(mergedSessions, currentSession),
            nextSessions,
          );
          sessionsRef.current = mergedSessions;
          return mergedSessions;
        });
        setSelectedProfileId((current) => current ?? nextProfiles[0]?.id);
        setLaunchMode(defaultLaunchModeFor(nextProfiles[0]));
        setSelectedWorkspaceId((current) => current ?? nextWorkspaces[0]?.id);
        setActiveSessionId((current) => current ?? sessionsRef.current[0]?.id);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLaunchError(safeLaunchError(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const checkForUpdates = React.useCallback(async (): Promise<void> => {
    if (!api || updateCheckInFlightRef.current) {
      return;
    }
    updateCheckInFlightRef.current = true;
    setCheckingForUpdates(true);
    try {
      setUpdateResult(await api.checkForUpdates());
    } finally {
      updateCheckInFlightRef.current = false;
      setCheckingForUpdates(false);
    }
  }, [api]);

  React.useEffect(() => {
    if (!api) {
      return undefined;
    }
    const timer = window.setTimeout(() => void checkForUpdates(), 3_000);
    return () => window.clearTimeout(timer);
  }, [api, checkForUpdates]);

  React.useEffect(() => {
    if (updateResult?.status !== 'current' && updateResult?.status !== 'error') {
      return undefined;
    }

    const timer = window.setTimeout(() => setUpdateResult(undefined), 5_000);
    return () => window.clearTimeout(timer);
  }, [updateResult]);

  React.useEffect(() => {
    if (!api) {
      return undefined;
    }

    let cancelled = false;
    void api.getBuildInfo()
      .then((nextBuildInfo) => {
        if (!cancelled) {
          setBuildInfo(nextBuildInfo);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBuildInfo(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  React.useEffect(() => {
    if (!api?.onMetadataChanged) {
      return undefined;
    }

    return api.onMetadataChanged(() => {
      void refreshMetadata().catch((error: unknown) => {
        setLaunchError(safeLaunchError(error));
      });
    });
  }, [api, refreshMetadata]);

  React.useEffect(() => {
    if (!api?.onSessionChanged) {
      return undefined;
    }

    return api.onSessionChanged((session) => {
      setSessions((current) => {
        const nextSessions = upsertSession(current, session);
        sessionsRef.current = nextSessions;
        return nextSessions;
      });
    });
  }, [api]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0];
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeSessionProfile = profiles.find((profile) => profile.id === activeSession?.profileId);
  const activeSessionWorkspace = workspaces.find(
    (workspace) => workspace.id === activeSession?.workspaceId,
  );
  const activeSessionSupportsSummary = isSummarySupportedAgentSession(
    activeSession,
    activeSessionProfile,
  );
  const visibleActionStatus = pendingMemoryRestoreSessionIds.size > 0
    ? '正在重新启动会话...'
    : actionStatus;
  // 需求约定：同一工作区目录被多个运行中的会话共享时给轻量提示（不是错误）。
  const sharedWorkspaceSessionCount = activeSession
    ? sessions.filter(
        (session) =>
          session.workspaceId === activeSession.workspaceId && isLiveSession(session),
      ).length
    : 0;

  const selectProfile = (profileId: string): void => {
    const nextProfile = profiles.find((profile) => profile.id === profileId);
    setSelectedProfileId(profileId);
    if (nextProfile) {
      setApiConfigFilter(nextProfile.toolType);
      setLaunchMode(defaultLaunchModeFor(nextProfile));
    }
  };

  React.useEffect(() => {
    setActionStatus(null);
    setSummaryHandoffPrompt(undefined);
    setSessionMenuOpen(false);
  }, [activeSessionId]);

  // 点击菜单区域外时收起终端头部的"更多操作"菜单。
  React.useEffect(() => {
    if (!sessionMenuOpen) {
      return undefined;
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (!target?.closest('.terminal-session-menu')) {
        setSessionMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [sessionMenuOpen]);

  React.useEffect(() => {
    if (!api || !activeSessionId || !activeSessionSupportsSummary) {
      return undefined;
    }

    let cancelled = false;
    const refreshPressure = (): void => {
      void api.getSessionContextPressure({ sessionId: activeSessionId })
        .then((pressure) => {
          if (!cancelled) {
            setContextPressureBySessionId((current) => ({
              ...current,
              [pressure.sessionId]: pressure,
            }));
          }
        })
        .catch(() => undefined);
    };
    refreshPressure();
    // 长时间运行的会话压力会持续变化，定期刷新而不是只在切换会话时取一次。
    const pressureTimer = window.setInterval(refreshPressure, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(pressureTimer);
    };
  }, [api, activeSessionId, activeSessionSupportsSummary]);

  const launchSession = async (): Promise<AgentSession | undefined> => {
    if (!selectedProfile || !selectedWorkspace) {
      setLaunchError('启动失败，请先选择 API 配置和工作区。');
      return undefined;
    }

    const command = launchMode === 'local-shell' ? 'zsh' : defaultCommandFor(selectedProfile);
    const launchRequest: LaunchRequest = {
      profileId: selectedProfile.id,
      workspaceId: selectedWorkspace.id,
      command,
    };
    if (launchMode !== 'local-shell' && selectedProfile.toolType === 'claude') {
      launchRequest.claudeLaunchMode = launchMode as ClaudeLaunchMode;
    } else if (launchMode !== 'local-shell' && selectedProfile.toolType === 'codex') {
      launchRequest.codexLaunchMode = launchMode as CodexLaunchMode;
    }

    if (!api) {
      const session: AgentSession = {
        id: `local-${Date.now()}`,
        title: `${selectedProfile.name} · ${selectedWorkspace.name}`,
        profileId: selectedProfile.id,
        workspaceId: selectedWorkspace.id,
        command,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      setSessions((current) => [...current, session]);
      setActiveSessionId(session.id);
      return session;
    }

    setPendingLaunchCount((current) => current + 1);
    setLaunchError(null);
    setActionStatus(null);
    try {
      const session = await api.launchSession(launchRequest);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      return session;
    } catch (error) {
      setLaunchError(safeLaunchError(error));
      return undefined;
    } finally {
      setPendingLaunchCount((current) => Math.max(0, current - 1));
    }
  };

  const launchFromSession = async (
    sourceSession: AgentSession,
    command: string,
  ): Promise<AgentSession | undefined> => {
    if (!api) {
      return undefined;
    }

    setPendingLaunchCount((current) => current + 1);
    setLaunchError(null);
    setActionStatus(null);
    try {
      const sourceProfile = profiles.find((profile) => profile.id === sourceSession.profileId);
      const launchRequest: LaunchRequest = {
        profileId: sourceSession.profileId,
        workspaceId: sourceSession.workspaceId,
        command,
      };
      addSessionLaunchMode(launchRequest, sourceSession, sourceProfile);

      const session = await api.launchSession(launchRequest);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      return session;
    } catch (error) {
      setLaunchError(safeLaunchError(error));
      return undefined;
    } finally {
      setPendingLaunchCount((current) => Math.max(0, current - 1));
    }
  };

  const restartSessionInPlace = async (
    sourceSession: AgentSession,
    strategy: RestartSessionRequest['strategy'],
  ): Promise<AgentSession | undefined> => {
    if (!api || pendingRestartSessionIdsRef.current.has(sourceSession.id)) {
      return undefined;
    }
    pendingRestartSessionIdsRef.current.add(sourceSession.id);

    setPendingLaunchCount((current) => current + 1);
    setLaunchError(null);
    if (strategy === 'resume') {
      setPendingMemoryRestoreSessionIds((current) => new Set(current).add(sourceSession.id));
    }
    setActionStatus('正在重新启动会话...');
    try {
      const restartRequest: RestartSessionRequest = {
        sessionId: sourceSession.id,
        strategy,
      };
      const sourceProfile = profiles.find((profile) => profile.id === sourceSession.profileId);
      addSessionLaunchMode(restartRequest, sourceSession, sourceProfile);

      const session = await api.restartSession(restartRequest);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      setActionStatus('会话已重新启动');
      return session;
    } catch (error) {
      setActionStatus(null);
      setLaunchError(safeLaunchError(error));
      return undefined;
    } finally {
      pendingRestartSessionIdsRef.current.delete(sourceSession.id);
      setPendingMemoryRestoreSessionIds((current) => {
        const nextSessionIds = new Set(current);
        nextSessionIds.delete(sourceSession.id);
        return nextSessionIds;
      });
      setPendingLaunchCount((current) => Math.max(0, current - 1));
    }
  };

  const copySessionOutput = async (sessionId: string): Promise<void> => {
    if (!api) {
      return;
    }

    try {
      const output = await api.readTerminalBuffer({ sessionId });
      const session = sessionsRef.current.find((candidate) => candidate.id === sessionId);
      const copiedOutput = isLiveSession(session) ? output : readableSessionHistory(output);
      await navigator.clipboard?.writeText(copiedOutput);
      setActionStatus('输出已复制');
    } catch (error) {
      setLaunchError(safeLaunchError(error));
    }
  };

  const summarizeActiveSession = async (continueAfterSummary: boolean): Promise<void> => {
    if (!api || !activeSession || !activeSessionSupportsSummary) {
      return;
    }

    setLaunchError(null);
    setActionStatus(null);
    try {
      const result = await api.summarizeSession({
        sessionId: activeSession.id,
        continueAfterSummary,
      });
      setSummaryHandoffPrompt(result.handoffPrompt);
      setActionStatus(`摘要已生成：${result.handoffFile}`);
      if (result.continuationSession) {
        setSessions((current) => upsertSession(current, result.continuationSession as AgentSession));
        setActiveSessionId(result.continuationSession.id);
      }
    } catch (error) {
      setLaunchError(safeLaunchError(error));
    }
  };

  const copySummaryHandoffPrompt = async (): Promise<void> => {
    if (!summaryHandoffPrompt) {
      return;
    }

    await navigator.clipboard?.writeText(summaryHandoffPrompt);
    setActionStatus('续接提示已复制');
  };

  const openSessionView = (sessionId: string): void => {
    setActiveSessionId(sessionId);
  };

  // 自动切换 active 会话时跳过已归档和已在本窗口关闭视图的会话。
  const fallbackSessionIdAfter = (excludedSessionId: string): string | undefined =>
    sessionsRef.current.find(
      (session) =>
        session.id !== excludedSessionId &&
        !session.archived &&
        !(session.closedViewIds ?? []).includes('main-window'),
    )?.id;

  const closeSessionView = async (sessionId: string): Promise<void> => {
    if (api) {
      try {
        const session = await api.closeSessionView({ sessionId, viewId: 'main-window' });
        setSessions((current) => upsertSession(current, session));
      } catch (error) {
        setLaunchError(safeLaunchError(error));
        return;
      }
    } else {
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? { ...session, closedViewIds: Array.from(new Set([...(session.closedViewIds ?? []), 'main-window'])) }
            : session,
        ),
      );
    }

    setActiveSessionId((currentActiveSessionId) => {
      if (currentActiveSessionId !== sessionId) {
        return currentActiveSessionId;
      }
      return fallbackSessionIdAfter(sessionId);
    });
  };

  const stopSession = async (sessionId: string): Promise<void> => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    if (!api) {
      setSessions((current) =>
        current.map((item) => (item.id === sessionId ? { ...item, status: 'stopped' } : item)),
      );
      return;
    }

    try {
      const stoppedSession = await api.killTerminal({ sessionId });
      setSessions((current) => upsertSession(current, stoppedSession));
    } catch (error) {
      setLaunchError(safeLaunchError(error));
    }
  };

  const continueSession = async (sessionId: string): Promise<void> => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    if (isLiveSession(session)) {
      setActiveSessionId(session.id);
      return;
    }

    await restartSessionInPlace(session, 'resume');
  };

  const archiveSession = async (sessionId: string): Promise<void> => {
    if (!api) {
      setSessions((current) =>
        current.map((session) => (session.id === sessionId ? { ...session, archived: true } : session)),
      );
    } else {
      try {
        const archivedSession = await api.archiveSessionRecord({ sessionId });
        setSessions((current) => upsertSession(current, archivedSession));
      } catch (error) {
        setLaunchError(safeLaunchError(error));
        return;
      }
    }

    setActiveSessionId((currentActiveSessionId) => {
      if (currentActiveSessionId !== sessionId) {
        return currentActiveSessionId;
      }
      return fallbackSessionIdAfter(sessionId);
    });
  };

  const deleteSession = async (sessionId: string): Promise<void> => {
    const confirmed = window.confirm(
      '删除记录会删除 AgentDock 保存的这条会话历史、摘要和恢复元数据，但不会删除工作区里的项目文件。确定删除吗？',
    );
    if (!confirmed) {
      return;
    }

    if (api) {
      try {
        await api.deleteSessionRecord({ sessionId });
      } catch (error) {
        setLaunchError(safeLaunchError(error));
        return;
      }
    }

    setSessions((current) => current.filter((session) => session.id !== sessionId));
    setActiveSessionId((currentActiveSessionId) => {
      if (currentActiveSessionId !== sessionId) {
        return currentActiveSessionId;
      }
      return fallbackSessionIdAfter(sessionId);
    });
  };

  const saveProfile = async (profile: ApiProfile): Promise<ApiProfile> => {
    const savedProfile = api ? await api.saveProfile(profile) : profile;

    setProfiles((current) => {
      if (!current.some((item) => item.id === savedProfile.id)) {
        return [...current, savedProfile];
      }

      return current.map((item) => (item.id === savedProfile.id ? savedProfile : item));
    });
    setSelectedProfileId(savedProfile.id);
    setApiConfigFilter(savedProfile.toolType);
    setLaunchMode(defaultLaunchModeFor(savedProfile));

    return savedProfile;
  };

  const saveProfileSecret = async (request: {
    keychainService: string;
    keychainAccount: string;
    secret: string;
  }): Promise<void> => {
    if (!api) {
      return;
    }

    await api.saveProfileSecret(request);
  };

  const readProfileSecret = async (request: {
    keychainService: string;
    keychainAccount: string;
  }): Promise<string> => {
    if (!api) {
      return '';
    }

    return api.readProfileSecret(request);
  };

  const fetchProfileModels = async (request: {
    profileId: string;
    baseUrlOverride?: string;
  }): Promise<string[]> => {
    if (!api) {
      return [];
    }

    return api.fetchProfileModels(request);
  };

  const deleteProfile = async (profileId: string): Promise<void> => {
    if (!api) {
      return;
    }

    await api.deleteProfile(profileId);
    setProfiles((current) => current.filter((item) => item.id !== profileId));
    if (selectedProfileId === profileId) {
      setSelectedProfileId(undefined);
    }
  };

  const chooseWorkspace = async (): Promise<void> => {
    if (!api) {
      return;
    }

    setLaunchError(null);
    try {
      const workspace = await api.chooseWorkspace();
      if (!workspace) {
        return;
      }

      setWorkspaces((current) => upsertWorkspace(current, workspace));
      setSelectedWorkspaceId(workspace.id);
    } catch (error) {
      setLaunchError(safeLaunchError(error));
    }
  };

  const showApiConfig = (): void => {
    setActivePage('apiConfig');
    setApiConfigFilter('all');
  };

  const openNewWindow = (): void => {
    if (!api) {
      return;
    }

    void api.openNewWindow().catch((error: unknown) => {
      setLaunchError(safeLaunchError(error));
    });
  };

  const readWorkspaceContext = async (
    workspaceId: string,
  ): Promise<{ filePath: string; content: string }> => {
    if (!api) {
      return { filePath: '', content: '' };
    }

    return api.readWorkspaceContext({ workspaceId });
  };

  const openWorkspaceContextFolder = async (workspaceId: string): Promise<void> => {
    await api?.openWorkspaceContextFolder({ workspaceId });
  };

  const listWorkspaceDirectory = React.useCallback(async (
    request: WorkspaceDirectoryRequest,
  ): Promise<WorkspaceDirectoryResult> => {
    if (!api) {
      return {
        workspaceId: request.workspaceId,
        relativePath: request.relativePath ?? '.',
        entries: [],
      };
    }

    return api.listWorkspaceDirectory(request);
  }, [api]);

  // 拖拽期间组件卸载时兜底移除 window 监听器。
  const sessionLibraryResizeCleanupRef = React.useRef<(() => void) | null>(null);
  const projectPanelResizeCleanupRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => {
    sessionLibraryResizeCleanupRef.current?.();
    projectPanelResizeCleanupRef.current?.();
  }, []);

  const startSessionLibraryResize = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sessionLibraryWidth;

    const onMouseMove = (moveEvent: MouseEvent): void => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setSessionLibraryWidth(
        Math.min(SESSION_LIBRARY_MAX_WIDTH, Math.max(SESSION_LIBRARY_MIN_WIDTH, nextWidth)),
      );
    };
    const stopResize = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
      sessionLibraryResizeCleanupRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
    sessionLibraryResizeCleanupRef.current = stopResize;
  };

  const resizeSessionLibraryFromKeyboard = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    const requestedWidth = {
      ArrowLeft: sessionLibraryWidth - PANEL_KEYBOARD_RESIZE_STEP,
      ArrowRight: sessionLibraryWidth + PANEL_KEYBOARD_RESIZE_STEP,
      Home: SESSION_LIBRARY_MIN_WIDTH,
      End: SESSION_LIBRARY_MAX_WIDTH,
    }[event.key];
    if (requestedWidth === undefined) {
      return;
    }

    event.preventDefault();
    setSessionLibraryWidth(
      Math.min(SESSION_LIBRARY_MAX_WIDTH, Math.max(SESSION_LIBRARY_MIN_WIDTH, requestedWidth)),
    );
  };

  const startProjectPanelResize = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = projectPanelWidth;

    const onMouseMove = (moveEvent: MouseEvent): void => {
      const nextWidth = startWidth - (moveEvent.clientX - startX);
      setProjectPanelWidth(
        Math.min(PROJECT_PANEL_MAX_WIDTH, Math.max(PROJECT_PANEL_MIN_WIDTH, nextWidth)),
      );
    };
    const stopResize = (): void => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResize);
      projectPanelResizeCleanupRef.current = null;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResize);
    projectPanelResizeCleanupRef.current = stopResize;
  };

  const resizeProjectPanelFromKeyboard = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    const requestedWidth = {
      ArrowLeft: projectPanelWidth + PANEL_KEYBOARD_RESIZE_STEP,
      ArrowRight: projectPanelWidth - PANEL_KEYBOARD_RESIZE_STEP,
      Home: PROJECT_PANEL_MIN_WIDTH,
      End: PROJECT_PANEL_MAX_WIDTH,
    }[event.key];
    if (requestedWidth === undefined) {
      return;
    }

    event.preventDefault();
    setProjectPanelWidth(
      Math.min(PROJECT_PANEL_MAX_WIDTH, Math.max(PROJECT_PANEL_MIN_WIDTH, requestedWidth)),
    );
  };

  return (
    <main className="app-shell">
      <AppHeader
        onShowApiConfig={activePage === 'apiConfig' ? undefined : showApiConfig}
        onOpenNewWindow={api ? openNewWindow : undefined}
      />
      {activePage === 'workbench' ? (
        <section
          className={projectPanelOpen ? 'workbench-layout project-open' : 'workbench-layout'}
          style={{
            '--session-library-width': `${sessionLibraryWidth}px`,
            '--project-panel-width': `${projectPanelWidth}px`,
          } as React.CSSProperties}
        >
          <SessionLibrary
            sessions={sessions}
            profiles={profiles}
            workspaces={workspaces}
            activeSessionId={activeSessionId}
            buildInfo={buildInfo}
            updateResult={updateResult}
            checkingForUpdates={checkingForUpdates}
            onCheckForUpdates={() => void checkForUpdates()}
            onOpenUpdateDownload={(releaseUrl) => void api?.openUpdateDownload(releaseUrl)}
            onOpenSession={openSessionView}
            onContinueSession={(sessionId) => void continueSession(sessionId)}
            onStopSession={(sessionId) => void stopSession(sessionId)}
            onArchiveSession={(sessionId) => void archiveSession(sessionId)}
            onDeleteSession={(sessionId) => void deleteSession(sessionId)}
          />
          <div
            className="session-library-resizer"
            role="separator"
            aria-label="调整会话库宽度"
            aria-orientation="vertical"
            aria-valuemin={SESSION_LIBRARY_MIN_WIDTH}
            aria-valuemax={SESSION_LIBRARY_MAX_WIDTH}
            aria-valuenow={sessionLibraryWidth}
            tabIndex={0}
            onMouseDown={startSessionLibraryResize}
            onKeyDown={resizeSessionLibraryFromKeyboard}
            onDoubleClick={() => setSessionLibraryWidth(SESSION_LIBRARY_DEFAULT_WIDTH)}
          />
          <div className="workbench-main">
            <CommandBar
              profiles={profiles}
              profile={selectedProfile}
              profileId={selectedProfile?.id}
              workspaces={workspaces}
              workspace={selectedWorkspace}
              workspaceId={selectedWorkspace?.id}
              launchMode={launchMode}
              launching={launching}
              onProfileChange={selectProfile}
              onWorkspaceChange={setSelectedWorkspaceId}
              onLaunchModeChange={setLaunchMode}
              onChooseWorkspace={api ? () => void chooseWorkspace() : undefined}
              onLaunch={() => void launchSession()}
            />
            {launchError ? <p role="alert" className="launch-error">{launchError}</p> : null}
            {visibleActionStatus ? <p role="status" className="launch-status">{visibleActionStatus}</p> : null}

            <section
              className={detailsOpen ? 'workspace-grid details-open' : 'workspace-grid'}
              aria-label="运行中的会话"
            >
              <section className="terminal-card">
                <header className="terminal-session-header">
                  <div className="terminal-session-title">
                    <span
                      className={`session-status-dot ${activeSession?.status ?? 'exited'}`}
                      aria-hidden="true"
                    />
                    <div>
                      <h2 title={activeSession?.title}>{activeSession?.title ?? '未选择会话'}</h2>
                      <p className="terminal-session-command" title={activeSession?.command}>
                        {activeSession ? compactCommandLabel(activeSession.command) : '从左侧会话库选择，或在上方启动新会话'}
                      </p>
                    </div>
                  </div>
                  <div className="terminal-session-actions">
                    {sharedWorkspaceSessionCount > 1 ? (
                      <span
                        className="shared-workspace-chip"
                        title="多个运行中的会话正在使用同一个工作区目录；注意避免同时改动相同文件。"
                      >
                        共享目录 · {sharedWorkspaceSessionCount} 个会话
                      </span>
                    ) : null}
                    <span className={`session-status-chip ${activeSession?.status ?? 'exited'}`}>
                      {sessionStatusLabel(activeSession)}
                    </span>
                    {isLiveSession(activeSession) ? (
                      <button
                        type="button"
                        className="terminal-stop-button"
                        title="停止当前会话"
                        aria-label="停止当前会话"
                        onClick={() => activeSession && void stopSession(activeSession.id)}
                      >
                        ■
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="details-toggle"
                      aria-expanded={detailsOpen}
                      onClick={() => {
                        setDetailsOpen((open) => {
                          if (!open) {
                            setProjectPanelOpen(false);
                          }
                          return !open;
                        });
                      }}
                    >
                      会话详情 {detailsOpen ? '‹' : '›'}
                    </button>
                    {activeSession ? (
                      <details
                        className="session-library-menu terminal-session-menu"
                        open={sessionMenuOpen}
                      >
                        <summary
                          aria-label="更多会话操作"
                          title="更多会话操作"
                          onClick={(event) => {
                            event.preventDefault();
                            setSessionMenuOpen((open) => !open);
                          }}
                        >
                          ...
                        </summary>
                        <div className="session-library-menu-popover" hidden={!sessionMenuOpen}>
                          <button
                            type="button"
                            onClick={() => {
                              setSessionMenuOpen(false);
                              void copySessionOutput(activeSession.id);
                            }}
                          >
                            复制输出
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSessionMenuOpen(false);
                              void archiveSession(activeSession.id);
                            }}
                          >
                            归档
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSessionMenuOpen(false);
                              void deleteSession(activeSession.id);
                            }}
                          >
                            删除记录
                          </button>
                        </div>
                      </details>
                    ) : null}
                  </div>
                </header>
                {activeSessionId && pendingMemoryRestoreSessionIds.has(activeSessionId) ? (
                  <div className="session-memory-restore" role="status" aria-label="记忆恢复状态">
                    <span>正在恢复记忆</span>
                  </div>
                ) : activeSessionId && !dismissedRestoreSessionIds.has(activeSessionId) ? (
                  <SessionMemoryRestoreBar
                    restore={activeSession?.memoryRestore}
                    onDismiss={() =>
                      setDismissedRestoreSessionIds(
                        (current) => new Set([...current, activeSessionId]),
                      )
                    }
                  />
                ) : null}
                <TerminalPane
                  sessionId={activeSessionId}
                  preserveHistory={activeSession ? !['zsh', 'bash'].includes(commandExecutableName(activeSession.command)) : true}
                  readOnly={activeSession ? !isLiveSession(activeSession) : false}
                />
                {isRecoverableSession(activeSession) ? (
                  <SessionRecoveryBar
                    session={activeSession}
                    onResume={() => void restartSessionInPlace(
                      activeSession,
                      'resume',
                    )}
                    onFreshRestart={() => void restartSessionInPlace(
                      activeSession,
                      'fresh',
                    )}
                    onCopyOutput={() => void copySessionOutput(activeSession.id)}
                  />
                ) : null}
                {activeSession && activeSessionSupportsSummary && contextPressureBySessionId[activeSession.id] ? (
                  <SessionContextBar
                    pressure={contextPressureBySessionId[activeSession.id]}
                    handoffPrompt={summaryHandoffPrompt}
                    onSummarize={() => void summarizeActiveSession(false)}
                    onSummarizeAndContinue={() => void summarizeActiveSession(true)}
                    onCopyPrompt={() => void copySummaryHandoffPrompt()}
                  />
                ) : null}
              </section>

            <SessionDetailsDrawer
              open={detailsOpen}
              session={activeSession}
              profile={activeSessionProfile}
              workspace={activeSessionWorkspace}
              onReadWorkspaceContext={readWorkspaceContext}
              onOpenWorkspaceContextFolder={openWorkspaceContextFolder}
            />
            </section>
          </div>
          {projectPanelOpen ? (
            <div
              className="project-panel-resizer"
              role="separator"
              aria-label="调整项目面板宽度"
              aria-orientation="vertical"
              aria-valuemin={PROJECT_PANEL_MIN_WIDTH}
              aria-valuemax={PROJECT_PANEL_MAX_WIDTH}
              aria-valuenow={projectPanelWidth}
              tabIndex={0}
              onMouseDown={startProjectPanelResize}
              onKeyDown={resizeProjectPanelFromKeyboard}
              onDoubleClick={() => setProjectPanelWidth(PROJECT_PANEL_DEFAULT_WIDTH)}
            />
          ) : null}
          <aside
            className={projectPanelOpen ? 'project-panel open' : 'project-panel collapsed'}
            aria-label="项目面板"
          >
            {projectPanelOpen ? (
              <ProjectPanel
                workspace={activeSessionWorkspace ?? selectedWorkspace}
                session={activeSession}
                profile={activeSessionProfile}
                onCollapse={() => setProjectPanelOpen(false)}
                listDirectory={listWorkspaceDirectory}
              />
            ) : (
              <button
                type="button"
                className="project-panel-rail"
                aria-label="展开项目面板"
                title="展开项目面板"
                onClick={() => {
                  setDetailsOpen(false);
                  setProjectPanelOpen(true);
                }}
              >
                项目
              </button>
            )}
          </aside>
        </section>
      ) : (
        <section className="settings-page" aria-label="接口配置页面">
        <ApiConfigPanel
          profiles={profiles}
          selectedProfileId={selectedProfileId}
          filter={apiConfigFilter}
          onFilterChange={setApiConfigFilter}
          onSelectProfile={selectProfile}
          onSaveProfile={saveProfile}
          onDeleteProfile={deleteProfile}
          onSaveProfileSecret={saveProfileSecret}
          onReadProfileSecret={readProfileSecret}
          onFetchProfileModels={fetchProfileModels}
          onBackToWorkbench={() => setActivePage('workbench')}
        />
        </section>
      )}
    </main>
  );
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(<App />);
}
