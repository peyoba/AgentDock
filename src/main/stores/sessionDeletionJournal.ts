import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  writePrivateFileAtomically,
} from '../privateFileSystem.js';
import { assertSafeSessionRecordId } from './sessionRecordEventSchema.js';

const SESSION_DELETION_DIRECTORY = 'session-deletions';
const TOMBSTONE_SUFFIX = '.json';

export type SessionDeletionJournal = {
  mark(sessionId: string): Promise<void>;
  clear(sessionId: string): Promise<void>;
  has(sessionId: string): Promise<boolean>;
  list(): Promise<string[]>;
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createSessionDeletionJournal(rootDir: string): SessionDeletionJournal {
  const journalDirectory = path.join(rootDir, SESSION_DELETION_DIRECTORY);

  function tombstonePath(sessionId: string): string {
    assertSafeSessionRecordId(sessionId);
    return path.join(journalDirectory, `${sessionId}${TOMBSTONE_SUFFIX}`);
  }

  return {
    async mark(sessionId): Promise<void> {
      await writePrivateFileAtomically(
        tombstonePath(sessionId),
        `${JSON.stringify({ schemaVersion: 1, sessionId })}\n`,
      );
    },

    async clear(sessionId): Promise<void> {
      const filePath = tombstonePath(sessionId);
      await ensurePrivateFile(filePath);
      await rm(filePath, { force: true });
    },

    async has(sessionId): Promise<boolean> {
      const filePath = tombstonePath(sessionId);
      try {
        await ensurePrivateFile(filePath);
        return (await lstat(filePath)).isFile();
      } catch (error) {
        if (isMissingFile(error)) return false;
        // Never leak the userData path through this error surface.
        throw new Error('会话删除意图读取失败。');
      }
    },

    async list(): Promise<string[]> {
      try {
        await ensurePrivateDirectory(journalDirectory);
      } catch {
        throw new Error('会话删除意图目录不可用。');
      }
      let entries;
      try {
        entries = await readdir(journalDirectory, { withFileTypes: true });
      } catch (error) {
        if (isMissingFile(error)) return [];
        throw new Error('会话删除意图目录读取失败。');
      }
      const sessionIds: string[] = [];
      for (const entry of entries) {
        if (!entry.name.endsWith(TOMBSTONE_SUFFIX)) continue;
        const sessionId = entry.name.slice(0, -TOMBSTONE_SUFFIX.length);
        // Foreign entries — Finder/iCloud/Dropbox conflict copies, symlinks —
        // were never written by this journal.  Skipping them keeps one stray
        // file from failing every listSessions() call in the window forever.
        try {
          assertSafeSessionRecordId(sessionId);
        } catch {
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          await ensurePrivateFile(tombstonePath(sessionId));
        } catch {
          continue;
        }
        sessionIds.push(sessionId);
      }
      return sessionIds.sort();
    },
  };
}
