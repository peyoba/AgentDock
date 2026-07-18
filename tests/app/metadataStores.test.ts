import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProfileStore } from '../../src/main/stores/profileStore';
import { createSessionHistoryStore } from '../../src/main/stores/sessionHistoryStore';
import { createSessionTranscriptStore } from '../../src/main/stores/sessionTranscriptStore';
import { createWorkspaceStore } from '../../src/main/stores/workspaceStore';
import type { AgentSession, ApiProfile } from '../../src/shared/agentdockTypes';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('metadata stores', () => {
  it('persists grok profile home and auth mode without secrets', async () => {
    const store = createProfileStore(tempDir);

    await store.save({
      id: 'grok-a',
      name: 'Grok A',
      toolType: 'grok',
      baseUrl: 'https://api.x.ai/v1',
      defaultModel: 'grok-build',
      keychainService: 'AgentDock',
      keychainAccount: 'grok-a',
      grokHome: '~/.agentdock/grok-profiles/grok-a',
      grokAuthMode: 'oauth',
    });

    await expect(store.list()).resolves.toEqual([
      {
        id: 'grok-a',
        name: 'Grok A',
        toolType: 'grok',
        baseUrl: 'https://api.x.ai/v1',
        defaultModel: 'grok-build',
        keychainService: 'AgentDock',
        keychainAccount: 'grok-a',
        grokHome: '~/.agentdock/grok-profiles/grok-a',
        grokAuthMode: 'oauth',
      },
    ]);
  });

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

  it('persists the selected Codex default launch mode without persisting runtime aliases', async () => {
    const store = createProfileStore(tempDir);

    await store.save({
      id: 'codex-compatible',
      name: 'Codex Compatible',
      toolType: 'codex',
      baseUrl: 'https://codex.example.invalid/v1',
      defaultModel: 'gpt-5.6-sol',
      keychainService: 'AgentDock',
      keychainAccount: 'codex-compatible',
      codexHome: '~/.agentdock/codex-profiles/codex-compatible',
      codexDefaultLaunchMode: 'newapi-tool-compatible',
    } as ApiProfile);

    const [saved] = await store.list();
    expect(saved.codexDefaultLaunchMode).toBe('newapi-tool-compatible');
    expect(saved.defaultModel).toBe('gpt-5.6-sol');
    expect(JSON.stringify(saved)).not.toContain('agentdock-tool-runtime-');

    const rawProfiles = JSON.parse(
      await readFile(path.join(tempDir, 'profiles.json'), 'utf-8'),
    ) as Array<Record<string, unknown>>;
    expect(rawProfiles).toEqual([
      expect.objectContaining({
        __version: 5,
        id: 'codex-compatible',
        codexDefaultLaunchMode: 'newapi-tool-compatible',
      }),
    ]);
  });

  it('persists the actual Codex launch mode on session metadata', async () => {
    const store = createSessionHistoryStore(tempDir);
    const session = {
      id: 'session-codex',
      title: 'Codex Compatible · AgentDock',
      profileId: 'codex-compatible',
      workspaceId: 'workspace-a',
      command: 'codex --no-alt-screen',
      codexLaunchMode: 'newapi-tool-compatible',
      status: 'running',
      startedAt: '2026-07-12T00:00:00.000Z',
    } as AgentSession;

    await store.saveSession(session);

    await expect(store.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'session-codex',
        codexLaunchMode: 'newapi-tool-compatible',
      }),
    ]);
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

    const rawWorkspaces = JSON.parse(
      await readFile(path.join(tempDir, 'workspaces.json'), 'utf-8'),
    ) as Array<Record<string, unknown>>;
    expect(rawWorkspaces).toEqual([
      expect.objectContaining({
        __version: 5,
        id: 'workspace-a',
      }),
    ]);
  });

  it('migrates legacy terminalBuffer entries into transcript files', async () => {
    const legacySession: AgentSession = {
      id: 'session-1',
      title: 'Claude A · AgentDock',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'exited',
      startedAt: '2026-07-01T00:00:00.000Z',
    };
    await writeFile(
      path.join(tempDir, 'sessions.json'),
      JSON.stringify([
        {
          id: 'session-1',
          session: legacySession,
          terminalBuffer: 'old terminal output',
        },
      ]),
      'utf-8',
    );

    const transcriptStore = createSessionTranscriptStore(tempDir);
    const historyStore = createSessionHistoryStore(tempDir, { transcriptStore });

    const sessions = await historyStore.listSessions();
    const persistedJson = await readFile(path.join(tempDir, 'sessions.json'), 'utf-8');
    const tail = await transcriptStore.readTail('session-1');

    expect(sessions[0].transcript?.byteSize).toBeGreaterThan(0);
    expect(tail.content).toContain('old terminal output');
    expect(persistedJson).not.toContain('terminalBuffer');
    expect(persistedJson).not.toContain('old terminal output');
  });

  it('persists session history output in transcript files without storing it in sessions json', async () => {
    const transcriptStore = createSessionTranscriptStore(tempDir, { tailBytes: 100 });
    const store = createSessionHistoryStore(tempDir, {
      maxSessions: 50,
      transcriptStore,
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
      limitReached: false,
    });

    await expect(store.readBuffer('session-1')).resolves.toBe('1234567890abcdefghijk');
    await expect(store.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: 'session-1',
        transcript: expect.objectContaining({
          byteSize: Buffer.byteLength('1234567890abcdefghijk', 'utf-8'),
          tailTruncated: false,
        }),
      }),
    ]);
    await expect(readFile(path.join(tempDir, 'sessions.json'), 'utf-8')).resolves.not.toContain(
      '1234567890abcdefghijk',
    );
  });

  it('serializes concurrent session history appends without losing output', async () => {
    const transcriptStore = createSessionTranscriptStore(tempDir);
    const store = createSessionHistoryStore(tempDir, {
      maxSessions: 50,
      transcriptStore,
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

  it('cleans oldest non-running sessions while preserving running sessions', async () => {
    const transcriptStore = createSessionTranscriptStore(tempDir);
    const store = createSessionHistoryStore(tempDir, {
      maxSessions: 2,
      maxTranscriptBytes: 40,
      transcriptStore,
    });
    const oldStoppedSession: AgentSession = {
      id: 'old-stopped',
      title: 'Old Claude',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'exited',
      startedAt: '2026-07-01T00:00:00.000Z',
      exitedAt: '2026-07-01T00:01:00.000Z',
    };
    const runningSession: AgentSession = {
      id: 'running-session',
      title: 'Running Claude',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'running',
      startedAt: '2026-07-01T00:02:00.000Z',
    };
    const newStoppedSession: AgentSession = {
      id: 'new-stopped',
      title: 'New Claude',
      profileId: 'profile-a',
      workspaceId: 'workspace-a',
      command: 'claude',
      status: 'exited',
      startedAt: '2026-07-01T00:03:00.000Z',
      exitedAt: '2026-07-01T00:04:00.000Z',
    };

    await store.saveSession(oldStoppedSession);
    await store.appendOutput(oldStoppedSession.id, 'old output data');
    await store.saveSession(runningSession);
    await store.appendOutput(runningSession.id, 'running output data');
    await store.saveSession(newStoppedSession);
    await store.appendOutput(newStoppedSession.id, 'new output data');

    const sessions = await store.listSessions();
    const sessionIds = sessions.map((session) => session.id);

    expect(sessionIds).toContain(runningSession.id);
    expect(sessionIds).toContain(newStoppedSession.id);
    expect(sessionIds).not.toContain(oldStoppedSession.id);
    await expect(transcriptStore.readTail(oldStoppedSession.id)).resolves.toMatchObject({
      content: '',
      byteSize: 0,
    });
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
