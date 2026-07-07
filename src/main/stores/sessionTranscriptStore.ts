import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SESSION_TRANSCRIPT_TAIL_BYTES = 20_000_000;

export type TranscriptTail = {
  content: string;
  byteSize: number;
  truncated: boolean;
  filePath: string;
};

export type SessionTranscriptStore = {
  appendOutput(sessionId: string, data: string): Promise<void>;
  readTail(sessionId: string): Promise<TranscriptTail>;
  deleteTranscript(sessionId: string): Promise<void>;
  transcriptPath(sessionId: string): string;
};

type CreateSessionTranscriptStoreOptions = {
  tailBytes?: number;
};

function safeTranscriptFileName(sessionId: string): string {
  return `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.log`;
}

function utf8Tail(buffer: Buffer, maxBytes: number): { content: string; truncated: boolean } {
  if (buffer.length <= maxBytes) {
    return { content: buffer.toString('utf-8'), truncated: false };
  }

  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }

  return { content: buffer.subarray(start).toString('utf-8'), truncated: true };
}

export function createSessionTranscriptStore(
  rootDir: string,
  { tailBytes = SESSION_TRANSCRIPT_TAIL_BYTES }: CreateSessionTranscriptStoreOptions = {},
): SessionTranscriptStore {
  const transcriptDir = path.join(rootDir, 'session-transcripts');
  const appendQueues = new Map<string, Promise<void>>();

  function transcriptPath(sessionId: string): string {
    return path.join(transcriptDir, safeTranscriptFileName(sessionId));
  }

  async function enqueueAppend(sessionId: string, operation: () => Promise<void>): Promise<void> {
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

  return {
    appendOutput(sessionId: string, data: string): Promise<void> {
      return enqueueAppend(sessionId, async () => {
        await mkdir(transcriptDir, { recursive: true });
        await writeFile(transcriptPath(sessionId), data, { encoding: 'utf-8', flag: 'a' });
      });
    },

    async readTail(sessionId: string): Promise<TranscriptTail> {
      const filePath = transcriptPath(sessionId);
      try {
        const [buffer, fileStat] = await Promise.all([
          readFile(filePath),
          stat(filePath),
        ]);
        const tail = utf8Tail(buffer, tailBytes);
        return {
          ...tail,
          byteSize: fileStat.size,
          filePath,
        };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return { content: '', byteSize: 0, truncated: false, filePath };
        }
        throw error;
      }
    },

    async deleteTranscript(sessionId: string): Promise<void> {
      await rm(transcriptPath(sessionId), { force: true });
    },

    transcriptPath,
  };
}
