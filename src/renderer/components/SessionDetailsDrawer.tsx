import React from 'react';
import type { AgentSession, ApiProfile, Workspace } from '../../shared/agentdockTypes';
import { sessionStatusLabel } from '../../shared/sessionStatusLabels';

type SessionDetailsDrawerProps = {
  open: boolean;
  session?: AgentSession;
  profile?: ApiProfile;
  workspace?: Workspace;
  onReadWorkspaceContext?(workspaceId: string): Promise<{ filePath: string; content: string }>;
  onOpenWorkspaceContextFolder?(workspaceId: string): Promise<void>;
};

export function SessionDetailsDrawer({
  open,
  session,
  profile,
  workspace,
  onReadWorkspaceContext,
  onOpenWorkspaceContextFolder,
}: SessionDetailsDrawerProps): React.JSX.Element | null {
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [contextFilePath, setContextFilePath] = React.useState('');
  const [contextContent, setContextContent] = React.useState('');
  const [contextError, setContextError] = React.useState('');

  React.useEffect(() => {
    setAdvancedOpen(false);
    setContextFilePath('');
    setContextContent('');
    setContextError('');
  }, [session?.id]);

  const readWorkspaceContext = async (): Promise<void> => {
    if (!workspace || !onReadWorkspaceContext) {
      return;
    }

    setContextError('');
    try {
      const context = await onReadWorkspaceContext(workspace.id);
      setContextFilePath(context.filePath);
      setContextContent(context.content);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : '无法读取共享上下文');
    }
  };

  const openWorkspaceContextFolder = async (): Promise<void> => {
    if (!workspace || !onOpenWorkspaceContextFolder) {
      return;
    }

    setContextError('');
    try {
      await onOpenWorkspaceContextFolder(workspace.id);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : '无法打开上下文文件夹');
    }
  };

  if (!open) {
    return null;
  }

  return (
    <aside className="session-details" aria-label="当前会话详情">
      <h2>当前会话</h2>
      {session && profile && workspace ? (
        <dl>
          <dt>API 配置</dt>
          <dd>{profile.name}</dd>
          <dt>状态</dt>
          <dd>{sessionStatusLabel(session)}</dd>
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
          <div className="workspace-context-panel">
            <div className="workspace-context-actions">
              <button
                type="button"
                className="advanced-toggle-button"
                onClick={() => void readWorkspaceContext()}
              >
                查看共享上下文
              </button>
              <button
                type="button"
                className="advanced-toggle-button"
                onClick={() => void openWorkspaceContextFolder()}
              >
                打开上下文文件夹
              </button>
            </div>
            {contextError ? <p role="alert">{contextError}</p> : null}
            {contextFilePath ? (
              <div className="workspace-context-preview">
                <span>{contextFilePath}</span>
                <pre>{contextContent}</pre>
              </div>
            ) : null}
          </div>
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
