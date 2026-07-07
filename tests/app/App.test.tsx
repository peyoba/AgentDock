import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';
import type {
  AppBuildInfo,
  AgentSession,
  ApiProfile,
  Workspace,
  WorkspaceDirectoryRequest,
  WorkspaceDirectoryResult,
} from '../../src/shared/agentdockTypes';
import type { AgentDockApi } from '../../src/shared/preloadTypes';

vi.mock('../../src/renderer/components/TerminalPane', () => ({
  TerminalPane: ({ sessionId, readOnly }: { sessionId?: string; readOnly?: boolean }) => (
    <div
      aria-label="终端输出"
      data-read-only={readOnly ? 'true' : 'false'}
      data-session-id={sessionId ?? ''}
    />
  ),
}));

type TestAgentDockApi = AgentDockApi & {
  chooseWorkspace: ReturnType<typeof vi.fn<() => Promise<Workspace | undefined>>>;
  saveProfile: ReturnType<typeof vi.fn<[(profile: ApiProfile) => Promise<ApiProfile>]>>;
  deleteProfile: ReturnType<typeof vi.fn<[(profileId: string) => Promise<void>]>>;
  saveProfileSecret: ReturnType<typeof vi.fn<[(request: { keychainService: string; keychainAccount: string; secret: string }) => Promise<void>]>>;
  readProfileSecret: ReturnType<typeof vi.fn<[(request: { keychainService: string; keychainAccount: string }) => Promise<string>]>>;
  fetchProfileModels: ReturnType<typeof vi.fn<[(request: { profileId: string }) => Promise<string[]>]>>;
  readWorkspaceContext: ReturnType<typeof vi.fn<[(request: { workspaceId: string }) => Promise<{ filePath: string; content: string }>]>>;
  openWorkspaceContextFolder: ReturnType<typeof vi.fn<[(request: { workspaceId: string }) => Promise<void>]>>;
  openNewWindow: ReturnType<typeof vi.fn<() => Promise<void>>>;
  onMetadataChanged: ReturnType<typeof vi.fn<[(listener: () => void) => () => void]>>;
  onSessionChanged: ReturnType<typeof vi.fn<[(listener: (session: AgentSession) => void) => () => void]>>;
  closeSessionView: ReturnType<typeof vi.fn<[(request: { sessionId: string; viewId: string }) => Promise<AgentSession>]>>;
  archiveSessionRecord: ReturnType<typeof vi.fn<[(request: { sessionId: string }) => Promise<AgentSession>]>>;
  deleteSessionRecord: ReturnType<typeof vi.fn<[(request: { sessionId: string }) => Promise<void>]>>;
  archiveSessionHistory: ReturnType<typeof vi.fn<[(request: { sessionId: string }) => Promise<{ filePath: string }>]>>;
  restartSession: ReturnType<typeof vi.fn<[(request: { sessionId: string; command?: string; claudeLaunchMode?: 'lite' | 'full' }) => Promise<AgentSession>]>>;
  getSessionContextPressure: ReturnType<typeof vi.fn<[(request: { sessionId: string }) => Promise<{ sessionId: string; level: 'low' | 'medium' | 'high' | 'full'; score: number }>]>>;
  summarizeSession: ReturnType<typeof vi.fn<[(request: { sessionId: string; continueAfterSummary?: boolean }) => Promise<{ status: 'success'; summaryFile: string; handoffFile: string; handoffPrompt: string; continuationSession?: AgentSession }>]>>;
  listWorkspaceDirectory: ReturnType<typeof vi.fn<[(request: WorkspaceDirectoryRequest) => Promise<WorkspaceDirectoryResult>]>>;
  getBuildInfo: ReturnType<typeof vi.fn<() => Promise<AppBuildInfo>>>;
};

function installAgentDockApi(overrides: Partial<TestAgentDockApi> = {}) {
  const api: TestAgentDockApi = {
    version: '0.1.0',
    getBuildInfo: vi.fn().mockResolvedValue({
      version: '0.1.0',
      buildId: 'dev',
      buildTime: '2026-07-08T00:00:00.000Z',
      commit: 'unknown',
      commitShort: 'unknown',
      dirty: false,
    }),
    listProfiles: vi.fn().mockResolvedValue([
      {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
    ]),
    listWorkspaces: vi.fn().mockResolvedValue([
      {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
    ]),
    chooseWorkspace: vi.fn().mockResolvedValue(undefined),
    saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    saveProfileSecret: vi.fn().mockResolvedValue(undefined),
    readProfileSecret: vi.fn().mockResolvedValue(''),
    fetchProfileModels: vi.fn().mockResolvedValue([]),
    launchSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-02T00:00:00.000Z',
    }),
    restartSession: vi.fn().mockResolvedValue({
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-02T00:00:00.000Z',
    }),
    listSessions: vi.fn().mockResolvedValue([]),
    closeSessionView: vi.fn(async ({ sessionId }: { sessionId: string; viewId: string }) => ({
      id: sessionId,
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'stopped',
      startedAt: '2026-07-02T00:00:00.000Z',
    })),
    archiveSessionRecord: vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      id: sessionId,
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'stopped',
      archived: true,
      startedAt: '2026-07-02T00:00:00.000Z',
    })),
    deleteSessionRecord: vi.fn().mockResolvedValue(undefined),
    writeTerminal: vi.fn().mockResolvedValue(undefined),
    resizeTerminal: vi.fn().mockResolvedValue(undefined),
    killTerminal: vi.fn(),
    readTerminalBuffer: vi.fn().mockResolvedValue(''),
    archiveSessionHistory: vi.fn().mockResolvedValue({ filePath: '/tmp/archive.txt' }),
    getSessionContextPressure: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      level: 'low',
      score: 1,
    }),
    summarizeSession: vi.fn().mockResolvedValue({
      status: 'success',
      summaryFile: '/tmp/summary.md',
      handoffFile: '/tmp/handoff.md',
      handoffPrompt: 'Read the AgentDock handoff first',
    }),
    listWorkspaceDirectory: vi.fn().mockResolvedValue({
      workspaceId: 'workspace-a',
      relativePath: '.',
      entries: [],
    }),
    onTerminalOutput: vi.fn(() => () => undefined),
    readWorkspaceContext: vi.fn().mockResolvedValue({ filePath: '', content: '' }),
    openWorkspaceContextFolder: vi.fn().mockResolvedValue(undefined),
    openNewWindow: vi.fn().mockResolvedValue(undefined),
    onMetadataChanged: vi.fn(() => () => undefined),
    onSessionChanged: vi.fn(() => () => undefined),
    ...overrides,
  };
  window.agentDock = api;
  return api;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'agentDock');
});

async function openApiConfigPage(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /接口配置/ }));
  await screen.findByRole('region', { name: 'API 配置' });
}

describe('AgentDock shell', () => {
  it('shows package version and build identity in the session library', async () => {
    installAgentDockApi({
      getBuildInfo: vi.fn().mockResolvedValue({
        version: '0.2.0',
        buildId: '20260708-061530',
        buildTime: '2026-07-08T06:15:30.000Z',
        commit: '01d1331abcdef',
        commitShort: '01d1331',
        dirty: false,
      }),
    });

    render(<App />);

    const versionInfo = await screen.findByLabelText('AgentDock 版本信息');
    expect(versionInfo).toHaveTextContent('v0.2.0 · 20260708-061530');
    expect(versionInfo).toHaveAttribute(
      'title',
      expect.stringContaining('commit 01d1331'),
    );
  });

  it('opens a new AgentDock window from the header action', async () => {
    const api = installAgentDockApi({
      openNewWindow: vi.fn().mockResolvedValue(undefined),
    });

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '新窗口' }));

    await waitFor(() => {
      expect(api.openNewWindow).toHaveBeenCalled();
    });
  });

  it('refreshes profile and workspace metadata when another window changes it', async () => {
    let metadataListener: (() => void) | undefined;
    const api = installAgentDockApi({
      listProfiles: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'profile-a',
            name: 'Claude A',
            toolType: 'claude',
            baseUrl: 'https://a.example.invalid',
            keychainService: 'AgentDock',
            keychainAccount: 'profile-a',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'profile-b',
            name: 'Claude B',
            toolType: 'claude',
            baseUrl: 'https://b.example.invalid',
            keychainService: 'AgentDock',
            keychainAccount: 'profile-b',
          },
        ]),
      onMetadataChanged: vi.fn((listener: () => void) => {
        metadataListener = listener;
        return () => undefined;
      }),
    });

    render(<App />);
    expect(await screen.findByText('Claude A')).toBeInTheDocument();

    metadataListener?.();

    await waitFor(() => {
      expect(api.listProfiles).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Claude B')).toBeInTheDocument();
    });
  });

  it('renders terminal-first launch controls', () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: /新建会话/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启动终端' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Quick Launch' })).not.toBeInTheDocument();
    expect(screen.queryByText('选择接口、项目目录和命令，一次启动独立终端会话。')).not.toBeInTheDocument();
    expect(screen.getByLabelText('新建终端会话')).toBeInTheDocument();
    expect(screen.getByLabelText('运行中的会话')).toBeInTheDocument();
    expect(screen.queryByText('共享目录')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择启动命令')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'zsh' })).toBeInTheDocument();
    expect(screen.getByLabelText('选择工作区')).toHaveTextContent('选择其他文件夹…');
    expect(screen.getByLabelText('Claude 启动模式')).toHaveValue('lite');
    expect(screen.getByText('轻量 · 空 MCP')).toBeInTheDocument();
  });

  it('renders a workspace-grouped session library with a single new session action', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://a.example.invalid',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
        {
          id: 'profile-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://b.example.invalid',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-b',
        },
      ]),
      listWorkspaces: vi.fn().mockResolvedValue([
        {
          id: 'workspace-a',
          name: 'AgentDock',
          path: '/Users/example/Desktop/web/AgentDock',
        },
      ]),
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'running',
          startedAt: '2026-07-07T00:00:00.000Z',
        },
        {
          id: 'session-2',
          title: 'Codex B · AgentDock',
          profileId: 'profile-b',
          workspaceId: 'workspace-a',
          command: 'codex',
          status: 'stopped',
          startedAt: '2026-07-07T01:00:00.000Z',
        },
      ]),
    });

    render(<App />);

    const library = await screen.findByRole('navigation', { name: '会话库' });
    expect(library).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '新会话' })).toHaveLength(1);
    expect(within(library).getByRole('heading', { name: 'AgentDock', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Claude A · AgentDock/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Codex B · AgentDock/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '运行中的会话' })).not.toBeInTheDocument();
  });

  it('filters the session library by title, workspace, and profile metadata', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'profile-a',
          name: 'Claude AnyRouter',
          toolType: 'claude',
          baseUrl: 'https://a.example.invalid',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
        {
          id: 'profile-b',
          name: 'Codex OpenAI',
          toolType: 'codex',
          baseUrl: 'https://b.example.invalid',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-b',
        },
      ]),
      listWorkspaces: vi.fn().mockResolvedValue([
        {
          id: 'workspace-a',
          name: 'AgentDock',
          path: '/Users/example/Desktop/web/AgentDock',
        },
        {
          id: 'workspace-b',
          name: 'Notes Vault',
          path: '/Users/example/Documents/Notes',
        },
      ]),
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude planning',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'running',
          startedAt: '2026-07-07T00:00:00.000Z',
        },
        {
          id: 'session-2',
          title: 'Daily notes',
          profileId: 'profile-b',
          workspaceId: 'workspace-b',
          command: 'codex',
          status: 'stopped',
          startedAt: '2026-07-07T01:00:00.000Z',
        },
      ]),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Claude planning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Daily notes' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索会话'), { target: { value: 'OpenAI' } });

    expect(screen.queryByRole('button', { name: 'Claude planning' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Daily notes' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('搜索会话'), { target: { value: 'AgentDock' } });

    expect(screen.getByRole('button', { name: 'Claude planning' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Daily notes' })).not.toBeInTheDocument();
  });

  it('hides archived records by default and shows them from the all-records filter', async () => {
    installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Active session',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'running',
          startedAt: '2026-07-07T00:00:00.000Z',
        },
        {
          id: 'session-archived',
          title: 'Archived session',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'exited',
          archived: true,
          startedAt: '2026-07-06T00:00:00.000Z',
        },
      ]),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Active session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archived session' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全部记录' }));

    expect(screen.getByRole('button', { name: 'Archived session' })).toBeInTheDocument();
  });

  it('keeps the right project panel collapsed by default and toggles it from the rail', () => {
    render(<App />);

    expect(screen.getByRole('complementary', { name: '项目面板' })).toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: '展开项目面板' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开项目面板' }));

    expect(screen.getByRole('complementary', { name: '项目面板' })).toHaveClass('open');
    expect(screen.getByRole('button', { name: '收起项目面板' })).toBeInTheDocument();
  });

  it('shows a read-only project file tree with git and session change markers', async () => {
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'running',
          startedAt: '2026-07-07T00:00:00.000Z',
          memoryRestore: {
            status: 'loaded',
            summary: '记忆已恢复：已加载最近会话背景。',
            contextFile: '/tmp/workspace/.agentdock/context/restores/session-1.md',
          },
        },
      ]),
      listWorkspaceDirectory: vi.fn().mockResolvedValue({
        workspaceId: 'workspace-a',
        relativePath: '.',
        entries: [
          { name: 'src', relativePath: 'src', type: 'directory' },
          {
            name: 'App.tsx',
            relativePath: 'src/App.tsx',
            type: 'file',
            gitStatus: 'M',
            touchedInSession: true,
            additions: 148,
            deletions: 37,
          },
        ],
      }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开项目面板' }));

    const fileTree = await screen.findByRole('tree', { name: '项目文件树' });
    expect(fileTree).toBeInTheDocument();
    expect(api.listWorkspaceDirectory).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      relativePath: '.',
      sessionId: 'session-1',
    });
    expect(screen.getByText('只读')).toHaveAttribute(
      'title',
      '项目面板只用于查看文件和状态，AgentDock 不在这里编辑代码。',
    );
    expect(screen.getByRole('treeitem', { name: /App\.tsx/ })).toBeInTheDocument();
    expect(within(fileTree).getByText('M')).toBeInTheDocument();
    expect(within(fileTree).getByText('本会话期间发生变化')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选中文件' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('src/App.tsx')).toBeInTheDocument();
    expect(screen.getByText('+148 / -37')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '当前会话' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '恢复摘要' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('separator', { name: '调整项目信息区高度' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret source text');
  });

  it('labels native resume separately in the recovery summary section', async () => {
    installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --resume 123e4567-e89b-12d3-a456-426614174000',
          status: 'running',
          startedAt: '2026-07-07T00:00:00.000Z',
          memoryRestore: {
            method: 'native',
            status: 'loaded',
            summary: '原生恢复已验证：使用 Claude 会话 ID 恢复。',
            contextFile: '/tmp/workspace/.agentdock/context/restores/session-1.md',
          },
        },
      ]),
      listWorkspaceDirectory: vi.fn().mockResolvedValue({
        workspaceId: 'workspace-a',
        relativePath: '.',
        entries: [],
      }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开项目面板' }));
    fireEvent.click(await screen.findByRole('button', { name: '恢复摘要' }));

    const projectPanel = screen.getByRole('complementary', { name: '项目面板' });
    expect(within(projectPanel).getByText('原生 resume')).toBeInTheDocument();
    expect(within(projectPanel).queryByText('AgentDock 恢复材料')).not.toBeInTheDocument();
    expect(within(projectPanel).getByText('原生恢复已验证：使用 Claude 会话 ID 恢复。')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('/tmp/workspace/.agentdock/context/restores/session-1.md');
  });

  it('uses the full terminal width until session details are opened', () => {
    render(<App />);

    const workspaceGrid = screen.getByLabelText('运行中的会话').closest('.workspace-grid');
    expect(workspaceGrid).not.toHaveClass('details-open');

    fireEvent.click(screen.getByRole('button', { name: /会话详情/ }));

    expect(workspaceGrid).toHaveClass('details-open');
  });

  it('keeps current session details collapsed by default', () => {
    render(<App />);

    expect(screen.queryByText(/Keychain 位置/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /会话详情/ })).toBeInTheDocument();
  });

  it('keeps engineering details hidden behind an advanced session details toggle', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /会话详情/ }));

    expect(screen.getByRole('complementary', { name: '当前会话详情' })).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.queryByText(/Keychain 位置/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '显示高级详情' }));

    expect(screen.getByText(/Keychain 位置/)).toBeInTheDocument();
  });

  it('shows workspace shared context from current session details', async () => {
    const runningSession: AgentSession = {
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-02T00:00:00.000Z',
    };
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([runningSession]),
      readWorkspaceContext: vi.fn().mockResolvedValue({
        filePath: '/Users/example/Desktop/web/AgentDock/.agentdock/context/shared-context.md',
        content: '# AgentDock Shared Context',
      }),
      openWorkspaceContextFolder: vi.fn().mockResolvedValue(undefined),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /会话详情/ }));
    fireEvent.click(screen.getByRole('button', { name: '查看共享上下文' }));

    expect(await screen.findByText('/Users/example/Desktop/web/AgentDock/.agentdock/context/shared-context.md')).toBeInTheDocument();
    expect(screen.getByText('# AgentDock Shared Context')).toBeInTheDocument();
    expect(api.readWorkspaceContext).toHaveBeenCalledWith({ workspaceId: 'workspace-a' });

    fireEvent.click(screen.getByRole('button', { name: '打开上下文文件夹' }));

    await waitFor(() => {
      expect(api.openWorkspaceContextFolder).toHaveBeenCalledWith({ workspaceId: 'workspace-a' });
    });
  });

  it('shows the API profile name in session details and exposes session library actions', async () => {
    const runningSession: AgentSession = {
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-02T00:00:00.000Z',
    };
    installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([runningSession]),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Claude A · AgentDock 更多操作'));
    expect(screen.getByRole('button', { name: '关闭视图' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除记录' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /会话详情/ }));

    const details = screen.getByRole('complementary', { name: '当前会话详情' });
    expect(within(details).getByText('API 配置')).toBeInTheDocument();
    expect(within(details).getByText('Claude A')).toBeInTheDocument();
  });

  it('opens API config as a separate page instead of embedding it in the terminal workspace', async () => {
    render(<App />);

    expect(screen.getByLabelText('新建终端会话')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'API 配置' })).not.toBeInTheDocument();

    await openApiConfigPage();

    expect(screen.getByRole('region', { name: 'API 配置' })).toBeInTheDocument();
    expect(screen.queryByLabelText('新建终端会话')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回终端工作台' }));

    expect(screen.getByLabelText('新建终端会话')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'API 配置' })).not.toBeInTheDocument();
  });

  it('groups API configs by tool type', async () => {
    render(<App />);

    await openApiConfigPage();

    expect(screen.getByRole('button', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gemini' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OpenCode' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
  });

  it('keeps Keychain references out of default API config cards', async () => {
    render(<App />);

    await openApiConfigPage();

    expect(screen.getByLabelText('API 配置列表')).toBeInTheDocument();
    expect(screen.queryByText(/Keychain：/)).not.toBeInTheDocument();
  });
});

describe('AgentDock session launch flow', () => {
  it('loads metadata and launches a real IPC session from the command bar', async () => {
    const api = installAgentDockApi();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('选择 API 配置')).toHaveValue('profile-a');
    });
    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'lite',
      });
    });
    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
  });

  it('can launch Claude with full MCP mode when explicitly selected', async () => {
    const api = installAgentDockApi();

    render(<App />);

    fireEvent.change(await screen.findByLabelText('Claude 启动模式'), {
      target: { value: 'full' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'full',
      });
    });
  });

  it('can launch a local zsh terminal command for manual terminal verification', async () => {
    const api = installAgentDockApi();

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'zsh' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'zsh',
      });
    });
  });

  it('shows safe launch errors without leaking secret values', async () => {
    const secret = 'agentdock-secret-must-not-render';
    installAgentDockApi({
      launchSession: vi.fn().mockRejectedValue(
        new Error(`API key was not found for account "profile-a"; ${secret}`),
      ),
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '启动终端' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('API key was not found for account "profile-a"');
    expect(alert).not.toHaveTextContent(secret);
  });

  it('shows an exited session action bar and resumes in the same tab', async () => {
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          claudeLaunchMode: 'lite',
          status: 'exited',
          startedAt: '2026-07-02T00:00:00.000Z',
          exitCode: 0,
          resumeCommand: 'claude --resume c4bf-b857',
        },
      ]),
      restartSession: vi
        .fn()
        .mockResolvedValue({
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --resume c4bf-b857',
          status: 'running',
          startedAt: '2026-07-02T00:01:00.000Z',
        }),
      readTerminalBuffer: vi.fn().mockResolvedValue('terminal history'),
      killTerminal: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        status: 'stopped',
        startedAt: '2026-07-02T00:00:00.000Z',
      }),
    });

    render(<App />);

    expect(await screen.findByText('会话已退出 · exit code 0')).toBeInTheDocument();
    expect(screen.getByLabelText('终端输出')).toHaveAttribute('data-read-only', 'true');

    fireEvent.click(screen.getByRole('button', { name: '恢复会话' }));
    await waitFor(() => {
      expect(api.restartSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
        command: 'claude --resume c4bf-b857',
        claudeLaunchMode: 'lite',
      });
    });
    expect(api.launchSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText('终端输出')).toHaveAttribute('data-session-id', 'session-1');
  });

  it('shows an interrupted session action bar and restarts it in the same tab', async () => {
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          claudeLaunchMode: 'lite',
          status: 'interrupted',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      restartSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        status: 'running',
        startedAt: '2026-07-02T00:02:00.000Z',
      }),
    });

    render(<App />);

    expect(await screen.findByText('会话已中断 · 可重新启动')).toBeInTheDocument();
    expect(screen.getByLabelText('终端输出')).toHaveAttribute('data-read-only', 'true');

    fireEvent.click(screen.getByRole('button', { name: '重新启动' }));
    await waitFor(() => {
      expect(api.restartSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'lite',
      });
    });
    expect(api.launchSession).not.toHaveBeenCalled();
  });

  it('restarts an exited session in the same tab from the action bar', async () => {
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          claudeLaunchMode: 'lite',
          status: 'exited',
          startedAt: '2026-07-02T00:00:00.000Z',
          exitCode: 1,
        },
      ]),
      restartSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        status: 'running',
        startedAt: '2026-07-02T00:02:00.000Z',
      }),
      killTerminal: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        status: 'stopped',
        startedAt: '2026-07-02T00:00:00.000Z',
      }),
    });

    render(<App />);

    expect(await screen.findByText('异常退出 · exit code 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新启动' }));
    await waitFor(() => {
      expect(api.restartSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'lite',
      });
    });
    expect(api.launchSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText('终端输出')).toHaveAttribute('data-session-id', 'session-1');
  });

  it('shows immediate feedback while restarting an exited session from the action bar', async () => {
    let resolveRestart: ((session: AgentSession) => void) | undefined;
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          claudeLaunchMode: 'lite',
          status: 'exited',
          startedAt: '2026-07-02T00:00:00.000Z',
          exitCode: 0,
        },
      ]),
      restartSession: vi.fn().mockImplementation(
        () =>
          new Promise<AgentSession>((resolve) => {
            resolveRestart = resolve;
          }),
      ),
    });

    render(<App />);

    expect(await screen.findByText('会话已退出 · exit code 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新启动' }));

    expect(await screen.findByText('正在重新启动会话...')).toBeInTheDocument();

    act(() => {
      resolveRestart?.({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'lite',
        status: 'running',
        startedAt: '2026-07-02T00:02:00.000Z',
      });
    });

    await waitFor(() => {
      expect(api.restartSession).toHaveBeenCalled();
    });
  });

  it('shows one-sentence memory restore summary after restarting a session', async () => {
    let resolveRestart: ((session: AgentSession) => void) | undefined;
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          claudeLaunchMode: 'lite',
          status: 'interrupted',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      restartSession: vi.fn().mockImplementation(
        () =>
          new Promise<AgentSession>((resolve) => {
            resolveRestart = resolve;
          }),
      ),
    });

    render(<App />);

    expect(await screen.findByText('会话已中断 · 可重新启动')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新启动' }));

    expect(await screen.findByText('正在恢复记忆')).toBeInTheDocument();

    act(() => {
      resolveRestart?.({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'lite',
        status: 'running',
        startedAt: '2026-07-02T00:02:00.000Z',
        memoryRestore: {
          status: 'loaded',
          summary: '记忆已恢复：上次会话确认采用分层记忆恢复。',
          contextFile: '/tmp/workspace/.agentdock/context/restores/session-1.md',
        },
      });
    });

    expect(await screen.findByText('记忆已恢复：上次会话确认采用分层记忆恢复。')).toBeInTheDocument();
    expect(screen.queryByText('/tmp/workspace/.agentdock/context/restores/session-1.md')).not.toBeInTheDocument();
    expect(api.restartSession).toHaveBeenCalled();
  });

  it('sanitizes memory restore summary before showing it in the page status bar', async () => {
    installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'interrupted',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      restartSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'running',
        startedAt: '2026-07-02T00:02:00.000Z',
        memoryRestore: {
          status: 'loaded',
          summary: '\u001b[32m记忆已恢复：已加载最近会话背景。\u001b[0m\r\nWorking(9s • esc to interrupt)',
          contextFile: '/tmp/workspace/.agentdock/context/restores/session-1.md',
        },
      }),
    });

    render(<App />);

    expect(await screen.findByText('会话已中断 · 可重新启动')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新启动' }));

    expect(await screen.findByText('记忆已恢复：已加载最近会话背景。')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\u001b');
    expect(document.body).not.toHaveTextContent('Working(9s');
  });

  it('shows empty memory restore state without exposing restore prompt text', async () => {
    installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'interrupted',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      restartSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'running',
        startedAt: '2026-07-02T00:02:00.000Z',
        memoryRestore: {
          status: 'empty',
          summary: '未找到可恢复记忆',
        },
      }),
    });

    render(<App />);

    expect(await screen.findByText('会话已中断 · 可重新启动')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新启动' }));

    expect(await screen.findByText('未找到可恢复记忆')).toBeInTheDocument();
    expect(screen.queryByText(/Read the AgentDock restore context file/)).not.toBeInTheDocument();
  });

  it('closes an exited session from the action bar', async () => {
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          status: 'exited',
          startedAt: '2026-07-02T00:00:00.000Z',
          exitCode: 0,
        },
      ]),
      closeSessionView: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        status: 'exited',
        closedViewIds: ['main-window'],
        startedAt: '2026-07-02T00:00:00.000Z',
      }),
    });

    render(<App />);

    expect(await screen.findByText('会话已退出 · exit code 0')).toBeInTheDocument();
    const exitStatus = screen.getByRole('status', { name: '会话退出状态' });
    fireEvent.click(within(exitStatus).getByRole('button', { name: '关闭视图' }));
    await waitFor(() => {
      expect(api.closeSessionView).toHaveBeenCalledWith({ sessionId: 'session-1', viewId: 'main-window' });
    });
    expect(screen.getByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
  });

  it('shows a success message after copying exited session output', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          status: 'exited',
          startedAt: '2026-07-02T00:00:00.000Z',
          exitCode: 0,
        },
      ]),
      readTerminalBuffer: vi.fn().mockResolvedValue('terminal history'),
    });

    render(<App />);

    expect(await screen.findByText('会话已退出 · exit code 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制输出' }));

    await waitFor(() => {
      expect(api.readTerminalBuffer).toHaveBeenCalledWith({ sessionId: 'session-1' });
      expect(writeText).toHaveBeenCalledWith('terminal history');
    });
    expect(screen.getByText('输出已复制')).toBeInTheDocument();
  });

  it('does not show the local 5MB replay storage warning or archive actions', async () => {
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          status: 'running',
          startedAt: '2026-07-02T00:00:00.000Z',
          historyLimitReached: true,
        },
      ]),
    });

    render(<App />);

    await screen.findByLabelText('终端输出');
    expect(screen.queryByText('终端回放保存已达 5MB')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '存档历史' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新开会话' })).not.toBeInTheDocument();
    expect(api.archiveSessionHistory).not.toHaveBeenCalled();
  });

  it('labels local continuation-material pressure without claiming the model context is full', async () => {
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          status: 'running',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      getSessionContextPressure: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        level: 'full',
        score: 100,
      }),
      summarizeSession: vi.fn().mockResolvedValue({
        status: 'success',
        summaryFile: '/Users/example/Desktop/web/AgentDock/.agentdock/context/summaries/session-1.md',
        handoffFile: '/Users/example/Desktop/web/AgentDock/.agentdock/context/handoffs/session-1.md',
        handoffPrompt: 'Read the AgentDock handoff first',
      }),
    });

    render(<App />);

    expect(await screen.findByText(/续接材料已达上限/)).toBeInTheDocument();
    expect(screen.queryByText(/上下文已满/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '总结当前会话' }));

    await waitFor(() => {
      expect(api.summarizeSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
        continueAfterSummary: false,
      });
    });
    expect(await screen.findByText(/摘要已生成/)).toBeInTheDocument();
  });

  it('starts a continuation session after summarize-and-continue succeeds', async () => {
    const continuationSession: AgentSession = {
      id: 'session-2',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude --dangerously-skip-permissions',
      status: 'running',
      startedAt: '2026-07-02T00:01:00.000Z',
    };
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          status: 'running',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      getSessionContextPressure: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        level: 'high',
        score: 90,
      }),
      summarizeSession: vi.fn().mockResolvedValue({
        status: 'success',
        summaryFile: '/tmp/summary.md',
        handoffFile: '/tmp/handoff.md',
        handoffPrompt: 'Read the AgentDock handoff first',
        continuationSession,
      }),
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '总结并续开' }));

    await waitFor(() => {
      expect(api.summarizeSession).toHaveBeenCalledWith({
        sessionId: 'session-1',
        continueAfterSummary: true,
      });
      expect(screen.getByLabelText('终端输出')).toHaveAttribute('data-session-id', 'session-2');
    });
  });

  it('shows a safe error when session summary fails', async () => {
    installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          status: 'running',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      getSessionContextPressure: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        level: 'high',
        score: 90,
      }),
      summarizeSession: vi.fn().mockRejectedValue(new Error('summary failed; secret=hidden')),
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '总结当前会话' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('summary failed');
  });

  it('does not show summary actions for local shell sessions', async () => {
    installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'zsh · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'zsh',
          status: 'running',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      getSessionContextPressure: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        level: 'high',
        score: 90,
      }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^zsh · AgentDock$/ })).toBeInTheDocument();
    await expect(
      screen.findByRole('button', { name: '总结当前会话' }, { timeout: 200 }),
    ).rejects.toThrow();
    expect(screen.queryByRole('button', { name: '总结并续开' })).not.toBeInTheDocument();
  });

  it('does not show summary actions for non Claude/Codex agent sessions', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'gemini-a',
          name: 'Gemini A',
          toolType: 'gemini',
          baseUrl: 'https://gemini.example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'gemini-a',
        },
      ]),
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Gemini A · AgentDock',
          profileId: 'gemini-a',
          workspaceId: 'workspace-a',
          command: 'gemini',
          status: 'running',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      getSessionContextPressure: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        level: 'high',
        score: 90,
      }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^Gemini A · AgentDock$/ })).toBeInTheDocument();
    await expect(
      screen.findByRole('button', { name: '总结当前会话' }, { timeout: 200 }),
    ).rejects.toThrow();
    expect(screen.queryByRole('button', { name: '总结并续开' })).not.toBeInTheDocument();
  });

  it('launches with the profile workspace and auto command selected in command controls', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
        },
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://codex.example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
          codexHome: '~/.agentdock/codex-profiles/codex-b',
        },
      ]),
      listWorkspaces: vi.fn().mockResolvedValue([
        { id: 'workspace-a', name: 'AgentDock', path: '/Users/example/AgentDock' },
        { id: 'workspace-b', name: 'Docs', path: '/Users/example/Docs' },
      ]),
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText('选择 API 配置'), { target: { value: 'codex-b' } });
    fireEvent.change(screen.getByLabelText('选择工作区'), { target: { value: 'workspace-b' } });
    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'codex-b',
        workspaceId: 'workspace-b',
        command:
          'codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust',
      });
    });
  });

  it('derives the agent command from the selected API profile without exposing a command dropdown', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
        },
        {
          id: 'gemini-a',
          name: 'Gemini A',
          toolType: 'gemini',
          baseUrl: 'https://gemini.example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'gemini-a',
        },
      ]),
    });

    render(<App />);

    fireEvent.change(await screen.findByLabelText('选择 API 配置'), { target: { value: 'gemini-a' } });

    expect(screen.queryByLabelText('选择启动命令')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'gemini-a',
        workspaceId: 'workspace-a',
        command: 'gemini',
      });
    });
  });

  it('chooses a workspace path once, saves it in the dropdown, and launches with it', async () => {
    const pickedWorkspace: Workspace = {
      id: 'workspace-docs',
      name: 'Docs',
      path: '/Users/example/Docs',
    };
    const api = installAgentDockApi({
      chooseWorkspace: vi.fn().mockResolvedValue(pickedWorkspace),
    });

    render(<App />);

    const workspaceSelect = await screen.findByLabelText('选择工作区');
    const chooseOption = [...workspaceSelect.querySelectorAll('option')].find(
      (option) => option.textContent === '选择其他文件夹…',
    );
    expect(chooseOption).toBeDefined();
    expect(screen.queryByRole('button', { name: '选择工作区路径' })).not.toBeInTheDocument();

    fireEvent.change(workspaceSelect, { target: { value: chooseOption?.value } });

    await waitFor(() => {
      expect(api.chooseWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByLabelText('选择工作区')).toHaveValue('workspace-docs');
    expect(screen.getByLabelText('选择工作区')).toHaveTextContent('Docs');

    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'profile-a',
        workspaceId: 'workspace-docs',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'lite',
      });
    });
  });

  it('filters API config cards by tool type and selecting a card updates launch controls', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
        },
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://codex.example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    expect(await screen.findByRole('button', { name: /Claude A/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));

    expect(screen.queryByRole('button', { name: /Claude A/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));
    fireEvent.click(screen.getByRole('button', { name: '返回终端工作台' }));

    expect(screen.getByLabelText('选择 API 配置')).toHaveValue('codex-b');
  });



  it('edits and saves the selected API profile without exposing secret values', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://old.example.invalid',
          defaultModel: 'claude-old',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
      ]),
      saveProfile: vi.fn(async (profile: ApiProfile) => ({ ...profile, name: 'Claude Edited' })),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: 'Claude Edited' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://edited.example.invalid' } });
    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: 'claude-edited' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
        id: 'profile-a',
        name: 'Claude Edited',
        toolType: 'claude',
        baseUrl: 'https://edited.example.invalid',
        defaultModel: 'claude-edited',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      }));
    });

    expect(await screen.findByText('配置已保存')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回终端工作台' }));
    expect(screen.getByLabelText('选择 API 配置')).toHaveTextContent('Claude Edited');
    expect(document.body).not.toHaveTextContent('ANTHROPIC_AUTH_TOKEN');
    expect(document.body).not.toHaveTextContent('OPENAI_API_KEY');
  });

  it('edits and saves Claude model mapping fields', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://anyrouter.top',
          defaultModel: 'claude-opus-4-8',
          availableModels: [
            'claude-haiku-4-5-20251001',
            'claude-fable-5',
            'claude-opus-4-8',
          ],
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
          claudeDefaultLaunchMode: 'default',
        },
      ]),
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));

    expect(screen.getByText('模型映射')).toBeInTheDocument();

    const expectedModelOptions = [
      'claude-opus-4-8',
      'claude-haiku-4-5-20251001',
      'claude-fable-5',
    ];
    const haikuModelSelect = screen.getByLabelText('Haiku 默认模型') as HTMLSelectElement;
    const sonnetModelSelect = screen.getByLabelText('Sonnet 默认模型') as HTMLSelectElement;
    const opusModelSelect = screen.getByLabelText('Opus 默认模型') as HTMLSelectElement;

    expect(haikuModelSelect.tagName).toBe('SELECT');
    expect(sonnetModelSelect.tagName).toBe('SELECT');
    expect(opusModelSelect.tagName).toBe('SELECT');
    expect(Array.from(haikuModelSelect.options).map((option) => option.value)).toEqual(
      expectedModelOptions,
    );
    expect(Array.from(sonnetModelSelect.options).map((option) => option.value)).toEqual(
      expectedModelOptions,
    );
    expect(Array.from(opusModelSelect.options).map((option) => option.value)).toEqual(
      expectedModelOptions,
    );

    fireEvent.change(screen.getByLabelText('主模型'), {
      target: { value: 'claude-opus-4-8' },
    });
    fireEvent.change(screen.getByLabelText('Haiku 默认模型'), {
      target: { value: 'claude-haiku-4-5-20251001' },
    });
    fireEvent.change(screen.getByLabelText('Sonnet 默认模型'), {
      target: { value: 'claude-fable-5' },
    });
    fireEvent.change(screen.getByLabelText('Opus 默认模型'), {
      target: { value: 'claude-opus-4-8' },
    });
    fireEvent.change(screen.getByLabelText('默认启动选项'), {
      target: { value: 'opus' },
    });

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'claude-a',
          defaultModel: 'claude-opus-4-8',
          claudeHaikuModel: 'claude-haiku-4-5-20251001',
          claudeSonnetModel: 'claude-fable-5',
          claudeOpusModel: 'claude-opus-4-8',
          claudeDefaultLaunchMode: 'opus',
        }),
      );
    });
  });

  it('does not show Claude model mapping fields for Codex profiles', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://anyrouter.top/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));

    expect(screen.queryByText('模型映射')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Haiku 默认模型')).not.toBeInTheDocument();
  });

  it('hides advanced API config internals by default and reveals them as read-only fields', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://old.example.invalid',
          defaultModel: 'claude-old',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));

    expect(screen.getByLabelText('接口名称')).toBeInTheDocument();
    expect(screen.queryByLabelText('配置 ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Keychain Service')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Keychain Account')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Codex Home')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    expect(screen.getByLabelText('配置 ID')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Keychain Service')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Keychain Account')).toHaveAttribute('readonly');
    expect(screen.queryByLabelText('Codex Home')).not.toBeInTheDocument();
  });

  it('shows Codex Home only inside advanced settings for Codex profiles and keeps it read-only', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://codex.example.invalid/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
          codexHome: '~/.agentdock/codex-profiles/codex-b',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));

    expect(screen.queryByLabelText('Codex Home')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    expect(screen.getByLabelText('Codex Home')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Codex Home')).toHaveValue(
      '~/.agentdock/codex-profiles/codex-b',
    );
  });



  it('writes a replacement API key to local encrypted storage without rendering the secret after save', async () => {
    const secret = 'test-agentdock-secret-for-local-vault-only';
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://anyrouter.top/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-openai',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));
    expect(screen.getByText('填写后本机加密保存；留空则保留当前 Key。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('API Key（本机加密保存）'), { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfileSecret).toHaveBeenCalledWith({
        keychainService: 'AgentDock',
        keychainAccount: 'codex-openai',
        secret,
      });
    });
    expect(await screen.findByText('API Key 已本机加密保存')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key（本机加密保存）')).toHaveValue('');
    expect(document.body).not.toHaveTextContent(secret);
  });



  it('shows an eye toggle and reveals the saved API key in the same input field', async () => {
    const secret = 'test-agentdock-eye-toggle-secret';
    installAgentDockApi({
      readProfileSecret: vi.fn().mockResolvedValue(secret),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));

    const secretInput = screen.getByLabelText('API Key（本机加密保存）');
    const toggle = screen.getByRole('button', { name: '显示 API Key' });
    expect(secretInput).toHaveAttribute('type', 'password');
    expect(secretInput).toHaveValue('');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(secretInput).toHaveValue(secret);
    });
    expect(secretInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: '隐藏 API Key' })).toBeInTheDocument();
  });

  it('shows a recoverable API key read error without a remote-method stack message', async () => {
    installAgentDockApi({
      readProfileSecret: vi.fn().mockRejectedValue(
        new Error('无法读取已保存的 API Key，请重新粘贴并保存一次以修复本机加密记录。'),
      ),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示 API Key' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法读取已保存的 API Key，请重新粘贴并保存一次以修复本机加密记录。');
    expect(alert).not.toHaveTextContent('Error invoking remote method');
    expect(screen.getByLabelText('API Key（本机加密保存）')).toHaveValue('');
  });

  it('reveals a saved API key only after an explicit show action and can hide it again', async () => {
    const secret = 'test-agentdock-explicit-display-only';
    const api = installAgentDockApi({
      readProfileSecret: vi.fn().mockResolvedValue(secret),
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://old.example.invalid',
          defaultModel: 'claude-old',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));

    const secretInput = screen.getByLabelText('API Key（本机加密保存）');
    expect(api.readProfileSecret).not.toHaveBeenCalled();
    expect(secretInput).toHaveAttribute('type', 'password');
    expect(secretInput).toHaveValue('');
    expect(document.body).not.toHaveTextContent(secret);

    fireEvent.click(screen.getByRole('button', { name: '显示 API Key' }));

    await waitFor(() => {
      expect(api.readProfileSecret).toHaveBeenCalledWith({
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      });
    });
    expect(secretInput).toHaveAttribute('type', 'text');
    expect(secretInput).toHaveValue(secret);

    fireEvent.click(screen.getByRole('button', { name: '隐藏 API Key' }));

    expect(secretInput).toHaveAttribute('type', 'password');
    expect(secretInput).toHaveValue(secret);
  });





  it('keeps common models empty until users choose them from fetched models', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://codex.example.invalid/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
        },
      ]),
      fetchProfileModels: vi.fn().mockResolvedValue(['gpt-5-codex', 'gpt-4o', 'o3']),
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));

    expect(screen.queryByRole('group', { name: '拉取到的模型' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('常用模型列表')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gpt-5.5/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

    await waitFor(() => {
      expect(api.fetchProfileModels).toHaveBeenCalledWith({ profileId: 'codex-b' });
    });
    expect(screen.getByRole('group', { name: '拉取到的模型' })).toHaveTextContent('gpt-4o');

    fireEvent.click(screen.getByRole('checkbox', { name: 'gpt-4o' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'o3' }));
    expect(screen.getByLabelText('常用模型列表')).toHaveTextContent('gpt-4o');
    expect(screen.getByLabelText('常用模型列表')).toHaveTextContent('o3');

    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: 'gpt-4o' } });

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith({
        id: 'codex-b',
        name: 'Codex B',
        toolType: 'codex',
        baseUrl: 'https://codex.example.invalid/v1',
        defaultModel: 'gpt-4o',
        keychainService: 'AgentDock',
        keychainAccount: 'codex-b',
        availableModels: ['gpt-4o', 'o3'],
      });
    });
  });

  it('lets users remove fetched models from their common model choices', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://codex.example.invalid/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
          availableModels: ['gpt-4o'],
        },
      ]),
      fetchProfileModels: vi.fn().mockResolvedValue(['gpt-5-codex', 'gpt-4o', 'o3']),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));

    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

    expect(await screen.findByRole('checkbox', { name: 'gpt-4o' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'gpt-4o' }));

    expect(screen.queryByLabelText('常用模型列表')).not.toBeInTheDocument();
    expect(screen.getByLabelText('默认模型')).toHaveValue('gpt-5-codex');
  });

  it('shows a recoverable message when model fetch hits an unreadable local API key record', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://anyrouter.top/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-custom-1',
        },
      ]),
      fetchProfileModels: vi.fn().mockRejectedValue(
        new Error(
          `Error invoking remote method 'profiles:fetchModels': Error: Unable to decrypt local API key vault entry for account "codex-custom-1"`,
        ),
      ),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));
    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法读取已保存的 API Key，请重新粘贴并保存一次以修复本机加密记录。');
    expect(alert).not.toHaveTextContent('Error invoking remote method');
    expect(alert).not.toHaveTextContent('Unable to decrypt local API key vault entry');
  });

  it('fetches model IDs for the selected profile and saves the selected default model list', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://anyrouter.top/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-openai',
          availableModels: ['gpt-5-codex'],
        },
      ]),
      fetchProfileModels: vi.fn().mockResolvedValue(['gpt-5-codex', 'gpt-4o']),
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));

    fireEvent.click(screen.getByRole('button', { name: '拉取模型' }));

    await waitFor(() => {
      expect(api.fetchProfileModels).toHaveBeenCalledWith({ profileId: 'codex-b' });
    });
    expect(screen.getByText('已拉取 2 个模型')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'gpt-4o' }));
    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: 'gpt-4o' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith({
        id: 'codex-b',
        name: 'Codex B',
        toolType: 'codex',
        baseUrl: 'https://anyrouter.top/v1',
        defaultModel: 'gpt-4o',
        keychainService: 'AgentDock',
        keychainAccount: 'codex-openai',
        availableModels: ['gpt-5-codex', 'gpt-4o'],
      });
    });
  });

  it('lets users manually add and remove model IDs from an API profile', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          defaultModel: 'claude-3-5-haiku-20241022',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
          availableModels: ['claude-3-5-haiku-20241022', 'claude-3-7-sonnet-20250219'],
        },
      ]),
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));

    fireEvent.change(screen.getByLabelText('自定义模型 ID'), {
      target: { value: 'claude-opus-4-20250514' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    fireEvent.change(screen.getByLabelText('默认模型'), {
      target: { value: 'claude-opus-4-20250514' },
    });
    fireEvent.click(screen.getByRole('button', { name: '删除模型 claude-3-7-sonnet-20250219' }));
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
        id: 'claude-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://claude.example.invalid/v1',
        defaultModel: 'claude-opus-4-20250514',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-a',
        availableModels: ['claude-3-5-haiku-20241022', 'claude-opus-4-20250514'],
      }));
    });
  });

  it('creates an additional API profile with its own endpoint and secret slot', async () => {
    const secret = 'test-second-provider-secret';
    const api = installAgentDockApi({
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    expect(await screen.findByRole('button', { name: /Claude A/ })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '新增配置' }));
    fireEvent.change(screen.getByLabelText('接口名称'), { target: { value: 'Claude Provider B' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://provider-b.example.invalid' } });
    fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: 'claude-provider-b' } });
    fireEvent.change(screen.getByLabelText('API Key（本机加密保存）'), { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
        id: 'claude-custom-1',
        name: 'Claude Provider B',
        toolType: 'claude',
        baseUrl: 'https://provider-b.example.invalid',
        defaultModel: 'claude-provider-b',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-custom-1',
      }));
    });
    expect(api.saveProfileSecret).toHaveBeenCalledWith({
      keychainService: 'AgentDock',
      keychainAccount: 'claude-custom-1',
      secret,
    });
    expect(await screen.findByRole('button', { name: /Claude Provider B/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回终端工作台' }));
    expect(screen.getByLabelText('选择 API 配置')).toHaveValue('claude-custom-1');
    expect(document.body).not.toHaveTextContent(secret);
  });

  it('can close a running session view through IPC while keeping the record in the library', async () => {
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude',
          status: 'running',
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]),
      closeSessionView: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'running',
        closedViewIds: ['main-window'],
        startedAt: '2026-07-02T00:00:00.000Z',
      }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Claude A · AgentDock 更多操作'));
    fireEvent.click(screen.getByRole('button', { name: '关闭视图' }));

    await waitFor(() => {
      expect(api.closeSessionView).toHaveBeenCalledWith({ sessionId: 'session-1', viewId: 'main-window' });
    });
    expect(screen.getByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    expect(screen.getByLabelText('终端输出')).toHaveAttribute('data-session-id', '');
  });

  it('does not reopen a terminal view from session change events after the user closes the view', async () => {
    let sessionChangedListener: ((session: AgentSession) => void) | undefined;
    const closedSession: AgentSession = {
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-02T00:00:00.000Z',
    };
    const api = installAgentDockApi({
      listSessions: vi.fn().mockResolvedValue([closedSession]),
      closeSessionView: vi.fn().mockResolvedValue({
        ...closedSession,
        closedViewIds: ['main-window'],
      }),
      onSessionChanged: vi.fn((listener: (session: AgentSession) => void) => {
        sessionChangedListener = listener;
        return () => undefined;
      }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Claude A · AgentDock 更多操作'));
    fireEvent.click(screen.getByRole('button', { name: '关闭视图' }));

    await waitFor(() => {
      expect(api.closeSessionView).toHaveBeenCalledWith({ sessionId: 'session-1', viewId: 'main-window' });
    });
    await act(async () => {
      sessionChangedListener?.(closedSession);
    });

    expect(screen.getByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    expect(screen.getByLabelText('终端输出')).toHaveAttribute('data-session-id', '');
  });

  it('can delete a profile after confirmation', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
        {
          id: 'profile-b',
          name: 'Claude B',
          toolType: 'claude',
          baseUrl: 'https://example.invalid/v2',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-b',
        },
      ]),
      deleteProfile: vi.fn().mockResolvedValue(undefined),
    });
    global.confirm = vi.fn().mockReturnValue(true);

    render(<App />);
    await openApiConfigPage();

    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    expect(screen.getByRole('button', { name: '删除配置' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除配置' }));

    await waitFor(() => {
      expect(global.confirm).toHaveBeenCalledWith(
        expect.stringContaining('确定要删除配置 "Claude A" 吗'),
      );
      expect(api.deleteProfile).toHaveBeenCalledWith('profile-a');
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Claude A/ })).not.toBeInTheDocument();
    });
    expect(screen.getByText('请选择一个配置后编辑。')).toBeInTheDocument();
  });

  it('does not delete a profile if user cancels confirmation', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'profile-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://example.invalid/v1',
          keychainService: 'AgentDock',
          keychainAccount: 'profile-a',
        },
      ]),
      deleteProfile: vi.fn().mockResolvedValue(undefined),
    });
    global.confirm = vi.fn().mockReturnValue(false);

    render(<App />);
    await openApiConfigPage();

    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除配置' }));

    await waitFor(() => {
      expect(global.confirm).toHaveBeenCalled();
      expect(api.deleteProfile).not.toHaveBeenCalled();
    });

    expect(screen.getByRole('button', { name: /Claude A/ })).toBeInTheDocument();
  });

  it('keeps dangerous permission controls enabled by default', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          defaultModel: 'claude-3-5-haiku-20241022',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
        },
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://codex.example.invalid/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
          codexHome: '~/.agentdock/codex-profiles/codex-b',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const claudeCheckbox = screen
      .getByText('启动时跳过权限检查')
      .closest('label')
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(claudeCheckbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const codexCheckbox = screen
      .getByText('启动时跳过批准和沙箱')
      .closest('label')
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(codexCheckbox).toBeChecked();
  });

  it('shows permission control for Claude profiles and includes flag when enabled', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          defaultModel: 'claude-3-5-haiku-20241022',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
          skipPermissions: true,
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    expect(screen.getByText('启动时跳过权限检查')).toBeInTheDocument();
    const checkbox = screen.getByText('启动时跳过权限检查').closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeChecked();

    fireEvent.click(await screen.findByRole('button', { name: '返回终端工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'claude-a',
        workspaceId: 'workspace-a',
        command: 'claude --dangerously-skip-permissions',
        claudeLaunchMode: 'lite',
      });
    });
  });

  it('shows Claude Code retry controls as optional Claude profile settings', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          defaultModel: 'claude-3-5-haiku-20241022',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
        },
      ]),
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const watchdogCheckbox = screen
      .getByText('启用 Claude Code Retry Watchdog')
      .closest('label')
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const maxRetriesInput = screen.getByLabelText('Claude Code 最大重试次数');
    const betasInput = screen.getByLabelText('ANTHROPIC_BETAS');
    const httpsProxyInput = screen.getByLabelText('HTTPS_PROXY');
    const httpProxyInput = screen.getByLabelText('HTTP_PROXY');
    const disableTrafficCheckbox = screen
      .getByText('禁用非必要流量')
      .closest('label')
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const attributionHeaderInput = screen.getByLabelText('CLAUDE_CODE_ATTRIBUTION_HEADER');
    const disableInstallChecksCheckbox = screen
      .getByText('禁用安装检查')
      .closest('label')
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const cleanupDaysInput = screen.getByLabelText('Claude 配置清理保留天数');

    expect(watchdogCheckbox).not.toBeChecked();
    expect(maxRetriesInput).toHaveValue(null);
    expect(betasInput).toHaveValue('');
    expect(httpsProxyInput).toHaveValue('');
    expect(httpProxyInput).toHaveValue('');
    expect(disableTrafficCheckbox).not.toBeChecked();
    expect(attributionHeaderInput).toHaveValue('');
    expect(disableInstallChecksCheckbox).not.toBeChecked();
    expect(cleanupDaysInput).toHaveValue(null);

    fireEvent.click(watchdogCheckbox);
    fireEvent.change(maxRetriesInput, { target: { value: '100' } });
    fireEvent.change(betasInput, { target: { value: 'context-1m-2025-08-07' } });
    fireEvent.change(httpsProxyInput, { target: { value: 'http://127.0.0.1:7890' } });
    fireEvent.change(httpProxyInput, { target: { value: 'http://127.0.0.1:7890' } });
    fireEvent.click(disableTrafficCheckbox);
    fireEvent.change(attributionHeaderInput, { target: { value: '0' } });
    fireEvent.click(disableInstallChecksCheckbox);
    fireEvent.change(cleanupDaysInput, { target: { value: '720' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
        id: 'claude-a',
        claudeCodeRetryWatchdog: true,
        claudeCodeMaxRetries: 100,
        anthropicBetas: 'context-1m-2025-08-07',
        httpsProxy: 'http://127.0.0.1:7890',
        httpProxy: 'http://127.0.0.1:7890',
        claudeCodeDisableNonessentialTraffic: true,
        claudeCodeAttributionHeader: '0',
        disableInstallationChecks: true,
        claudeCleanupPeriodDays: 720,
      }));
    });
  });

  it('groups Claude advanced settings into launch, network, and local sections', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          defaultModel: 'claude-3-5-haiku-20241022',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const launchSection = screen.getByRole('group', { name: '启动参数' });
    const networkSection = screen.getByRole('group', { name: '网络与请求' });
    const localSection = screen.getByRole('group', { name: '本地配置' });

    expect(within(launchSection).getByText('启动时跳过权限检查')).toBeInTheDocument();
    expect(within(launchSection).getByText('启用 Claude Code Retry Watchdog')).toBeInTheDocument();
    expect(within(launchSection).getByLabelText('Claude Code 最大重试次数')).toBeInTheDocument();
    expect(within(networkSection).getByLabelText('ANTHROPIC_BETAS')).toBeInTheDocument();
    expect(within(networkSection).getByLabelText('HTTPS_PROXY')).toBeInTheDocument();
    expect(within(networkSection).getByLabelText('HTTP_PROXY')).toBeInTheDocument();
    expect(within(networkSection).getByText('禁用非必要流量')).toBeInTheDocument();
    expect(within(networkSection).getByLabelText('CLAUDE_CODE_ATTRIBUTION_HEADER')).toBeInTheDocument();
    expect(within(networkSection).getByText('禁用安装检查')).toBeInTheDocument();
    expect(within(localSection).getByLabelText('Claude 配置清理保留天数')).toBeInTheDocument();
    expect(within(localSection).getByText('配置 ID')).toBeInTheDocument();
    expect(within(localSection).getByText('Keychain Account')).toBeInTheDocument();
  });

  it('excludes permission flag for Claude when skipPermissions is disabled', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          defaultModel: 'claude-3-5-haiku-20241022',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
          skipPermissions: false,
        },
      ]),
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const checkbox = screen.getByText('启动时跳过权限检查').closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeChecked();

    fireEvent.click(await screen.findByRole('button', { name: '返回终端工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'claude-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        claudeLaunchMode: 'lite',
      });
    });
  });

  it('shows permission control for Codex profiles and includes flag when enabled', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://codex.example.invalid/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
          codexHome: '~/.agentdock/codex-profiles/codex-b',
          bypassApprovals: true,
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    expect(screen.getByText('启动时跳过批准和沙箱')).toBeInTheDocument();
    const checkbox = screen.getByText('启动时跳过批准和沙箱').closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeChecked();
  });

  it('excludes approval bypass flag for Codex when bypassApprovals is disabled', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'codex-b',
          name: 'Codex B',
          toolType: 'codex',
          baseUrl: 'https://codex.example.invalid/v1',
          defaultModel: 'gpt-5-codex',
          keychainService: 'AgentDock',
          keychainAccount: 'codex-b',
          codexHome: '~/.agentdock/codex-profiles/codex-b',
          bypassApprovals: false,
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Codex B/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const checkbox = screen.getByText('启动时跳过批准和沙箱').closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
  });

  it('toggles permission settings in the UI and persists them on save', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          defaultModel: 'claude-3-5-haiku-20241022',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
          skipPermissions: true,
        },
      ]),
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const checkbox = screen.getByText('启动时跳过权限检查').closest('label')?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
        id: 'claude-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://claude.example.invalid/v1',
        defaultModel: 'claude-3-5-haiku-20241022',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-a',
        skipPermissions: false,
      }));
    });
  });

  it('toggles the CCometixLine statusline setting for Claude profiles and persists it on save', async () => {
    const api = installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'claude-a',
          name: 'Claude A',
          toolType: 'claude',
          baseUrl: 'https://claude.example.invalid/v1',
          defaultModel: 'claude-3-5-haiku-20241022',
          keychainService: 'AgentDock',
          keychainAccount: 'claude-a',
          claudeCclineStatusLineEnabled: false,
        },
      ]),
      saveProfile: vi.fn(async (profile: ApiProfile) => profile),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const checkbox = screen
      .getByText('启用 CCometixLine 状态栏')
      .closest('label')
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
        id: 'claude-a',
        claudeCclineStatusLineEnabled: true,
      }));
    });
  });

  it('enables the CCometixLine statusline setting by default for new Claude profiles', async () => {
    render(<App />);

    await openApiConfigPage();
    fireEvent.click(screen.getByRole('button', { name: '新增配置' }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    const checkbox = screen
      .getByText('启用 CCometixLine 状态栏')
      .closest('label')
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement;

    expect(checkbox).toBeChecked();
  });

  it('does not show permission controls for non-Claude/Codex profiles', async () => {
    installAgentDockApi({
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: 'gemini-a',
          name: 'Gemini A',
          toolType: 'gemini',
          baseUrl: 'https://gemini.example.invalid/v1',
          defaultModel: 'gemini-pro',
          keychainService: 'AgentDock',
          keychainAccount: 'gemini-a',
        },
      ]),
    });

    render(<App />);

    await openApiConfigPage();
    fireEvent.click(await screen.findByRole('button', { name: /Gemini A/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示高级设置' }));

    expect(screen.queryByText(/启动时跳过权限检查/)).not.toBeInTheDocument();
    expect(screen.queryByText(/启动时跳过批准和沙箱/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Claude Code Retry Watchdog/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Claude Code 最大重试次数')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ANTHROPIC_BETAS')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('HTTPS_PROXY')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('HTTP_PROXY')).not.toBeInTheDocument();
  });

});
