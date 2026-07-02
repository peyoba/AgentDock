import React from 'react';
import type { ApiProfile, Workspace } from '../../shared/agentdockTypes';

type CommandBarProps = {
  profiles: ApiProfile[];
  profile?: ApiProfile;
  profileId?: string;
  workspaces: Workspace[];
  workspace?: Workspace;
  workspaceId?: string;
  command: string;
  launching?: boolean;
  onProfileChange(profileId: string): void;
  onWorkspaceChange(workspaceId: string): void;
  onChooseWorkspace?(): void;
  onCommandChange(command: string): void;
  onLaunch(): void;
};

export const CommandBar = React.forwardRef<HTMLElement, CommandBarProps>(function CommandBar({
  profiles,
  profile,
  profileId,
  workspaces,
  workspace,
  workspaceId,
  command,
  launching = false,
  onProfileChange,
  onWorkspaceChange,
  onChooseWorkspace,
  onCommandChange,
  onLaunch,
}, ref): React.JSX.Element {
  return (
    <section ref={ref} className="command-bar" aria-label="新建终端会话">
      <div className="command-intro">
        <div>
          <h2>Quick Launch</h2>
          <p>选择接口、项目目录和命令，一次启动独立终端会话。</p>
        </div>
        <span className="mode-chip">共享目录</span>
      </div>
      <div className="command-fields">
        <label>
          <span>API 配置</span>
          <select
            aria-label="选择 API 配置"
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
            value={workspaceId ?? ''}
            disabled={workspaces.length === 0}
            onChange={(event) => onWorkspaceChange(event.target.value)}
          >
            {workspaces.length === 0 ? <option value="">选择工作区</option> : null}
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {onChooseWorkspace ? (
          <button
            type="button"
            className="workspace-path-button"
            onClick={onChooseWorkspace}
            aria-label="选择工作区路径"
          >
            选择路径
          </button>
        ) : null}
        <label>
          <span>命令</span>
          <select
            aria-label="选择启动命令"
            value={command}
            onChange={(event) => onCommandChange(event.target.value)}
          >
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="gemini">gemini</option>
            <option value="opencode">opencode</option>
            <option value="zsh">zsh（本地 Shell）</option>
          </select>
        </label>
        <button
          type="button"
          className="launch-button"
          disabled={launching || !profile || !workspace || !command}
          onClick={onLaunch}
        >
          {launching ? '启动中…' : '启动终端'}
        </button>
      </div>
    </section>
  );
});
