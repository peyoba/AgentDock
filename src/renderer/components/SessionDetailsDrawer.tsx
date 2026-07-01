import React from 'react';

type SessionDetailsDrawerProps = {
  open: boolean;
};

export function SessionDetailsDrawer({ open }: SessionDetailsDrawerProps): React.JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <aside className="session-details" aria-label="当前会话详情">
      <h2>当前会话</h2>
      <dl>
        <dt>Endpoint</dt>
        <dd>https://anyrouter.example.com/v1</dd>
        <dt>Keychain 位置</dt>
        <dd>AgentDock / claude-anyrouter</dd>
        <dt>Workspace</dt>
        <dd>AgentDock 项目</dd>
      </dl>
    </aside>
  );
}
