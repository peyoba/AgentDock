import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { ApiConfigPanel, type ApiConfigFilter } from './components/ApiConfigPanel';
import { AppHeader } from './components/AppHeader';
import { CommandBar } from './components/CommandBar';
import { SessionDetailsDrawer } from './components/SessionDetailsDrawer';
import { SessionTabs } from './components/SessionTabs';
import { TerminalPane } from './components/TerminalPane';
import { defaultApiProfiles } from '../shared/defaultApiProfiles';
import type {
  AgentSession,
  ApiProfile,
  ClaudeLaunchMode,
  LaunchRequest,
  Workspace,
} from '../shared/agentdockTypes';

export type SessionTab = {
  id: string;
  title: string;
  active?: boolean;
};

type ActivePage = 'workbench' | 'apiConfig';

const fallbackProfiles: ApiProfile[] = defaultApiProfiles;

const fallbackWorkspaces: Workspace[] = [
  {
    id: 'agentdock',
    name: 'AgentDock 预览',
    path: '/tmp/agentdock-preview',
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
    const bypass = profile.bypassApprovals ?? true;
    return bypass ? 'codex --dangerously-bypass-approvals-and-sandbox' : 'codex';
  }

  if (profile?.toolType === 'claude') {
    const skip = profile.skipPermissions ?? true;
    return skip ? 'claude --dangerously-skip-permissions' : 'claude';
  }

  return profile?.toolType ?? 'claude --dangerously-skip-permissions';
}

function safeLaunchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return '启动失败，请检查配置。';
  }

  const [firstLine] = error.message.split(/[;\n]/);
  return firstLine || '启动失败，请检查配置。';
}

function upsertWorkspace(workspaces: Workspace[], nextWorkspace: Workspace): Workspace[] {
  const existingIndex = workspaces.findIndex(
    (workspace) => workspace.id === nextWorkspace.id || workspace.path === nextWorkspace.path,
  );

  if (existingIndex === -1) {
    return [...workspaces, nextWorkspace];
  }

  return workspaces.map((workspace, index) => (index === existingIndex ? nextWorkspace : workspace));
}

export default function App(): React.JSX.Element {
  const api = typeof window === 'undefined' ? undefined : window.agentDock;
  const commandBarRef = React.useRef<HTMLElement>(null);
  const [activePage, setActivePage] = React.useState<ActivePage>('workbench');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [profiles, setProfiles] = React.useState<ApiProfile[]>(api ? [] : fallbackProfiles);
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>(api ? [] : fallbackWorkspaces);
  const [sessions, setSessions] = React.useState<AgentSession[]>(api ? [] : fallbackSessions);
  const [selectedProfileId, setSelectedProfileId] = React.useState<string | undefined>(
    api ? undefined : fallbackProfiles[0]?.id,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState<string | undefined>(
    api ? undefined : fallbackWorkspaces[0]?.id,
  );
  const [claudeLaunchMode, setClaudeLaunchMode] = React.useState<ClaudeLaunchMode>('lite');
  const [apiConfigFilter, setApiConfigFilter] = React.useState<ApiConfigFilter>('all');
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
        setSelectedProfileId((current) => current ?? nextProfiles[0]?.id);
        setSelectedWorkspaceId((current) => current ?? nextWorkspaces[0]?.id);
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

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0];
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeSessionProfile = profiles.find((profile) => profile.id === activeSession?.profileId);
  const activeSessionWorkspace = workspaces.find(
    (workspace) => workspace.id === activeSession?.workspaceId,
  );
  const tabs = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    active: session.id === activeSessionId,
  }));

  const selectProfile = (profileId: string): void => {
    const nextProfile = profiles.find((profile) => profile.id === profileId);
    setSelectedProfileId(profileId);
    if (nextProfile) {
      setApiConfigFilter(nextProfile.toolType);
    }
  };

  const launchSession = async (commandOverride?: string): Promise<AgentSession | undefined> => {
    if (!selectedProfile || !selectedWorkspace) {
      setLaunchError('启动失败，请先选择 API 配置和工作区。');
      return undefined;
    }

    const command = commandOverride ?? defaultCommandFor(selectedProfile);
    const launchRequest: LaunchRequest = {
      profileId: selectedProfile.id,
      workspaceId: selectedWorkspace.id,
      command,
    };
    if (selectedProfile.toolType === 'claude' && !commandOverride) {
      launchRequest.claudeLaunchMode = claudeLaunchMode;
    }

    if (!api) {
      const session: AgentSession = {
        id: `local-${Date.now()}`,
        title: `${selectedProfile.name} · ${selectedWorkspace.name}`,
        profileId: selectedProfile.id,
        workspaceId: selectedWorkspace.id,
        command,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      setSessions((current) => [...current, session]);
      setActiveSessionId(session.id);
      return session;
    }

    setLaunching(true);
    setLaunchError(null);
    try {
      const session = await api.launchSession(launchRequest);
      setSessions((current) => [...current.filter((item) => item.id !== session.id), session]);
      setActiveSessionId(session.id);
      return session;
    } catch (error) {
      setLaunchError(safeLaunchError(error));
      return undefined;
    } finally {
      setLaunching(false);
    }
  };

  const closeSession = async (sessionId: string): Promise<void> => {
    if (api) {
      try {
        await api.killTerminal({ sessionId });
      } catch (error) {
        setLaunchError(safeLaunchError(error));
        return;
      }
    }

    setSessions((current) => current.filter((session) => session.id !== sessionId));
    setActiveSessionId((current) => {
      if (current !== sessionId) {
        return current;
      }
      return sessions.find((session) => session.id !== sessionId)?.id;
    });
  };

  const saveProfile = async (profile: ApiProfile): Promise<ApiProfile> => {
    const savedProfile = api ? await api.saveProfile(profile) : profile;

    setProfiles((current) => {
      if (!current.some((item) => item.id === savedProfile.id)) {
        return [...current, savedProfile];
      }

      return current.map((item) => (item.id === savedProfile.id ? savedProfile : item));
    });
    setSelectedProfileId(savedProfile.id);
    setApiConfigFilter(savedProfile.toolType);

    return savedProfile;
  };

  const saveProfileSecret = async (request: {
    keychainService: string;
    keychainAccount: string;
    secret: string;
  }): Promise<void> => {
    if (!api) {
      return;
    }

    await api.saveProfileSecret(request);
  };

  const readProfileSecret = async (request: {
    keychainService: string;
    keychainAccount: string;
  }): Promise<string> => {
    if (!api) {
      return '';
    }

    return api.readProfileSecret(request);
  };

  const fetchProfileModels = async (request: { profileId: string }): Promise<string[]> => {
    if (!api) {
      return [];
    }

    return api.fetchProfileModels(request);
  };

  const deleteProfile = async (profileId: string): Promise<void> => {
    if (!api) {
      return;
    }

    await api.deleteProfile(profileId);
    setProfiles((current) => current.filter((item) => item.id !== profileId));
    if (selectedProfileId === profileId) {
      setSelectedProfileId(undefined);
    }
  };

  const chooseWorkspace = async (): Promise<void> => {
    if (!api) {
      return;
    }

    setLaunchError(null);
    try {
      const workspace = await api.chooseWorkspace();
      if (!workspace) {
        return;
      }

      setWorkspaces((current) => upsertWorkspace(current, workspace));
      setSelectedWorkspaceId(workspace.id);
    } catch (error) {
      setLaunchError(safeLaunchError(error));
    }
  };

  const showApiConfig = (): void => {
    setActivePage('apiConfig');
    setApiConfigFilter('all');
  };

  return (
    <main className="app-shell">
      <AppHeader onShowApiConfig={showApiConfig} />
      {activePage === 'workbench' ? (
        <>
          <CommandBar
            ref={commandBarRef}
            profiles={profiles}
            profile={selectedProfile}
            profileId={selectedProfile?.id}
            workspaces={workspaces}
            workspace={selectedWorkspace}
            workspaceId={selectedWorkspace?.id}
            claudeLaunchMode={claudeLaunchMode}
            launching={launching}
            onProfileChange={selectProfile}
            onWorkspaceChange={setSelectedWorkspaceId}
            onClaudeLaunchModeChange={setClaudeLaunchMode}
            onChooseWorkspace={api ? () => void chooseWorkspace() : undefined}
            onLaunchLocalShell={() => void launchSession('zsh')}
            onLaunch={() => void launchSession()}
          />
          {launchError ? <p role="alert" className="launch-error">{launchError}</p> : null}

          <section className={detailsOpen ? 'workspace-grid details-open' : 'workspace-grid'}>
            <section className="terminal-card">
              <SessionTabs
                tabs={tabs}
                detailsOpen={detailsOpen}
                onToggleDetails={() => setDetailsOpen((open) => !open)}
                onSelectSession={setActiveSessionId}
                onAddSession={() => void launchSession()}
                onCloseSession={(sessionId) => void closeSession(sessionId)}
              />
              <TerminalPane
                sessionId={activeSessionId}
                preserveHistory={activeSession ? !['zsh', 'bash'].includes(activeSession.command) : true}
              />
            </section>

            <SessionDetailsDrawer
              open={detailsOpen}
              session={activeSession}
              profile={activeSessionProfile}
              workspace={activeSessionWorkspace}
            />
          </section>
        </>
      ) : (
        <section className="settings-page" aria-label="接口配置页面">
        <ApiConfigPanel
          profiles={profiles}
          selectedProfileId={selectedProfile?.id}
          filter={apiConfigFilter}
          onFilterChange={setApiConfigFilter}
          onSelectProfile={selectProfile}
          onSaveProfile={saveProfile}
          onDeleteProfile={deleteProfile}
          onSaveProfileSecret={saveProfileSecret}
          onReadProfileSecret={readProfileSecret}
          onFetchProfileModels={fetchProfileModels}
          onBackToWorkbench={() => setActivePage('workbench')}
        />
        </section>
      )}
    </main>
  );
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(<App />);
}
