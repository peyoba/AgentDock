import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SessionFileIndex } from '../../shared/agentdockTypes.js';

export type SessionFileIndexStore = {
  saveIndex(sessionId: string, index: SessionFileIndex): Promise<void>;
  readIndex(sessionId: string): Promise<SessionFileIndex>;
};

function safeSessionFileName(sessionId: string): string {
  return `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

export function createSessionFileIndexStore(rootDir: string): SessionFileIndexStore {
  const indexDir = path.join(rootDir, 'session-file-index');

  function filePathFor(sessionId: string): string {
    return path.join(indexDir, safeSessionFileName(sessionId));
  }

  return {
    async saveIndex(sessionId, index): Promise<void> {
      await mkdir(indexDir, { recursive: true });
      await writeFile(filePathFor(sessionId), `${JSON.stringify(index, null, 2)}\n`, 'utf-8');
    },

    async readIndex(sessionId): Promise<SessionFileIndex> {
      try {
        const raw = await readFile(filePathFor(sessionId), 'utf-8');
        const parsed = JSON.parse(raw) as SessionFileIndex;
        return {
          baselineAt: typeof parsed.baselineAt === 'string' ? parsed.baselineAt : undefined,
          files: Array.isArray(parsed.files) ? parsed.files : [],
        };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return { files: [] };
        }
        throw error;
      }
    },
  };
}
