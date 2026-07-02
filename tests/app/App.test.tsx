import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';
import type { AgentDockApi } from '../../src/shared/preloadTypes';

function installAgentDockApi(overrides: Partial<AgentDockApi> = {}) {
  const api: AgentDockApi = {
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
    onTerminalOutput: vi.fn(() => () => undefined),
    ...overrides,
  };
  window.agentDock = api;
  return api;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'agentDock');
});

describe('AgentDock shell', () => {
  it('renders terminal-first launch controls', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /新建会话/ })).toBeInTheDocument();
    expect(screen.getByLabelText('新建终端会话')).toBeInTheDocument();
    expect(screen.getByLabelText('运行中的会话')).toBeInTheDocument();
  });

  it('keeps current session details collapsed by default', () => {
    render(<App />);

    expect(screen.queryByText(/Keychain 位置/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /会话详情/ })).toBeInTheDocument();
  });

  it('groups API configs by tool type', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gemini' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
  });
});

describe('AgentDock session launch flow', () => {
  it('loads metadata and launches a real IPC session from the command bar', async () => {
    const api = installAgentDockApi();

    render(<App />);

    expect(await screen.findByText(/Claude A/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启动终端' }));

    await waitFor(() => {
      expect(api.launchSession).toHaveBeenCalledWith({
        profileId: 'profile-a',
        workspaceId: 'workspace-a',
        command: 'claude',
      });
    });
    expect(await screen.findByRole('button', { name: /Claude A · AgentDock/ })).toBeInTheDocument();
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
});
