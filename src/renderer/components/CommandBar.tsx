import React from 'react';
import type { ApiProfile, ClaudeLaunchMode, Workspace } from '../../shared/agentdockTypes';

type CommandBarProps = {
  profiles: ApiProfile[];
  profile?: ApiProfile;
  profileId?: string;
  workspaces: Workspace[];
  workspace?: Workspace;
  workspaceId?: string;
  claudeLaunchMode: ClaudeLaunchMode;
  launching?: boolean;
  onProfileChange(profileId: string): void;
  onWorkspaceChange(workspaceId: string): void;
  onClaudeLaunchModeChange(mode: ClaudeLaunchMode): void;
  onChooseWorkspace?(): void;
  onLaunchLocalShell(): void;
  onLaunch(): void;
};

const chooseWorkspaceOptionValue = '__agentdock_choose_workspace__';

export const CommandBar = React.forwardRef<HTMLElement, CommandBarProps>(function CommandBar({
  profiles,
  profile,
  profileId,
  workspaces,
  workspace,
  workspaceId,
  claudeLaunchMode,
  launching = false,
  onProfileChange,
  onWorkspaceChange,
  onClaudeLaunchModeChange,
  onChooseWorkspace,
  onLaunchLocalShell,
  onLaunch,
}, ref): React.JSX.Element {
  const handleWorkspaceChange = (workspaceValue: string): void => {
    if (workspaceValue === chooseWorkspaceOptionValue) {
      onChooseWorkspace?.();
      return;
    }

    onWorkspaceChange(workspaceValue);
  };
  const showClaudeLaunchMode = profile?.toolType === 'claude';

  return (
    <section ref={ref} className="command-bar" aria-label="新建终端会话">
      <div className={showClaudeLaunchMode ? 'command-fields with-claude-mode' : 'command-fields'}>
        <label>
          <span>API 配置</span>
          <select
            aria-label="选择 API 配置"
            title={profile?.name}
            value={profileId ?? ''}
            disabled={profiles.length === 0}
            onChange={(event) => onProfileChange(event.target.value)}
          >
            {profiles.length === 0 ? <option value="">选择配置</option> : null}
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>工作区</span>
          <select
            aria-label="选择工作区"
            title={workspace ? `${workspace.name} · ${workspace.path}` : undefined}
            value={workspaceId ?? ''}
            disabled={workspaces.length === 0 && !onChooseWorkspace}
            onChange={(event) => handleWorkspaceChange(event.target.value)}
          >
            {workspaces.length === 0 ? <option value="">选择工作区</option> : null}
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            <option value={chooseWorkspaceOptionValue}>选择其他文件夹…</option>
          </select>
        </label>
        {showClaudeLaunchMode ? (
          <label className="claude-launch-mode-field">
            <span>启动模式</span>
            <select
              aria-label="Claude 启动模式"
              title={claudeLaunchMode === 'lite' ? '轻量：不加载 MCP，会话更快更省' : '完整：加载 Claude MCP 配置'}
              value={claudeLaunchMode}
              onChange={(event) =>
                onClaudeLaunchModeChange(event.target.value as ClaudeLaunchMode)
              }
            >
              <option value="lite">轻量 · 空 MCP</option>
              <option value="full">完整 · Claude MCP</option>
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="local-shell-button"
          title="用当前配置的环境变量打开本地 zsh"
          disabled={launching || !profile || !workspace}
          onClick={onLaunchLocalShell}
        >
          zsh
        </button>
        <button
          type="button"
          className="launch-button"
          disabled={launching || !profile || !workspace}
          onClick={onLaunch}
        >
          {launching ? '启动中…' : '启动'}
        </button>
      </div>
    </section>
  );
});
