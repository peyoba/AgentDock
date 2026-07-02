import React from 'react';
import type { ApiProfile, Workspace } from '../../shared/agentdockTypes';

type CommandBarProps = {
  profile?: ApiProfile;
  workspace?: Workspace;
  command: string;
  launching?: boolean;
  onLaunch(): void;
};

export function CommandBar({
  profile,
  workspace,
  command,
  launching = false,
  onLaunch,
}: CommandBarProps): React.JSX.Element {
  return (
    <section className="command-bar" aria-label="新建终端会话">
      <button type="button">{profile?.name ?? '选择配置'} <span>⌄</span></button>
      <button type="button">{workspace?.name ?? '选择工作区'} <span>⌄</span></button>
      <button type="button">{command} <span>⌄</span></button>
      <span className="mode-chip">共享目录</span>
      <button
        type="button"
        className="launch-button"
        disabled={launching || !profile || !workspace}
        onClick={onLaunch}
      >
        {launching ? '启动中…' : '启动终端'}
      </button>
    </section>
  );
}
