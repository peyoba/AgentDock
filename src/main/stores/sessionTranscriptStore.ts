import { open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  appendPrivateFile,
  ensurePrivateDirectory,
  ensurePrivateFile,
  writePrivateFileAtomically,
} from '../privateFileSystem.js';

export const SESSION_TRANSCRIPT_TAIL_BYTES = 20_000_000;

export type TranscriptTail = {
  content: string;
  byteSize: number;
  truncated: boolean;
  filePath: string;
};

export type TranscriptAppendResult = {
  byteSize: number;
  rolled: boolean;
};

export type SessionTranscriptStore = {
  appendOutput(sessionId: string, data: string): Promise<TranscriptAppendResult>;
  readTail(sessionId: string): Promise<TranscriptTail>;
  statSize(sessionId: string): Promise<number>;
  deleteTranscript(sessionId: string): Promise<void>;
  transcriptPath(sessionId: string): string;
};

type CreateSessionTranscriptStoreOptions = {
  tailBytes?: number;
  maxFileBytes?: number;
};

function safeTranscriptFileName(sessionId: string): string {
  return `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.log`;
}

function utf8SafeStart(buffer: Buffer): Buffer {
  let start = 0;
  while (start < buffer.length && (buffer[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return buffer.subarray(start);
}

async function readLastBytes(
  filePath: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; fileSize: number } | undefined> {
  await ensurePrivateDirectory(path.dirname(filePath));
  await ensurePrivateFile(filePath);
  let handle;
  try {
    handle = await open(filePath, 'r');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  try {
    const fileStat = await handle.stat();
    const length = Math.min(fileStat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, fileStat.size - length);
    return { buffer, fileSize: fileStat.size };
  } finally {
    await handle.close();
  }
}

export function createSessionTranscriptStore(
  rootDir: string,
  { tailBytes = SESSION_TRANSCRIPT_TAIL_BYTES, maxFileBytes }: CreateSessionTranscriptStoreOptions = {},
): SessionTranscriptStore {
  const transcriptDir = path.join(rootDir, 'session-transcripts');
  const appendQueues = new Map<string, Promise<unknown>>();
  const sizeCache = new Map<string, number>();

  function transcriptPath(sessionId: string): string {
    return path.join(transcriptDir, safeTranscriptFileName(sessionId));
  }

  async function currentSize(sessionId: string): Promise<number> {
    const cached = sizeCache.get(sessionId);
    if (cached !== undefined) {
      return cached;
    }
    try {
      await ensurePrivateDirectory(transcriptDir);
      await ensurePrivateFile(transcriptPath(sessionId));
      const fileStat = await stat(transcriptPath(sessionId));
      sizeCache.set(sessionId, fileStat.size);
      return fileStat.size;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        sizeCache.set(sessionId, 0);
        return 0;
      }
      throw error;
    }
  }

  function enqueueAppend<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = appendQueues.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const tracked = next.then(
      () => {
        if (appendQueues.get(sessionId) === tracked) {
          appendQueues.delete(sessionId);
        }
      },
      () => {
        if (appendQueues.get(sessionId) === tracked) {
          appendQueues.delete(sessionId);
        }
      },
    );
    appendQueues.set(sessionId, tracked);
    return next;
  }

  async function rollToTail(sessionId: string, keepBytes: number): Promise<number> {
    const filePath = transcriptPath(sessionId);
    const tail = await readLastBytes(filePath, keepBytes);
    if (!tail) {
      return 0;
    }
    const kept = utf8SafeStart(tail.buffer);
    await writePrivateFileAtomically(filePath, kept.toString('utf-8'));
    return kept.length;
  }

  return {
    appendOutput(sessionId: string, data: string): Promise<TranscriptAppendResult> {
      return enqueueAppend(sessionId, async () => {
        try {
          await ensurePrivateDirectory(transcriptDir);
          const sizeBefore = await currentSize(sessionId);
          await appendPrivateFile(transcriptPath(sessionId), data);
          let byteSize = sizeBefore + Buffer.byteLength(data, 'utf-8');
          sizeCache.set(sessionId, byteSize);

          let rolled = false;
          if (maxFileBytes !== undefined && byteSize > maxFileBytes) {
            byteSize = await rollToTail(sessionId, Math.floor(maxFileBytes / 2));
            sizeCache.set(sessionId, byteSize);
            rolled = true;
          }

          return { byteSize, rolled };
        } catch (error) {
          sizeCache.delete(sessionId);
          throw error;
        }
      });
    },

    async readTail(sessionId: string): Promise<TranscriptTail> {
      const filePath = transcriptPath(sessionId);
      const tail = await readLastBytes(filePath, tailBytes);
      if (!tail) {
        return { content: '', byteSize: 0, truncated: false, filePath };
      }
      const content = utf8SafeStart(tail.buffer).toString('utf-8');
      return {
        content,
        byteSize: tail.fileSize,
        truncated: tail.fileSize > tailBytes,
        filePath,
      };
    },

    statSize(sessionId: string): Promise<number> {
      return currentSize(sessionId);
    },

    async deleteTranscript(sessionId: string): Promise<void> {
      await rm(transcriptPath(sessionId), { force: true });
      sizeCache.delete(sessionId);
    },

    transcriptPath,
  };
}
