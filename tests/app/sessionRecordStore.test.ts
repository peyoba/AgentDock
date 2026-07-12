import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';

async function readPosixMode(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

describe('session records', () => {
  it('keeps metadata and archives private while healing legacy permissions without content changes', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-session-permissions-'));
    const sessionsFilePath = path.join(rootDir, 'sessions.json');
    const archiveDirectoryPath = path.join(rootDir, 'session-archives');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T08:00:00.000Z'));

    try {
      await chmod(rootDir, 0o755);
      const store = createSessionHistoryStore(rootDir);
      await store.saveSession({
        id: 'session-permissions',
        title: 'Claude · Permission Contract',
        profileId: 'claude-test',
        workspaceId: 'workspace-test',
        command: 'claude',
        status: 'exited',
        startedAt: '2026-07-12T08:00:00.000Z',
      });
      await store.appendOutput('session-permissions', 'archived terminal output');
      const archive = await store.archiveBuffer('session-permissions');

      const newModes = {
        rootDirectory: await readPosixMode(rootDir),
        metadataFile: await readPosixMode(sessionsFilePath),
        archiveDirectory: await readPosixMode(archiveDirectoryPath),
        archiveFile: await readPosixMode(archive.filePath),
      };
      const metadataBeforeHealing = await readFile(sessionsFilePath, 'utf-8');
      const archiveBeforeHealing = await readFile(archive.filePath, 'utf-8');

      await chmod(rootDir, 0o755);
      await chmod(sessionsFilePath, 0o644);
      await chmod(archiveDirectoryPath, 0o755);
      await chmod(archive.filePath, 0o644);
      await store.listSessions();
      const rewrittenArchive = await store.archiveBuffer('session-permissions');

      expect(rewrittenArchive.filePath).toBe(archive.filePath);
      expect({
        newModes,
        healedModes: {
          rootDirectory: await readPosixMode(rootDir),
          metadataFile: await readPosixMode(sessionsFilePath),
          archiveDirectory: await readPosixMode(archiveDirectoryPath),
          archiveFile: await readPosixMode(archive.filePath),
        },
        metadataPreserved: (await readFile(sessionsFilePath, 'utf-8')) === metadataBeforeHealing,
        archivePreserved: (await readFile(archive.filePath, 'utf-8')) === archiveBeforeHealing,
      }).toEqual({
        newModes: {
          rootDirectory: 0o700,
          metadataFile: 0o600,
          archiveDirectory: 0o700,
          archiveFile: 0o600,
        },
        healedModes: {
          rootDirectory: 0o700,
          metadataFile: 0o600,
          archiveDirectory: 0o700,
          archiveFile: 0o600,
        },
        metadataPreserved: true,
        archivePreserved: true,
      });
    } finally {
      vi.useRealTimers();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps the session record when a view is closed', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-session-record-'));
    try {
      const store = createSessionHistoryStore(rootDir);

      await store.saveSession({
        id: 'session-1',
        title: 'Claude · AgentDock',
        profileId: 'claude-custom',
        workspaceId: 'agentdock',
        command: 'claude',
        status: 'exited',
        startedAt: '2026-07-07T00:00:00.000Z',
      });

      await store.closeView('session-1', 'window-1');

      const sessions = await store.listSessions();
      expect(sessions).toEqual([
        expect.objectContaining({
          id: 'session-1',
          closedViewIds: ['window-1'],
        }),
      ]);
      const raw = await readFile(path.join(rootDir, 'sessions.json'), 'utf-8');
      expect(raw).toContain('"session-1"');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('archives a session record without changing its run status', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-session-record-'));
    try {
      const store = createSessionHistoryStore(rootDir);

      await store.saveSession({
        id: 'session-1',
        title: 'Claude · AgentDock',
        profileId: 'claude-custom',
        workspaceId: 'agentdock',
        command: 'claude',
        status: 'stopped',
        startedAt: '2026-07-07T00:00:00.000Z',
      });

      await store.archiveSession('session-1');

      await expect(store.listSessions()).resolves.toEqual([
        expect.objectContaining({
          id: 'session-1',
          status: 'stopped',
          archived: true,
        }),
      ]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('deletes AgentDock session metadata and transcript without deleting workspace files', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-session-record-'));
    const workspaceDir = path.join(rootDir, 'workspace');
    const workspaceFile = path.join(workspaceDir, 'App.tsx');
    try {
      await mkdir(workspaceDir);
      await writeFile(workspaceFile, 'project source', 'utf-8');
      const store = createSessionHistoryStore(rootDir);

      await store.saveSession({
        id: 'session-1',
        title: 'Claude · AgentDock',
        profileId: 'claude-custom',
        workspaceId: 'agentdock',
        command: 'claude',
        status: 'exited',
        startedAt: '2026-07-07T00:00:00.000Z',
      });
      await store.appendOutput('session-1', 'terminal output');

      await store.deleteRecord('session-1');

      await expect(store.listSessions()).resolves.toEqual([]);
      await expect(readFile(path.join(rootDir, 'session-transcripts/session-1.log'), 'utf-8'))
        .rejects.toThrow();
      await expect(readFile(workspaceFile, 'utf-8')).resolves.toBe('project source');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
