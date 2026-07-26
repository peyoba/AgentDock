import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionDeletionJournal } from '../../src/main/stores/sessionDeletionJournal';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-delete-journal-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('sessionDeletionJournal', () => {
  it('persists only a minimal private deletion intent and clears it idempotently', async () => {
    const journal = createSessionDeletionJournal(tempDir);
    const sessionId = 'session-w1-28';
    const tombstonePath = path.join(tempDir, 'session-deletions', `${sessionId}.json`);

    await journal.mark(sessionId);

    await expect(journal.list()).resolves.toEqual([sessionId]);
    await expect(journal.has(sessionId)).resolves.toBe(true);
    await expect(readFile(tombstonePath, 'utf8')).resolves.toBe(
      `${JSON.stringify({ schemaVersion: 1, sessionId })}\n`,
    );
    if (process.platform !== 'win32') {
      expect((await stat(path.dirname(tombstonePath))).mode & 0o777).toBe(0o700);
      expect((await stat(tombstonePath)).mode & 0o777).toBe(0o600);
    }

    await journal.clear(sessionId);
    await journal.clear(sessionId);
    await expect(journal.list()).resolves.toEqual([]);
    await expect(journal.has(sessionId)).resolves.toBe(false);
  });

  it('rejects path-like session identifiers before writing a tombstone', async () => {
    const journal = createSessionDeletionJournal(tempDir);
    await expect(journal.mark('../outside')).rejects.toThrow('会话 ID 不安全');
    await expect(journal.list()).resolves.toEqual([]);
  });
});
