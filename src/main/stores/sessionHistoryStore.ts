import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession } from '../../shared/agentdockTypes.js';
import { createJsonStore } from './jsonStore.js';

export const SESSION_HISTORY_BUFFER_LIMIT_BYTES = 5_000_000;
export const SESSION_HISTORY_COUNT_LIMIT = 50;

type SessionHistoryEntry = {
  id: string;
  session: AgentSession;
  terminalBuffer: string;
};

export type SessionHistoryStore = {
  listSessions(): Promise<AgentSession[]>;
  saveSession(session: AgentSession): Promise<void>;
  appendOutput(sessionId: string, data: string): Promise<{ limitReached: boolean }>;
  readBuffer(sessionId: string): Promise<string>;
  deleteSession(sessionId: string): Promise<void>;
  archiveBuffer(sessionId: string): Promise<{ filePath: string }>;
};

type CreateSessionHistoryStoreOptions = {
  maxBufferBytes?: number;
  maxSessions?: number;
};

function sortRecentFirst(entries: SessionHistoryEntry[]): SessionHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const aTime = Date.parse(a.session.exitedAt ?? a.session.startedAt);
    const bTime = Date.parse(b.session.exitedAt ?? b.session.startedAt);
    return bTime - aTime;
  });
}

function trimBufferToBytes(buffer: string, maxBytes: number): string {
  const bytes = Buffer.from(buffer, 'utf-8');
  if (bytes.length <= maxBytes) {
    return buffer;
  }

  return bytes.subarray(0, maxBytes).toString('utf-8');
}

function safeArchiveFileName(sessionId: string): string {
  const safeSessionId = sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${safeSessionId}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
}

function findFirstJsonArrayEnd(text: string): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return undefined;
}

async function recoverSessionHistoryEntries(filePath: string): Promise<SessionHistoryEntry[]> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected array in ${filePath}`);
    }
    return parsed as SessionHistoryEntry[];
  } catch (error) {
    const backupPath = path.join(
      path.dirname(filePath),
      `sessions.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    await rename(filePath, backupPath).catch(() => undefined);

    const firstArrayEnd = findFirstJsonArrayEnd(text);
    if (firstArrayEnd === undefined) {
      return [];
    }

    const recoveredText = text.slice(0, firstArrayEnd);
    const recovered: unknown = JSON.parse(recoveredText);
    if (!Array.isArray(recovered)) {
      return [];
    }

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(recovered, null, 2)}\n`, 'utf-8');
    return recovered as SessionHistoryEntry[];
  }
}

export function createSessionHistoryStore(
  rootDir: string,
  {
    maxBufferBytes = SESSION_HISTORY_BUFFER_LIMIT_BYTES,
    maxSessions = SESSION_HISTORY_COUNT_LIMIT,
  }: CreateSessionHistoryStoreOptions = {},
): SessionHistoryStore {
  const sessionsFilePath = path.join(rootDir, 'sessions.json');
  const store = createJsonStore<SessionHistoryEntry>(sessionsFilePath);
  const archiveDir = path.join(rootDir, 'session-archives');
  let operationQueue: Promise<void> = Promise.resolve();

  async function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = operationQueue.then(operation, operation);
    operationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function listEntries(): Promise<SessionHistoryEntry[]> {
    return sortRecentFirst(await recoverSessionHistoryEntries(sessionsFilePath)).slice(0, maxSessions);
  }

  async function saveEntries(entries: SessionHistoryEntry[]): Promise<void> {
    await store.replaceAll(sortRecentFirst(entries).slice(0, maxSessions));
  }

  async function saveSession(session: AgentSession): Promise<void> {
    const entries = await listEntries();
    const existingEntry = entries.find((entry) => entry.id === session.id);
    const nextEntry: SessionHistoryEntry = {
      id: session.id,
      session: { ...session },
      terminalBuffer: existingEntry?.terminalBuffer ?? '',
    };
    await saveEntries([
      nextEntry,
      ...entries.filter((entry) => entry.id !== session.id),
    ]);
  }

  async function updateSession(
    sessionId: string,
    update: (entry: SessionHistoryEntry) => SessionHistoryEntry,
  ): Promise<SessionHistoryEntry | undefined> {
    const entries = await listEntries();
    const existingEntry = entries.find((entry) => entry.id === sessionId);
    if (!existingEntry) {
      return undefined;
    }

    const nextEntry = update(existingEntry);
    await saveEntries([
      nextEntry,
      ...entries.filter((entry) => entry.id !== sessionId),
    ]);
    return nextEntry;
  }

  return {
    async listSessions(): Promise<AgentSession[]> {
      return enqueue(async () => (await listEntries()).map((entry) => ({ ...entry.session })));
    },

    saveSession(session: AgentSession): Promise<void> {
      return enqueue(() => saveSession(session));
    },

    async appendOutput(sessionId: string, data: string): Promise<{ limitReached: boolean }> {
      return enqueue(async () => {
        const entries = await listEntries();
        const currentEntry = entries.find((entry) => entry.id === sessionId);
        if (!currentEntry) {
          return { limitReached: false };
        }
        if (currentEntry.session.historyLimitReached) {
          return { limitReached: true };
        }

        const appendedBuffer = `${currentEntry.terminalBuffer}${data}`;
        const limitReached = Buffer.byteLength(appendedBuffer, 'utf-8') > maxBufferBytes;
        const nextEntry: SessionHistoryEntry = {
          ...currentEntry,
          session: {
            ...currentEntry.session,
            historyLimitReached: limitReached,
          },
          terminalBuffer: trimBufferToBytes(appendedBuffer, maxBufferBytes),
        };

        await saveEntries([
          nextEntry,
          ...entries.filter((entry) => entry.id !== sessionId),
        ]);
        return { limitReached };
      });
    },

    async readBuffer(sessionId: string): Promise<string> {
      return enqueue(async () =>
        (await listEntries()).find((entry) => entry.id === sessionId)?.terminalBuffer ?? '',
      );
    },

    async deleteSession(sessionId: string): Promise<void> {
      return enqueue(async () => {
        const entries = await listEntries();
        await saveEntries(entries.filter((entry) => entry.id !== sessionId));
      });
    },

    async archiveBuffer(sessionId: string): Promise<{ filePath: string }> {
      return enqueue(async () => {
        const entries = await listEntries();
        const existingEntry = entries.find((entry) => entry.id === sessionId);
        if (!existingEntry) {
          throw new Error('未找到指定的历史会话');
        }

        await mkdir(archiveDir, { recursive: true });
        const filePath = path.join(archiveDir, safeArchiveFileName(sessionId));
        await writeFile(filePath, existingEntry.terminalBuffer, 'utf-8');
        await updateSession(sessionId, (entry) => ({
          ...entry,
          session: {
            ...entry.session,
            historyLimitReached: false,
            historyArchivePath: filePath,
          },
          terminalBuffer: '',
        }));

        return { filePath };
      });
    },
  };
}
