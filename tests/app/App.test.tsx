import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';
import type { ApiProfile, Workspace } from '../../src/shared/agentdockTypes';
import type { AgentDockApi } from '../../src/shared/preloadTypes';

type TestAgentDockApi = AgentDockApi & {
  chooseWorkspace: ReturnType<typeof vi.fn<() => Promise<Workspace | undefined>>>;
  saveProfile: ReturnType<typeof vi.fn<[(profile: ApiProfile) => Promise<ApiProfile>]>>;
  saveProfileSecret: ReturnType<typeof vi.fn<[(request: { keychainService: string; keychainAccount: string; secret: string }) => Promise<void>]>>;
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
    saveProfileSecret: vi.fn().mockResolvedValue(undefined),
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
  it('renders terminal-first launch controls', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /新建会话/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quick Launch' })).toBeInTheDocument();
    expect(screen.getByText('选择接口、项目目录和命令，一次启动独立终端会话。')).toBeInTheDocument();
    expect(screen.getByLabelText('新建终端会话')).toBeInTheDocument();
    expect(screen.getByLabelText('运行中的会话')).toBeInTheDocument();
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
        command: 'claude',
      });
    });
    expect(await screen.findByRole('button', { name: /^Claude A · AgentDock$/ })).toBeInTheDocument();
  });



  it('can launch a local zsh terminal command for manual terminal verification', async () => {
    const api = installAgentDockApi();

    render(<App />);

    fireEvent.change(await screen.findByLabelText('选择启动命令'), { target: { value: 'zsh' } });
    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

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
        new Error(`Keychain secret was not found for account "profile-a"; ${secret}`),
      ),
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '启动终端' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Keychain secret was not found for account "profile-a"');
    expect(alert).not.toHaveTextContent(secret);
  });
  it('launches with the profile workspace and command selected in command controls', async () => {
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
    fireEvent.change(screen.getByLabelText('选择启动命令'), { target: { value: 'codex' } });
    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'codex-b',
        workspaceId: 'workspace-b',
        command: 'codex',
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

    fireEvent.click(await screen.findByRole('button', { name: '选择工作区路径' }));

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
        command: 'claude',
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
      expect(api.saveProfile).toHaveBeenCalledWith({
        id: 'profile-a',
        name: 'Claude Edited',
        toolType: 'claude',
        baseUrl: 'https://edited.example.invalid',
        defaultModel: 'claude-edited',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      });
    });

    expect(await screen.findByText('配置已保存')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回终端工作台' }));
    expect(screen.getByLabelText('选择 API 配置')).toHaveTextContent('Claude Edited');
    expect(document.body).not.toHaveTextContent('ANTHROPIC_AUTH_TOKEN');
    expect(document.body).not.toHaveTextContent('OPENAI_API_KEY');
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



  it('writes a replacement API key to Keychain without rendering the secret after save', async () => {
    const secret = 'test-agentdock-secret-for-keychain-only';
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
    expect(screen.getByText('填写后保存到 macOS 钥匙串；留空则保留当前 Key。')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('API Key（保存到 macOS 钥匙串）'), { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfileSecret).toHaveBeenCalledWith({
        keychainService: 'AgentDock',
        keychainAccount: 'codex-openai',
        secret,
      });
    });
    expect(await screen.findByText('API Key 已写入 Keychain')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key（保存到 macOS 钥匙串）')).toHaveValue('');
    expect(document.body).not.toHaveTextContent(secret);
  });

  it('creates an additional API profile with its own endpoint and Keychain account', async () => {
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
    fireEvent.change(screen.getByLabelText('API Key（保存到 macOS 钥匙串）'), { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(api.saveProfile).toHaveBeenCalledWith({
        id: 'claude-custom-1',
        name: 'Claude Provider B',
        toolType: 'claude',
        baseUrl: 'https://provider-b.example.invalid',
        defaultModel: 'claude-provider-b',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-custom-1',
      });
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

});
