import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';
import type { ApiProfile, Workspace } from '../../src/shared/agentdockTypes';
import type { AgentDockApi } from '../../src/shared/preloadTypes';

vi.mock('../../src/renderer/components/TerminalPane', () => ({
  TerminalPane: ({ sessionId }: { sessionId?: string }) => (
    <div aria-label="终端输出" data-session-id={sessionId ?? ''} />
  ),
}));

type TestAgentDockApi = AgentDockApi & {
  chooseWorkspace: ReturnType<typeof vi.fn<() => Promise<Workspace | undefined>>>;
  saveProfile: ReturnType<typeof vi.fn<[(profile: ApiProfile) => Promise<ApiProfile>]>>;
  deleteProfile: ReturnType<typeof vi.fn<[(profileId: string) => Promise<void>]>>;
  saveProfileSecret: ReturnType<typeof vi.fn<[(request: { keychainService: string; keychainAccount: string; secret: string }) => Promise<void>]>>;
  readProfileSecret: ReturnType<typeof vi.fn<[(request: { keychainService: string; keychainAccount: string }) => Promise<string>]>>;
  fetchProfileModels: ReturnType<typeof vi.fn<[(request: { profileId: string }) => Promise<string[]>]>>;
  openNewWindow: ReturnType<typeof vi.fn<() => Promise<void>>>;
  onMetadataChanged: ReturnType<typeof vi.fn<[(listener: () => void) => () => void]>>;
};

function installAgentDockApi(overrides: Partial<TestAgentDockApi> = {}) {
  const api: TestAgentDockApi = {
    version: '0.1.0',
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
    listSessions: vi.fn().mockResolvedValue([]),
    writeTerminal: vi.fn().mockResolvedValue(undefined),
    resizeTerminal: vi.fn().mockResolvedValue(undefined),
    killTerminal: vi.fn(),
    readTerminalBuffer: vi.fn().mockResolvedValue(''),
    onTerminalOutput: vi.fn(() => () => undefined),
    openNewWindow: vi.fn().mockResolvedValue(undefined),
    onMetadataChanged: vi.fn(() => () => undefined),
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
    expect(screen.getByRole('button', { name: 'Gemini' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument();
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
      });
    });
    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
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
        command: 'codex --dangerously-bypass-approvals-and-sandbox',
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

  it('can close a running session tab through IPC and removes it from the UI', async () => {
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
      killTerminal: vi.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Claude A · AgentDock',
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
        status: 'stopped',
        startedAt: '2026-07-02T00:00:00.000Z',
      }),
    });

    render(<App />);

    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭 Claude A · AgentDock' }));

    await waitFor(() => {
      expect(api.killTerminal).toHaveBeenCalledWith({ sessionId: 'session-1' });
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /^Claude A · AgentDock$/ })).not.toBeInTheDocument();
    });
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
      expect(screen.getByText('请选择一个配置后编辑。')).toBeInTheDocument();
    });
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
