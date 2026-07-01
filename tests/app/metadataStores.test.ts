import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProfileStore } from '../../src/main/stores/profileStore';
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
        keychainService: 'AgentDock',
        keychainAccount: 'profile-a',
      },
    ]);
    expect(JSON.stringify(profiles)).not.toContain('local-development-secret');
    expect(JSON.stringify(profiles)).not.toContain('ANTHROPIC_AUTH_TOKEN');
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
});
