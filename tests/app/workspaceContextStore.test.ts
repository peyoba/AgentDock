import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceContextStore } from '../../src/main/workspaceContextStore';
import type { AgentSession, Workspace } from '../../src/shared/agentdockTypes';

let tempDir: string;
let workspace: Workspace;
let session: AgentSession;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-context-'));
  workspace = {
    id: 'workspace-a',
    name: 'AgentDock',
    path: tempDir,
  };
  session = {
    id: 'session-1',
    title: 'Claude A · AgentDock',
    profileId: 'profile-a',
    workspaceId: 'workspace-a',
    command: 'claude --dangerously-skip-permissions',
    status: 'running',
    startedAt: '2026-07-04T00:00:00.000Z',
  };
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('workspaceContextStore', () => {
  it('creates shared context, index, and session transcript files for a started session', async () => {
    const store = createWorkspaceContextStore({
      clock: { now: () => new Date('2026-07-04T00:00:00.000Z') },
    });

    const files = await store.startSession({ workspace, session });

    expect(files).toEqual({
      contextDir: path.join(tempDir, '.agentdock/context'),
      sharedContextFile: path.join(tempDir, '.agentdock/context/shared-context.md'),
      sessionTranscriptFile: path.join(tempDir, '.agentdock/context/sessions/session-1.md'),
    });

    const index = JSON.parse(await readFile(path.join(tempDir, '.agentdock/context/index.json'), 'utf-8'));
    expect(index).toEqual({
      version: 1,
      workspaceId: 'workspace-a',
      workspaceName: 'AgentDock',
      updatedAt: '2026-07-04T00:00:00.000Z',
      sessions: [
        {
          sessionId: 'session-1',
          title: 'Claude A · AgentDock',
          profileId: 'profile-a',
          workspaceId: 'workspace-a',
          command: 'claude --dangerously-skip-permissions',
          startedAt: '2026-07-04T00:00:00.000Z',
          transcriptFile: '.agentdock/context/sessions/session-1.md',
        },
      ],
    });

    const transcript = await readFile(files.sessionTranscriptFile, 'utf-8');
    expect(transcript).toContain('# AgentDock Session Transcript');
    expect(transcript).toContain('Session: session-1');
    expect(transcript).toContain('Command: claude --dangerously-skip-permissions');

    const sharedContext = await readFile(files.sharedContextFile, 'utf-8');
    expect(sharedContext).toContain('# AgentDock Shared Context');
    expect(sharedContext).toContain('Workspace: AgentDock');
    expect(sharedContext).toContain('- session-1: Claude A · AgentDock (`.agentdock/context/sessions/session-1.md`)');
  });

  it('appends redacted PTY output into transcript and shared context', async () => {
    const store = createWorkspaceContextStore({
      clock: { now: () => new Date('2026-07-04T00:00:00.000Z') },
    });
    const files = await store.startSession({ workspace, session });

    await store.appendOutput({
      workspace,
      sessionId: 'session-1',
      data: 'agentdock-context-smoke local-development-secret sk-test-secret-value-that-is-long',
    });

    const transcript = await readFile(files.sessionTranscriptFile, 'utf-8');
    const sharedContext = await readFile(files.sharedContextFile, 'utf-8');

    expect(transcript).toContain('agentdock-context-smoke');
    expect(sharedContext).toContain('agentdock-context-smoke');
    expect(transcript).not.toContain('local-development-secret');
    expect(transcript).not.toContain('sk-test-secret-value-that-is-long');
    expect(sharedContext).not.toContain('local-development-secret');
    expect(sharedContext).not.toContain('sk-test-secret-value-that-is-long');
    expect(sharedContext).toContain('[REDACTED]');
  });

  it('adds .agentdock to git info exclude exactly once', async () => {
    await mkdir(path.join(tempDir, '.git/info'), { recursive: true });
    const excludePath = path.join(tempDir, '.git/info/exclude');
    await writeFile(excludePath, '# local excludes\n');
    const store = createWorkspaceContextStore();

    await store.ensureGitExcluded(workspace);
    await store.ensureGitExcluded(workspace);

    const exclude = await readFile(excludePath, 'utf-8');
    expect(exclude.split('\n').filter((line) => line === '.agentdock/')).toHaveLength(1);
  });

  it('does not throw when git info exclude is absent', async () => {
    const store = createWorkspaceContextStore();

    await expect(store.ensureGitExcluded(workspace)).resolves.toBeUndefined();
  });

  it('redacts key-like strings and secret environment assignment names', async () => {
    const store = createWorkspaceContextStore({
      clock: { now: () => new Date('2026-07-04T00:00:00.000Z') },
    });
    const files = await store.startSession({ workspace, session });

    await store.appendOutput({
      workspace,
      sessionId: 'session-1',
      data: [
        'local-development-secret',
        'sk-test-secret-value-that-is-long',
        'sk-ant-test-secret-value-that-is-long',
        'ANTHROPIC_AUTH_TOKEN=secret-token',
      ].join('\n'),
    });

    const transcript = await readFile(files.sessionTranscriptFile, 'utf-8');
    expect(transcript).not.toContain('local-development-secret');
    expect(transcript).not.toContain('sk-test-secret-value-that-is-long');
    expect(transcript).not.toContain('sk-ant-test-secret-value-that-is-long');
    expect(transcript).not.toContain('secret-token');
    expect(transcript).toContain('ANTHROPIC_AUTH_TOKEN=[REDACTED]');
  });
});
