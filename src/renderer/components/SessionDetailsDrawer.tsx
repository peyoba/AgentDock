import React from 'react';
import type { AgentSession, ApiProfile, Workspace } from '../../shared/agentdockTypes';

type SessionDetailsDrawerProps = {
  open: boolean;
  session?: AgentSession;
  profile?: ApiProfile;
  workspace?: Workspace;
};

export function SessionDetailsDrawer({
  open,
  session,
  profile,
  workspace,
}: SessionDetailsDrawerProps): React.JSX.Element | null {
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    setAdvancedOpen(false);
  }, [session?.id]);

  if (!open) {
    return null;
  }

  return (
    <aside className="session-details" aria-label="当前会话详情">
      <h2>当前会话</h2>
      {session && profile && workspace ? (
        <dl>
          <dt>状态</dt>
          <dd>{session.status}</dd>
          <dt>命令</dt>
          <dd>{session.command}</dd>
          <dt>Endpoint</dt>
          <dd>{profile.baseUrl}</dd>
          <dt>Workspace</dt>
          <dd>{workspace.name}</dd>
          <dt>路径</dt>
          <dd>{workspace.path}</dd>
        </dl>
      ) : (
        <p className="empty-state">还没有运行中的会话。</p>
      )}
      {session && profile && workspace ? (
        <div className="session-details-advanced">
          <button
            type="button"
            className="advanced-toggle-button"
            onClick={() => setAdvancedOpen((openAdvanced) => !openAdvanced)}
          >
            {advancedOpen ? '隐藏高级详情' : '显示高级详情'}
          </button>
          {advancedOpen ? (
            <dl>
              <dt>Keychain 位置</dt>
              <dd>{profile.keychainService} / {profile.keychainAccount}</dd>
              <dt>Profile ID</dt>
              <dd>{profile.id}</dd>
            </dl>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
