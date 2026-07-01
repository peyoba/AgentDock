import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { ApiConfigPanel } from './components/ApiConfigPanel';
import { AppHeader } from './components/AppHeader';
import { CommandBar } from './components/CommandBar';
import { SessionDetailsDrawer } from './components/SessionDetailsDrawer';
import { SessionTabs } from './components/SessionTabs';
import { TerminalPane } from './components/TerminalPane';

export type SessionTab = {
  id: string;
  title: string;
  active?: boolean;
};

const tabs: SessionTab[] = [
  { id: 'claude-anyrouter', title: 'Claude AnyRouter · AgentDock', active: true },
  { id: 'codex-openai', title: 'Codex OpenAI · AgentDock' },
  { id: 'claude-kimi', title: 'Claude Kimi · 文档库' },
];

export default function App(): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const activeSessionId = tabs.find((tab) => tab.active)?.id;

  return (
    <main className="app-shell">
      <AppHeader />
      <CommandBar />

      <section className="workspace-grid">
        <section className="terminal-card">
          <SessionTabs
            tabs={tabs}
            detailsOpen={detailsOpen}
            onToggleDetails={() => setDetailsOpen((open) => !open)}
          />
          <TerminalPane sessionId={activeSessionId} />
        </section>

        <SessionDetailsDrawer open={detailsOpen} />
      </section>

      <ApiConfigPanel />
    </main>
  );
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(<App />);
}
