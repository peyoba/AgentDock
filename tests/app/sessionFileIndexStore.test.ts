import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionFileIndexStore } from '../../src/main/stores/sessionFileIndexStore';

describe('sessionFileIndexStore', () => {
  it('stores touched files without source contents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-file-index-'));
    const store = createSessionFileIndexStore(root);

    await store.saveIndex('session-1', {
      baselineAt: '2026-07-07T00:00:00.000Z',
      files: [{ relativePath: 'src/App.tsx', gitStatus: 'M', touchedInSession: true }],
    });

    await expect(store.readIndex('session-1')).resolves.toEqual({
      baselineAt: '2026-07-07T00:00:00.000Z',
      files: [{ relativePath: 'src/App.tsx', gitStatus: 'M', touchedInSession: true }],
    });

    const raw = await readFile(path.join(root, 'session-file-index', 'session-1.json'), 'utf-8');
    expect(raw).not.toContain('source text');
  });

  it('returns an empty index for missing sessions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-file-index-'));
    const store = createSessionFileIndexStore(root);

    await expect(store.readIndex('missing-session')).resolves.toEqual({
      files: [],
    });
  });
});
