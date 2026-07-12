import React from 'react';
import type { AgentSession, ApiProfile, AppBuildInfo, Workspace } from '../../shared/agentdockTypes';

type SessionLibraryProps = {
  sessions: AgentSession[];
  profiles: ApiProfile[];
  workspaces: Workspace[];
  activeSessionId?: string;
  buildInfo?: AppBuildInfo;
  onOpenSession(sessionId: string): void;
  onContinueSession(sessionId: string): void;
  onStopSession(sessionId: string): void;
  onArchiveSession(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
};

function profileNameFor(profiles: ApiProfile[], profileId: string): string {
  return profiles.find((profile) => profile.id === profileId)?.name ?? profileId;
}

function workspaceNameFor(workspaces: Workspace[], workspaceId: string): string {
  return workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId;
}

// 分组标题已经写明工作区，列表项标题里再带一遍只会挤占宽度；
// 去掉与所在分组重复的工作区后缀（完整标题保留在悬停提示里）。
function sessionDisplayTitle(session: AgentSession, workspaceName: string): string {
  const suffix = ` · ${workspaceName}`;
  return session.title.endsWith(suffix)
    ? session.title.slice(0, session.title.length - suffix.length)
    : session.title;
}

function commandExecutableName(command: string): string {
  const executable = command.trim().split(/\s+/)[0] ?? '';
  return executable.split('/').pop() ?? executable;
}

function relativeTimeLabel(startedAt: string): string {
  const timestamp = Date.parse(startedAt);
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

function buildInfoTitle(buildInfo: AppBuildInfo | undefined): string {
  if (!buildInfo) {
    return 'AgentDock 版本信息不可用';
  }

  const dirtyLabel = buildInfo.dirty ? ' · dirty worktree' : '';
  return [
    `version ${buildInfo.version}`,
    `build ${buildInfo.buildId}`,
    `commit ${buildInfo.commitShort}${dirtyLabel}`,
    `built ${buildInfo.buildTime}`,
  ].join(' · ');
}

export function SessionLibrary({
  sessions,
  profiles,
  workspaces,
  activeSessionId,
  buildInfo,
  onOpenSession,
  onContinueSession,
  onStopSession,
  onArchiveSession,
  onDeleteSession,
}: SessionLibraryProps): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [showArchived, setShowArchived] = React.useState(false);
  const [openMenuSessionId, setOpenMenuSessionId] = React.useState<string | undefined>();

  // 点击菜单区域外时收起"…"菜单。
  React.useEffect(() => {
    if (!openMenuSessionId) {
      return undefined;
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (!target?.closest('.session-library-menu')) {
        setOpenMenuSessionId(undefined);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [openMenuSessionId]);

  const menuAction = (action: (sessionId: string) => void, sessionId: string): void => {
    setOpenMenuSessionId(undefined);
    action(sessionId);
  };
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSessions = sessions.filter((session) => {
    if (!showArchived && session.archived) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [
      session.title,
      workspaceNameFor(workspaces, session.workspaceId),
      profileNameFor(profiles, session.profileId),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const groupedWorkspaces = workspaces
    .map((workspace) => ({
      workspace,
      sessions: visibleSessions.filter((session) => session.workspaceId === workspace.id),
    }))
    .filter((group) => group.sessions.length > 0);
  const unknownSessions = visibleSessions.filter(
    (session) => !workspaces.some((workspace) => workspace.id === session.workspaceId),
  );

  return (
    <nav className="session-library" aria-label="会话库">
      <div className="session-library-header">
        <div className="session-library-brand">
          <h2>AgentDock</h2>
          {buildInfo ? (
            <span
              className="app-version-chip"
              aria-label="AgentDock 版本信息"
              title={buildInfoTitle(buildInfo)}
            >
              v{buildInfo.version}
            </span>
          ) : null}
        </div>
      </div>
      <input
        className="session-library-search"
        aria-label="搜索会话"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索"
      />
      <button
        type="button"
        className="session-library-filter"
        aria-pressed={showArchived}
        onClick={() => setShowArchived((current) => !current)}
      >
        全部记录
      </button>
      <div className="session-library-list">
        {[...groupedWorkspaces, unknownSessions.length > 0 ? {
          workspace: { id: '__unknown__', name: '未归类', path: '' },
          sessions: unknownSessions,
        } : undefined]
          .filter((group): group is { workspace: Workspace; sessions: AgentSession[] } => Boolean(group))
          .map(({ workspace, sessions: workspaceSessions }) => (
            <section key={workspace.id} className="session-library-group">
              <h3>{workspace.name}</h3>
              {workspaceSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <article
                    key={session.id}
                    className={isActive ? 'session-library-item active' : 'session-library-item'}
                  >
                    <button
                      type="button"
                      className="session-library-open"
                      aria-label={session.title}
                      title={session.title}
                      onClick={() => onOpenSession(session.id)}
                    >
                      <span className={`session-status-dot ${session.status}`} aria-hidden="true" />
                      <span className="session-library-title">
                        {sessionDisplayTitle(session, workspace.name)}
                      </span>
                      <span className="session-library-meta">
                        {commandExecutableName(session.command)} · {relativeTimeLabel(session.startedAt)}
                      </span>
                    </button>
                    <details className="session-library-menu" open={openMenuSessionId === session.id}>
                      <summary
                        aria-label={`${session.title} 更多操作`}
                        onClick={(event) => {
                          event.preventDefault();
                          setOpenMenuSessionId((current) => (current === session.id ? undefined : session.id));
                        }}
                      >
                        ...
                      </summary>
                      <div
                        className="session-library-menu-popover"
                        hidden={openMenuSessionId !== session.id}
                      >
                        <button type="button" onClick={() => menuAction(onOpenSession, session.id)}>
                          打开视图
                        </button>
                        <button type="button" onClick={() => menuAction(onContinueSession, session.id)}>
                          继续上次对话
                        </button>
                        {session.status === 'running' || session.status === 'starting' ? (
                          <button type="button" onClick={() => menuAction(onStopSession, session.id)}>
                            停止运行
                          </button>
                        ) : null}
                        <button type="button" onClick={() => menuAction(onArchiveSession, session.id)}>
                          归档会话
                        </button>
                        <button type="button" onClick={() => menuAction(onDeleteSession, session.id)}>
                          永久删除记录
                        </button>
                      </div>
                    </details>
                  </article>
                );
              })}
            </section>
          ))}
      </div>
    </nav>
  );
}
