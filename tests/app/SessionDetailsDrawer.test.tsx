import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionDetailsDrawer } from '../../src/renderer/components/SessionDetailsDrawer';

const profile = {
  id: 'profile-a',
  name: 'Claude A',
  toolType: 'claude' as const,
  baseUrl: 'https://example.invalid/v1',
  keychainService: 'AgentDock',
  keychainAccount: 'profile-a',
};

const sessionA = {
  id: 'session-a',
  title: 'Claude A',
  profileId: profile.id,
  workspaceId: 'workspace-a',
  command: 'claude',
  status: 'running' as const,
  startedAt: '2026-07-10T00:00:00.000Z',
};

describe('SessionDetailsDrawer', () => {
  it('ignores stale workspace context after switching sessions', async () => {
    let resolveWorkspaceA: ((value: { filePath: string; content: string }) => void) | undefined;
    const workspaceAResult = new Promise<{ filePath: string; content: string }>((resolve) => {
      resolveWorkspaceA = resolve;
    });
    const readWorkspaceContext = vi.fn((workspaceId: string) =>
      workspaceId === 'workspace-a'
        ? workspaceAResult
        : Promise.resolve({ filePath: '/workspace-b/context.md', content: 'Workspace B context' }),
    );
    const rendered = render(
      <SessionDetailsDrawer
        open
        session={sessionA}
        profile={profile}
        workspace={{ id: 'workspace-a', name: 'Workspace A', path: '/workspace-a' }}
        onReadWorkspaceContext={readWorkspaceContext}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看共享上下文' }));
    rendered.rerender(
      <SessionDetailsDrawer
        open
        session={{ ...sessionA, id: 'session-b', workspaceId: 'workspace-b' }}
        profile={profile}
        workspace={{ id: 'workspace-b', name: 'Workspace B', path: '/workspace-b' }}
        onReadWorkspaceContext={readWorkspaceContext}
      />,
    );

    await act(async () => {
      resolveWorkspaceA?.({ filePath: '/workspace-a/context.md', content: 'Workspace A context' });
      await workspaceAResult;
    });

    expect(screen.queryByText('Workspace A context')).not.toBeInTheDocument();
    expect(screen.queryByText('/workspace-a/context.md')).not.toBeInTheDocument();
  });

  it('invalidates an in-flight context read when the drawer closes', async () => {
    let resolveContext: ((value: { filePath: string; content: string }) => void) | undefined;
    const contextResult = new Promise<{ filePath: string; content: string }>((resolve) => {
      resolveContext = resolve;
    });
    const rendered = render(
      <SessionDetailsDrawer
        open
        session={sessionA}
        profile={profile}
        workspace={{ id: 'workspace-a', name: 'Workspace A', path: '/workspace-a' }}
        onReadWorkspaceContext={() => contextResult}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看共享上下文' }));
    rendered.rerender(
      <SessionDetailsDrawer
        open={false}
        session={sessionA}
        profile={profile}
        workspace={{ id: 'workspace-a', name: 'Workspace A', path: '/workspace-a' }}
        onReadWorkspaceContext={() => contextResult}
      />,
    );
    await act(async () => {
      resolveContext?.({ filePath: '/workspace-a/context.md', content: 'Closed drawer context' });
      await contextResult;
    });
    rendered.rerender(
      <SessionDetailsDrawer
        open
        session={sessionA}
        profile={profile}
        workspace={{ id: 'workspace-a', name: 'Workspace A', path: '/workspace-a' }}
        onReadWorkspaceContext={() => contextResult}
      />,
    );

    expect(screen.queryByText('Closed drawer context')).not.toBeInTheDocument();
  });

  it('ignores an old folder-open error after switching workspaces', async () => {
    let rejectOpen: ((reason: Error) => void) | undefined;
    const openResult = new Promise<void>((_resolve, reject) => {
      rejectOpen = reject;
    });
    const rendered = render(
      <SessionDetailsDrawer
        open
        session={sessionA}
        profile={profile}
        workspace={{ id: 'workspace-a', name: 'Workspace A', path: '/workspace-a' }}
        onOpenWorkspaceContextFolder={() => openResult}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开上下文文件夹' }));
    rendered.rerender(
      <SessionDetailsDrawer
        open
        session={{ ...sessionA, id: 'session-b', workspaceId: 'workspace-b' }}
        profile={profile}
        workspace={{ id: 'workspace-b', name: 'Workspace B', path: '/workspace-b' }}
        onOpenWorkspaceContextFolder={() => Promise.resolve()}
      />,
    );
    await act(async () => {
      rejectOpen?.(new Error('Workspace A folder failed'));
      await openResult.catch(() => undefined);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
