import React from 'react';
import type { ApiProfile, Workspace } from '../../shared/agentdockTypes';

type CommandBarProps = {
  profiles: ApiProfile[];
  profile?: ApiProfile;
  profileId?: string;
  workspaces: Workspace[];
  workspace?: Workspace;
  workspaceId?: string;
  launching?: boolean;
  onProfileChange(profileId: string): void;
  onWorkspaceChange(workspaceId: string): void;
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
  launching = false,
  onProfileChange,
  onWorkspaceChange,
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

  return (
    <section ref={ref} className="command-bar" aria-label="新建终端会话">
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
        <button
          type="button"
          className="local-shell-button"
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
          {launching ? '启动中…' : '启动终端'}
        </button>
      </div>
    </section>
  );
});
