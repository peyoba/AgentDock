import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../src/renderer/App';

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
