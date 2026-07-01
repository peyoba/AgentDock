import React from 'react';

export function AppHeader(): React.JSX.Element {
  return (
    <header className="titlebar-spacer">
      <div>
        <h1>AgentDock 代理坞</h1>
        <p>一个窗口收纳多个 Claude / Codex；每个标签页使用独立端点和 API Key。</p>
      </div>
      <div className="header-actions">
        <button type="button" className="ghost-button">🔑 接口配置</button>
        <button type="button" className="primary-button">新建会话</button>
      </div>
    </header>
  );
}
