import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { ApiConfigPanel, type ApiConfigFilter } from './components/ApiConfigPanel';
import { AppHeader } from './components/AppHeader';
import { CommandBar } from './components/CommandBar';
import { SessionDetailsDrawer } from './components/SessionDetailsDrawer';
import { SessionTabs } from './components/SessionTabs';
import { TerminalPane } from './components/TerminalPane';
import { defaultApiProfiles } from '../shared/defaultApiProfiles';
import { terminalOutputToPlainText } from '../shared/terminalText';
import type {
  AgentSession,
  ApiProfile,
  ClaudeLaunchMode,
  LaunchRequest,
  RestartSessionRequest,
  SessionContextPressureResult,
  Workspace,
} from '../shared/agentdockTypes';

export type SessionTab = {
  id: string;
  title: string;
  active?: boolean;
};

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

function claudeLaunchModeForSession(
  session: AgentSession,
  profile: ApiProfile | undefined,
  fallbackLaunchMode: ClaudeLaunchMode,
): ClaudeLaunchMode | undefined {
  if (profile?.toolType !== 'claude' || commandExecutableName(session.command) !== 'claude') {
    return undefined;
  }

  return session.claudeLaunchMode ?? fallbackLaunchMode;
}

function isRecoverableSession(session: AgentSession | undefined): session is AgentSession {
  return session?.status === 'exited' || session?.status === 'interrupted' || session?.status === 'failed';
}

function SessionRecoveryBar({
  session,
  onResume,
  onRestart,
  onCopyOutput,
  onClose,
}: {
  session: AgentSession;
  onResume?(command: string): void;
  onRestart(): void;
  onCopyOutput(): void;
  onClose(): void;
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
        {session.resumeCommand ? (
          <button type="button" onClick={() => onResume?.(session.resumeCommand as string)}>
            恢复会话
          </button>
        ) : null}
        <button type="button" onClick={onRestart}>
          重新启动
        </button>
        <button type="button" onClick={onCopyOutput}>
          复制输出
        </button>
        <button type="button" onClick={onClose}>
          关闭标签
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
}: {
  restore?: AgentSession['memoryRestore'];
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
    </div>
  );
}

export default function App(): React.JSX.Element {
  const api = typeof window === 'undefined' ? undefined : window.agentDock;
  const commandBarRef = React.useRef<HTMLElement>(null);
  const closedSessionIdsRef = React.useRef<Set<string>>(new Set());
  const [activePage, setActivePage] = React.useState<ActivePage>('workbench');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [profiles, setProfiles] = React.useState<ApiProfile[]>(api ? [] : fallbackProfiles);
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>(api ? [] : fallbackWorkspaces);
  const [sessions, setSessions] = React.useState<AgentSession[]>(api ? [] : fallbackSessions);
  const [selectedProfileId, setSelectedProfileId] = React.useState<string | undefined>(
    api ? undefined : fallbackProfiles[0]?.id,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string | undefined>(
    api ? undefined : fallbackWorkspaces[0]?.id,
  );
  const [claudeLaunchMode, setClaudeLaunchMode] = React.useState<ClaudeLaunchMode>('lite');
  const [apiConfigFilter, setApiConfigFilter] = React.useState<ApiConfigFilter>('all');
  const [activeSessionId, setActiveSessionId] = React.useState<string | undefined>(
    api ? undefined : fallbackSessions[0]?.id,
  );
  const [launching, setLaunching] = React.useState(false);
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  const [actionStatus, setActionStatus] = React.useState<string | null>(null);
  const [contextPressureBySessionId, setContextPressureBySessionId] = React.useState<
    Record<string, SessionContextPressureResult>
  >({});
  const [summaryHandoffPrompt, setSummaryHandoffPrompt] = React.useState<string | undefined>();
  const [pendingMemoryRestoreSessionId, setPendingMemoryRestoreSessionId] = React.useState<string | undefined>();

  const refreshMetadata = React.useCallback(async (): Promise<void> => {
    if (!api) {
      return;
    }

    const [nextProfiles, nextWorkspaces] = await Promise.all([
      api.listProfiles(),
      api.listWorkspaces(),
    ]);
    setProfiles(nextProfiles);
    setWorkspaces(nextWorkspaces);
    setSelectedProfileId((current) =>
      current && nextProfiles.some((profile) => profile.id === current)
        ? current
        : nextProfiles[0]?.id,
    );
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
        setSessions(nextSessions);
        setSelectedProfileId((current) => current ?? nextProfiles[0]?.id);
        setSelectedWorkspaceId((current) => current ?? nextWorkspaces[0]?.id);
        setActiveSessionId((current) => current ?? nextSessions[0]?.id);
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
      if (closedSessionIdsRef.current.has(session.id)) {
        return;
      }
      setSessions((current) => upsertSession(current, session));
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
  const visibleActionStatus = pendingMemoryRestoreSessionId ? '正在重新启动会话...' : actionStatus;
  const tabs = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    active: session.id === activeSessionId,
  }));

  const selectProfile = (profileId: string): void => {
    const nextProfile = profiles.find((profile) => profile.id === profileId);
    setSelectedProfileId(profileId);
    if (nextProfile) {
      setApiConfigFilter(nextProfile.toolType);
    }
  };

  React.useEffect(() => {
    setActionStatus(null);
    setSummaryHandoffPrompt(undefined);
  }, [activeSessionId]);

  React.useEffect(() => {
    if (!api || !activeSessionId || !activeSessionSupportsSummary) {
      return undefined;
    }

    let cancelled = false;
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

    return () => {
      cancelled = true;
    };
  }, [api, activeSessionId, activeSessionSupportsSummary]);

  const launchSession = async (commandOverride?: string): Promise<AgentSession | undefined> => {
    if (!selectedProfile || !selectedWorkspace) {
      setLaunchError('启动失败，请先选择 API 配置和工作区。');
      return undefined;
    }

    const command = commandOverride ?? defaultCommandFor(selectedProfile);
    const launchRequest: LaunchRequest = {
      profileId: selectedProfile.id,
      workspaceId: selectedWorkspace.id,
      command,
    };
    if (selectedProfile.toolType === 'claude' && !commandOverride) {
      launchRequest.claudeLaunchMode = claudeLaunchMode;
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

    setLaunching(true);
    setLaunchError(null);
    setActionStatus(null);
    try {
      const session = await api.launchSession(launchRequest);
      closedSessionIdsRef.current.delete(session.id);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      return session;
    } catch (error) {
      setLaunchError(safeLaunchError(error));
      return undefined;
    } finally {
      setLaunching(false);
    }
  };

  const launchFromSession = async (
    sourceSession: AgentSession,
    command: string,
  ): Promise<AgentSession | undefined> => {
    if (!api) {
      return undefined;
    }

    setLaunching(true);
    setLaunchError(null);
    setActionStatus(null);
    try {
      const sourceProfile = profiles.find((profile) => profile.id === sourceSession.profileId);
      const launchRequest: LaunchRequest = {
        profileId: sourceSession.profileId,
        workspaceId: sourceSession.workspaceId,
        command,
      };
      const sourceLaunchMode = claudeLaunchModeForSession(
        sourceSession,
        sourceProfile,
        claudeLaunchMode,
      );
      if (sourceLaunchMode) {
        launchRequest.claudeLaunchMode = sourceLaunchMode;
      }

      const session = await api.launchSession(launchRequest);
      closedSessionIdsRef.current.delete(session.id);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      return session;
    } catch (error) {
      setLaunchError(safeLaunchError(error));
      return undefined;
    } finally {
      setLaunching(false);
    }
  };

  const restartSessionInPlace = async (
    sourceSession: AgentSession,
    command?: string,
  ): Promise<AgentSession | undefined> => {
    if (!api) {
      return undefined;
    }

    setLaunching(true);
    setLaunchError(null);
    setPendingMemoryRestoreSessionId(sourceSession.id);
    setActionStatus('正在重新启动会话...');
    try {
      const sourceProfile = profiles.find((profile) => profile.id === sourceSession.profileId);
      const restartRequest: RestartSessionRequest = {
        sessionId: sourceSession.id,
        command,
      };
      const sourceLaunchMode = claudeLaunchModeForSession(
        sourceSession,
        sourceProfile,
        claudeLaunchMode,
      );
      if (sourceLaunchMode) {
        restartRequest.claudeLaunchMode = sourceLaunchMode;
      }

      const session = await api.restartSession(restartRequest);
      closedSessionIdsRef.current.delete(session.id);
      setSessions((current) => upsertSession(current, session));
      setActiveSessionId(session.id);
      setActionStatus('会话已重新启动');
      return session;
    } catch (error) {
      setLaunchError(safeLaunchError(error));
      return undefined;
    } finally {
      setPendingMemoryRestoreSessionId(undefined);
      setLaunching(false);
    }
  };

  const copySessionOutput = async (sessionId: string): Promise<void> => {
    if (!api) {
      return;
    }

    try {
      const output = await api.readTerminalBuffer({ sessionId });
      await navigator.clipboard?.writeText(output);
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
        closedSessionIdsRef.current.delete(result.continuationSession.id);
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

  const closeSession = async (sessionId: string): Promise<void> => {
    if (api) {
      try {
        await api.killTerminal({ sessionId });
      } catch (error) {
        setLaunchError(safeLaunchError(error));
        return;
      }
    }

    closedSessionIdsRef.current.add(sessionId);
    setSessions((current) => {
      const nextSessions = current.filter((session) => session.id !== sessionId);
      setActiveSessionId((currentActiveSessionId) => {
        if (currentActiveSessionId !== sessionId) {
          return currentActiveSessionId;
        }
        return nextSessions[0]?.id;
      });
      return nextSessions;
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

  const fetchProfileModels = async (request: { profileId: string }): Promise<string[]> => {
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

  return (
    <main className="app-shell">
      <AppHeader
        onShowApiConfig={showApiConfig}
        onOpenNewWindow={api ? openNewWindow : undefined}
      />
      {activePage === 'workbench' ? (
        <>
          <CommandBar
            ref={commandBarRef}
            profiles={profiles}
            profile={selectedProfile}
            profileId={selectedProfile?.id}
            workspaces={workspaces}
            workspace={selectedWorkspace}
            workspaceId={selectedWorkspace?.id}
            claudeLaunchMode={claudeLaunchMode}
            launching={launching}
            onProfileChange={selectProfile}
            onWorkspaceChange={setSelectedWorkspaceId}
            onClaudeLaunchModeChange={setClaudeLaunchMode}
            onChooseWorkspace={api ? () => void chooseWorkspace() : undefined}
            onLaunchLocalShell={() => void launchSession('zsh')}
            onLaunch={() => void launchSession()}
          />
          {launchError ? <p role="alert" className="launch-error">{launchError}</p> : null}
          {visibleActionStatus ? <p role="status" className="launch-status">{visibleActionStatus}</p> : null}

          <section className={detailsOpen ? 'workspace-grid details-open' : 'workspace-grid'}>
            <section className="terminal-card">
              <SessionTabs
                tabs={tabs}
                detailsOpen={detailsOpen}
                onToggleDetails={() => setDetailsOpen((open) => !open)}
                onSelectSession={setActiveSessionId}
                onAddSession={() => void launchSession()}
                onCloseSession={(sessionId) => void closeSession(sessionId)}
              />
              {pendingMemoryRestoreSessionId === activeSessionId ? (
                <div className="session-memory-restore" role="status" aria-label="记忆恢复状态">
                  <span>正在恢复记忆</span>
                </div>
              ) : (
                <SessionMemoryRestoreBar restore={activeSession?.memoryRestore} />
              )}
              <TerminalPane
                sessionId={activeSessionId}
                preserveHistory={activeSession ? !['zsh', 'bash'].includes(activeSession.command) : true}
                readOnly={activeSession ? !isLiveSession(activeSession) : false}
              />
              {isRecoverableSession(activeSession) ? (
                <SessionRecoveryBar
                  session={activeSession}
                  onResume={(command) => void restartSessionInPlace(activeSession, command)}
                  onRestart={() => void restartSessionInPlace(activeSession, activeSession.command)}
                  onCopyOutput={() => void copySessionOutput(activeSession.id)}
                  onClose={() => void closeSession(activeSession.id)}
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
        </>
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
