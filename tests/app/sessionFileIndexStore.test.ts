import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionFileIndexStore } from '../../src/main/stores/sessionFileIndexStore';

async function readPosixMode(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

describe('sessionFileIndexStore', () => {
  it('creates private paths and heals legacy permissions without changing index contents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-file-index-permissions-'));
    const indexDirectoryPath = path.join(root, 'session-file-index');
    const indexFilePath = path.join(indexDirectoryPath, 'session-permissions.json');
    const store = createSessionFileIndexStore(root);
    const expectedIndex = {
      baselineAt: '2026-07-12T08:00:00.000Z',
      files: [{ relativePath: 'src/main/index.ts', gitStatus: 'M', touchedInSession: true }],
    };

    try {
      await store.saveIndex('session-permissions', expectedIndex);

      const newDirectoryMode = await readPosixMode(indexDirectoryPath);
      const newFileMode = await readPosixMode(indexFilePath);
      const contentsBeforeHealing = await readFile(indexFilePath, 'utf-8');

      await chmod(indexDirectoryPath, 0o755);
      await chmod(indexFilePath, 0o644);
      const readIndex = await store.readIndex('session-permissions');

      expect({
        newDirectoryMode,
        newFileMode,
        healedDirectoryMode: await readPosixMode(indexDirectoryPath),
        healedFileMode: await readPosixMode(indexFilePath),
        contentsPreserved: (await readFile(indexFilePath, 'utf-8')) === contentsBeforeHealing,
        readIndex,
      }).toEqual({
        newDirectoryMode: 0o700,
        newFileMode: 0o600,
        healedDirectoryMode: 0o700,
        healedFileMode: 0o600,
        contentsPreserved: true,
        readIndex: expectedIndex,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
