import React from 'react';

export function CommandBar(): React.JSX.Element {
  return (
    <section className="command-bar" aria-label="新建终端会话">
      <button type="button">Claude · AnyRouter A <span>⌄</span></button>
      <button type="button">AgentDock 项目 <span>⌄</span></button>
      <button type="button">claude <span>⌄</span></button>
      <span className="mode-chip">共享目录</span>
      <button type="button" className="launch-button">启动终端</button>
    </section>
  );
}
