import React from 'react';
import type {
  ApiProfile,
  ClaudeLaunchMode,
  CodexLaunchMode,
  Workspace,
} from '../../shared/agentdockTypes';

export type LaunchModeSelection = ClaudeLaunchMode | CodexLaunchMode | 'local-shell';

type CommandBarProps = {
  profiles: ApiProfile[];
  profile?: ApiProfile;
  profileId?: string;
  workspaces: Workspace[];
  workspace?: Workspace;
  workspaceId?: string;
  launchMode: LaunchModeSelection;
  launching?: boolean;
  onProfileChange(profileId: string): void;
  onWorkspaceChange(workspaceId: string): void;
  onLaunchModeChange(mode: LaunchModeSelection): void;
  onChooseWorkspace?(): void;
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
  launchMode,
  launching = false,
  onProfileChange,
  onWorkspaceChange,
  onLaunchModeChange,
  onChooseWorkspace,
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
  const showCodexLaunchMode = profile?.toolType === 'codex';
  const commandFieldsClassName = showClaudeLaunchMode
    ? 'command-fields with-claude-mode'
    : showCodexLaunchMode
      ? 'command-fields with-codex-mode'
      : 'command-fields';

  return (
    <section ref={ref} className="command-bar" aria-label="新建终端会话">
      <div className={commandFieldsClassName}>
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
            <span>运行模式</span>
            <select
              aria-label="Claude 启动模式"
              value={launchMode}
              onChange={(event) =>
                onLaunchModeChange(event.target.value as LaunchModeSelection)
              }
            >
              <option value="lite">轻量 Agent · 内置工具 / 空 MCP</option>
              <option value="full">完整 Agent · 内置工具 + MCP</option>
              <option value="local-shell">本地终端</option>
            </select>
          </label>
        ) : null}
        {showCodexLaunchMode ? (
          <label className="codex-launch-mode-field">
            <span>运行模式</span>
            <select
              aria-label="Codex 运行模式"
              value={launchMode}
              onChange={(event) =>
                onLaunchModeChange(event.target.value as LaunchModeSelection)
              }
            >
              <option value="newapi-tool-compatible">完整工具 · NewAPI 兼容</option>
              <option value="native-responses">原生 Codex · Responses</option>
              <option value="local-shell">本地终端</option>
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="launch-button"
          disabled={launching || !profile || !workspace}
          onClick={onLaunch}
        >
          {launching ? '启动中…' : '启动新会话'}
        </button>
      </div>
    </section>
  );
});
