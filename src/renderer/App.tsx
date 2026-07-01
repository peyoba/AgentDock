import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

type SessionTab = {
  id: string;
  title: string;
  active?: boolean;
};

const tabs: SessionTab[] = [
  { id: 'claude-anyrouter', title: 'Claude AnyRouter · AgentDock', active: true },
  { id: 'codex-openai', title: 'Codex OpenAI · AgentDock' },
  { id: 'claude-kimi', title: 'Claude Kimi · 文档库' },
];

function App(): React.JSX.Element {
  return (
    <main className="app-shell">
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

      <section className="command-bar" aria-label="新建终端会话">
        <button type="button">Claude · AnyRouter A <span>⌄</span></button>
        <button type="button">AgentDock 项目 <span>⌄</span></button>
        <button type="button">claude <span>⌄</span></button>
        <span className="mode-chip">共享目录</span>
        <button type="button" className="launch-button">启动终端</button>
      </section>

      <section className="terminal-card">
        <nav className="session-tabs" aria-label="运行中的会话">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" className={tab.active ? 'active' : ''}>
              <span className="live-dot" />
              {tab.title}
              <span className="close-mark">×</span>
            </button>
          ))}
          <button type="button" className="add-tab">＋</button>
          <button type="button" className="details-toggle">会话详情 ›</button>
        </nav>
        <pre className="terminal-preview">{`# 会话环境预览
✓ 已从 macOS 钥匙串读取 API Key：sk-••••••A7f
✓ 已注入 ANTHROPIC_BASE_URL=https://anyrouter.example.com/v1
✓ 工作目录：~/Documents/Obsidian Vault/项目/AgentDock

peyoba@MacBook AgentDock % claude
Claude Code 正在启动...
当前配置：Claude · AnyRouter A / sonnet-4
当前目录：/Users/peyoba/Documents/Obsidian Vault/项目/AgentDock

这个终端标签页使用独立 endpoint 和 API key，不会影响其他 Claude / Codex 会话。`}</pre>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
