import React from 'react';

type AppHeaderProps = {
  onShowApiConfig(): void;
  onNewSession(): void;
};

export function AppHeader({ onShowApiConfig, onNewSession }: AppHeaderProps): React.JSX.Element {
  return (
    <header className="titlebar-spacer">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">AD</div>
        <div>
          <h1>AgentDock 代理坞</h1>
          <p>一个窗口收纳多个 Claude / Codex；每个标签页使用独立端点和 API Key。</p>
        </div>
      </div>
      <div className="header-actions">
        <button type="button" className="ghost-button" onClick={onShowApiConfig}>
          🔑 接口配置
        </button>
        <button type="button" className="primary-button" onClick={onNewSession}>
          新建会话
        </button>
      </div>
    </header>
  );
}
