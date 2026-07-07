import React from 'react';
import type { AgentSession, ApiProfile, Workspace } from '../../shared/agentdockTypes';

type SessionLibraryProps = {
  sessions: AgentSession[];
  profiles: ApiProfile[];
  workspaces: Workspace[];
  activeSessionId?: string;
  onNewSession(): void;
  onOpenSession(sessionId: string): void;
  onContinueSession(sessionId: string): void;
  onCloseView(sessionId: string): void;
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

function relativeTimeLabel(startedAt: string): string {
  const timestamp = Date.parse(startedAt);
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3_600_000));
  if (hours < 1) {
    return '现在';
  }
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export function SessionLibrary({
  sessions,
  profiles,
  workspaces,
  activeSessionId,
  onNewSession,
  onOpenSession,
  onContinueSession,
  onCloseView,
  onStopSession,
  onArchiveSession,
  onDeleteSession,
}: SessionLibraryProps): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [showArchived, setShowArchived] = React.useState(false);
  const [openMenuSessionId, setOpenMenuSessionId] = React.useState<string | undefined>();
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
        <h2>AgentDock</h2>
        <button type="button" className="primary-button session-new-button" onClick={onNewSession}>
          新会话
        </button>
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
      {[...groupedWorkspaces, unknownSessions.length > 0 ? {
        workspace: { id: '__unknown__', name: '未归类', path: '' },
        sessions: unknownSessions,
      } : undefined]
        .filter((group): group is { workspace: Workspace; sessions: AgentSession[] } => Boolean(group))
        .map(({ workspace, sessions: workspaceSessions }) => (
          <section key={workspace.id} className="session-library-group">
            <h3>{workspace.name}</h3>
            {workspaceSessions.map((session) => {
              const profileName = profileNameFor(profiles, session.profileId);
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
                    onClick={() => onOpenSession(session.id)}
                  >
                    <span className={`session-status-dot ${session.status}`} aria-hidden="true" />
                    <span className="session-library-title">{session.title}</span>
                    <span className="session-library-meta">
                      {profileName} · {relativeTimeLabel(session.startedAt)}
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
                      <button type="button" onClick={() => onOpenSession(session.id)}>
                        打开视图
                      </button>
                      <button type="button" onClick={() => onCloseView(session.id)}>
                        关闭视图
                      </button>
                      <button type="button" onClick={() => onContinueSession(session.id)}>
                        继续会话
                      </button>
                      {session.status === 'running' || session.status === 'starting' ? (
                        <button type="button" onClick={() => onStopSession(session.id)}>
                          停止
                        </button>
                      ) : null}
                      <button type="button" onClick={() => onArchiveSession(session.id)}>
                        归档
                      </button>
                      <button type="button" onClick={() => onDeleteSession(session.id)}>
                        删除记录
                      </button>
                    </div>
                  </details>
                </article>
              );
            })}
          </section>
        ))}
    </nav>
  );
}
