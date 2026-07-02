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
import type { AgentSession, ApiProfile, Workspace } from '../shared/agentdockTypes';

export type SessionTab = {
  id: string;
  title: string;
  active?: boolean;
};

const fallbackProfiles: ApiProfile[] = [
  {
    id: 'claude-anyrouter',
    name: 'Claude · AnyRouter A',
    toolType: 'claude',
    baseUrl: 'https://anyrouter.example.com/v1',
    defaultModel: 'sonnet-4',
    keychainService: 'AgentDock',
    keychainAccount: 'claude-anyrouter',
  },
];

const fallbackWorkspaces: Workspace[] = [
  {
    id: 'agentdock',
    name: 'AgentDock 项目',
    path: '/Users/peyoba/Desktop/web/AgentDock',
  },
];

const fallbackSessions: AgentSession[] = [
  {
    id: 'claude-anyrouter',
    title: 'Claude AnyRouter · AgentDock',
    profileId: 'claude-anyrouter',
    workspaceId: 'agentdock',
    command: 'claude',
    status: 'running',
    startedAt: '2026-07-02T00:00:00.000Z',
  },
  {
    id: 'codex-openai',
    title: 'Codex OpenAI · AgentDock',
    profileId: 'codex-openai',
    workspaceId: 'agentdock',
    command: 'codex',
    status: 'running',
    startedAt: '2026-07-02T00:00:00.000Z',
  },
  {
    id: 'claude-kimi',
    title: 'Claude Kimi · 文档库',
    profileId: 'claude-kimi',
    workspaceId: 'agentdock',
    command: 'claude',
    status: 'running',
    startedAt: '2026-07-02T00:00:00.000Z',
  },
];

function defaultCommandFor(profile?: ApiProfile): string {
  if (profile?.toolType === 'codex') {
    return 'codex';
  }

  return 'claude';
}

function safeLaunchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return '启动失败，请检查配置。';
  }

  const [firstLine] = error.message.split(/[;\n]/);
  return firstLine || '启动失败，请检查配置。';
}

export default function App(): React.JSX.Element {
  const api = typeof window === 'undefined' ? undefined : window.agentDock;
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [profiles, setProfiles] = React.useState<ApiProfile[]>(api ? [] : fallbackProfiles);
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>(api ? [] : fallbackWorkspaces);
  const [sessions, setSessions] = React.useState<AgentSession[]>(api ? [] : fallbackSessions);
  const [activeSessionId, setActiveSessionId] = React.useState<string | undefined>(
    api ? undefined : fallbackSessions[0]?.id,
  );
  const [launching, setLaunching] = React.useState(false);
  const [launchError, setLaunchError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!api) {
      return undefined;
    }

    let cancelled = false;
    void Promise.all([api.listProfiles(), api.listWorkspaces(), api.listSessions()])
      .then(([nextProfiles, nextWorkspaces, nextSessions]) => {
        if (cancelled) {
          return;
        }
        setProfiles(nextProfiles);
        setWorkspaces(nextWorkspaces);
        setSessions(nextSessions);
        setActiveSessionId((current) => current ?? nextSessions[0]?.id);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLaunchError(safeLaunchError(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const selectedProfile = profiles[0];
  const selectedWorkspace = workspaces[0];
  const command = defaultCommandFor(selectedProfile);
  const tabs = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    active: session.id === activeSessionId,
  }));

  const launchSession = async (): Promise<void> => {
    if (!api || !selectedProfile || !selectedWorkspace) {
      return;
    }

    setLaunching(true);
    setLaunchError(null);
    try {
      const session = await api.launchSession({
        profileId: selectedProfile.id,
        workspaceId: selectedWorkspace.id,
        command,
      });
      setSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
      setActiveSessionId(session.id);
    } catch (error) {
      setLaunchError(safeLaunchError(error));
    } finally {
      setLaunching(false);
    }
  };

  return (
    <main className="app-shell">
      <AppHeader />
      <CommandBar
        profile={selectedProfile}
        workspace={selectedWorkspace}
        command={command}
        launching={launching}
        onLaunch={() => void launchSession()}
      />
      {launchError ? <p role="alert" className="launch-error">{launchError}</p> : null}

      <section className="workspace-grid">
        <section className="terminal-card">
          <SessionTabs
            tabs={tabs}
            detailsOpen={detailsOpen}
            onToggleDetails={() => setDetailsOpen((open) => !open)}
            onSelectSession={setActiveSessionId}
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
