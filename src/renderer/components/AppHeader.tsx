import React from 'react';

type AppHeaderProps = {
  /** 不传时隐藏入口（例如已经在接口配置页内，避免重复入口）。 */
  onShowApiConfig?(): void;
  onOpenNewWindow?(): void;
};

export function AppHeader({
  onShowApiConfig,
  onOpenNewWindow,
}: AppHeaderProps): React.JSX.Element {
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
        {onOpenNewWindow ? (
          <button type="button" className="secondary-button" onClick={onOpenNewWindow}>
            新窗口
          </button>
        ) : null}
        {onShowApiConfig ? (
          <button type="button" className="ghost-button" onClick={onShowApiConfig}>
            🔑 接口配置
          </button>
        ) : null}
      </div>
    </header>
  );
}
