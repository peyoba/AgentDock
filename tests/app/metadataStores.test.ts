import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProfileStore } from '../../src/main/stores/profileStore';
import { createSessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';
import { createWorkspaceStore } from '../../src/main/stores/workspaceStore';
import type { ApiProfile } from '../../src/shared/agentdockTypes';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('metadata stores', () => {
  it('saves profile metadata without secret values or raw env snapshots', async () => {
    const store = createProfileStore(tempDir);
    const profileWithAccidentalSecret = {
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://example.invalid/v1',
      defaultModel: 'claude-3-5-haiku-20241022',
      availableModels: ['claude-3-5-haiku-20241022', 'claude-3-7-sonnet-20250219'],
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
      apiKey: 'local-development-secret',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'local-development-secret',
      },
    } as ApiProfile & { apiKey: string; env: Record<string, string> };

    await store.save(profileWithAccidentalSecret);

    const profiles = await store.list();

    expect(profiles).toEqual([
      {
        id: 'profile-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://example.invalid/v1',
        defaultModel: 'claude-3-5-haiku-20241022',
        availableModels: ['claude-3-5-haiku-20241022', 'claude-3-7-sonnet-20250219'],
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
        claudeCclineStatusLineEnabled: true,
      },
    ]);
    expect(JSON.stringify(profiles)).not.toContain('local-development-secret');
    expect(JSON.stringify(profiles)).not.toContain('ANTHROPIC_AUTH_TOKEN');
  });

  it('deletes profile metadata from the persisted profile store', async () => {
    const store = createProfileStore(tempDir);

    await store.save({
      id: 'profile-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://claude.example.invalid',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-a',
    });
    await store.save({
      id: 'profile-b',
      name: 'Codex B',
      toolType: 'codex',
      baseUrl: 'https://codex.example.invalid/v1',
      keychainService: 'AgentDock',
      keychainAccount: 'profile-b',
      codexHome: '~/.agentdock/codex-profiles/profile-b',
    });

    await store.delete('profile-a');

    await expect(store.list()).resolves.toEqual([
      {
        id: 'profile-b',
        name: 'Codex B',
        toolType: 'codex',
        baseUrl: 'https://codex.example.invalid/v1',
        keychainService: 'AgentDock',
        keychainAccount: 'profile-b',
        codexHome: '~/.agentdock/codex-profiles/profile-b',
      },
    ]);

    const rawProfiles = await readFile(path.join(tempDir, 'profiles.json'), 'utf-8');
    expect(rawProfiles).not.toContain('profile-a');
    expect(rawProfiles).toContain('profile-b');
  });

  it('sanitizes stored AnyRouter Claude metadata before returning profiles', async () => {
    const store = createProfileStore(tempDir);

    await store.save({
      id: 'claude-anyrouter',
      name: 'Claude · AnyRouter',
      toolType: 'claude',
      baseUrl: 'https://anyrouter.top',
      defaultModel: 'opus[1m]',
      availableModels: ['opus[1m]', 'claude-fable-5', 'claude-opus-4-7'],
      keychainService: 'AgentDock',
      keychainAccount: 'claude-anyrouter',
      anthropicBetas: 'http://127.0.0.1:7897',
      httpProxy: 'context-1m-2025-08-07',
      httpsProxy: 'not-a-url',
    });

    await expect(store.list()).resolves.toEqual([
      {
        id: 'claude-anyrouter',
        name: 'Claude · AnyRouter',
        toolType: 'claude',
        baseUrl: 'https://anyrouter.top',
        defaultModel: 'claude-opus-4-8',
        claudeHaikuModel: 'claude-haiku-4-5-20251001',
        claudeSonnetModel: 'claude-fable-5',
        claudeOpusModel: 'claude-opus-4-8',
        claudeDefaultLaunchMode: 'default',
        availableModels: ['claude-fable-5', 'claude-opus-4-7'],
        keychainService: 'AgentDock',
        keychainAccount: 'claude-anyrouter',
        anthropicBetas: 'context-1m-2025-08-07',
        claudeCclineStatusLineEnabled: true,
      },
    ]);
  });

  it('preserves the Claude CCometixLine statusline setting after saving a profile', async () => {
    const store = createProfileStore(tempDir);

    await store.save({
      id: 'claude-a',
      name: 'Claude A',
      toolType: 'claude',
      baseUrl: 'https://claude.example.invalid',
      keychainService: 'AgentDock',
      keychainAccount: 'claude-a',
      claudeCclineStatusLineEnabled: true,
    });

    await expect(store.list()).resolves.toEqual([
      {
        id: 'claude-a',
        name: 'Claude A',
        toolType: 'claude',
        baseUrl: 'https://claude.example.invalid',
        keychainService: 'AgentDock',
        keychainAccount: 'claude-a',
        claudeCclineStatusLineEnabled: true,
      },
    ]);
  });

  it('saves workspace metadata by local path', async () => {
    const store = createWorkspaceStore(tempDir);

    await store.save({
      id: 'workspace-a',
      name: 'AgentDock',
      path: '/Users/example/Desktop/web/AgentDock',
    });

    await expect(store.list()).resolves.toEqual([
      {
        id: 'workspace-a',
        name: 'AgentDock',
        path: '/Users/example/Desktop/web/AgentDock',
      },
    ]);
  });

  it('persists session history with a capped buffer and archive action', async () => {
    const store = createSessionHistoryStore(tempDir, {
      maxBufferBytes: 20,
      maxSessions: 50,
    });

    await store.saveSession({
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-01T00:00:00.000Z',
    });

    await expect(store.appendOutput('session-1', '1234567890')).resolves.toEqual({
      limitReached: false,
    });
    await expect(store.appendOutput('session-1', 'abcdefghijk')).resolves.toEqual({
      limitReached: true,
    });

    await expect(store.readBuffer('session-1')).resolves.toBe('1234567890abcdefghij');
    await expect(store.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'session-1',
        historyLimitReached: true,
      }),
    ]);

    const archive = await store.archiveBuffer('session-1');
    expect(archive.filePath).toContain('session-1');
    await expect(readFile(archive.filePath, 'utf-8')).resolves.toBe('1234567890abcdefghij');
    await expect(store.readBuffer('session-1')).resolves.toBe('');
    await expect(store.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'session-1',
        historyLimitReached: false,
        historyArchivePath: archive.filePath,
      }),
    ]);
  });

  it('serializes concurrent session history appends without losing output', async () => {
    const store = createSessionHistoryStore(tempDir, {
      maxBufferBytes: 1000,
      maxSessions: 50,
    });

    await store.saveSession({
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-01T00:00:00.000Z',
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.appendOutput('session-1', `${index},`)),
    );

    await expect(store.readBuffer('session-1')).resolves.toBe(
      Array.from({ length: 20 }, (_, index) => `${index},`).join(''),
    );
  });

  it('backs up and recovers a session history file with trailing non-json output', async () => {
    const sessionsPath = path.join(tempDir, 'sessions.json');
    const validSessionsJson = JSON.stringify(
      [
        {
          id: 'session-1',
          session: {
            id: 'session-1',
            title: 'Claude A · AgentDock',
            profileId: 'profile-a',
            workspaceId: 'workspace-a',
            command: 'claude',
            status: 'exited',
            startedAt: '2026-07-01T00:00:00.000Z',
          },
          terminalBuffer: 'safe output',
        },
      ],
      null,
      2,
    );
    await writeFile(sessionsPath, `${validSessionsJson}\n\u001b[244mtrailing terminal output`, 'utf-8');

    const store = createSessionHistoryStore(tempDir);

    await expect(store.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: 'session-1' }),
    ]);
    await expect(store.readBuffer('session-1')).resolves.toBe('safe output');
    await expect(readdir(tempDir)).resolves.toEqual(
      expect.arrayContaining([expect.stringMatching(/^sessions\.corrupt-.*\.json$/)]),
    );
  });
});
