import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession } from '../../shared/agentdockTypes.js';
import { createJsonStore } from './jsonStore.js';
import {
  createSessionTranscriptStore,
  SESSION_TRANSCRIPT_TAIL_BYTES,
  type SessionTranscriptStore,
} from './sessionTranscriptStore.js';

export const SESSION_HISTORY_BUFFER_LIMIT_BYTES = 5_000_000;
export const SESSION_HISTORY_COUNT_LIMIT = 50;
export const SESSION_TRANSCRIPT_TOTAL_LIMIT_BYTES = 1_000_000_000;

type SessionHistoryEntry = {
  id: string;
  session: AgentSession;
};

type LegacySessionHistoryEntry = SessionHistoryEntry & {
  terminalBuffer: string;
};

export type SessionHistoryStore = {
  listSessions(): Promise<AgentSession[]>;
  saveSession(session: AgentSession): Promise<void>;
  closeView(sessionId: string, viewId: string): Promise<void>;
  archiveSession(sessionId: string): Promise<void>;
  deleteRecord(sessionId: string): Promise<void>;
  appendOutput(sessionId: string, data: string): Promise<{ limitReached: boolean }>;
  readBuffer(sessionId: string): Promise<string>;
  deleteSession(sessionId: string): Promise<void>;
  archiveBuffer(sessionId: string): Promise<{ filePath: string }>;
};

type CreateSessionHistoryStoreOptions = {
  maxBufferBytes?: number;
  maxSessions?: number;
  maxTranscriptBytes?: number;
  transcriptStore?: SessionTranscriptStore;
};

function sortRecentFirst(entries: SessionHistoryEntry[]): SessionHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const aTime = Date.parse(a.session.exitedAt ?? a.session.startedAt);
    const bTime = Date.parse(b.session.exitedAt ?? b.session.startedAt);
    return bTime - aTime;
  });
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

async function recoverSessionHistoryEntries(filePath: string): Promise<Array<SessionHistoryEntry | LegacySessionHistoryEntry>> {
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
    return parsed as Array<SessionHistoryEntry | LegacySessionHistoryEntry>;
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
    return recovered as Array<SessionHistoryEntry | LegacySessionHistoryEntry>;
  }
}

export function createSessionHistoryStore(
  rootDir: string,
  {
    maxSessions = SESSION_HISTORY_COUNT_LIMIT,
    maxTranscriptBytes = SESSION_TRANSCRIPT_TOTAL_LIMIT_BYTES,
    transcriptStore = createSessionTranscriptStore(rootDir),
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

  async function sessionWithTranscriptMetadata(session: AgentSession): Promise<AgentSession> {
    const tail = await transcriptStore.readTail(session.id);
    return {
      ...session,
      historyLimitReached: false,
      transcript: {
        filePath: tail.filePath,
        byteSize: tail.byteSize,
        tailBytes: SESSION_TRANSCRIPT_TAIL_BYTES,
        tailTruncated: tail.truncated,
      },
    };
  }

  async function migrateLegacyEntries(
    entries: Array<SessionHistoryEntry | LegacySessionHistoryEntry>,
  ): Promise<SessionHistoryEntry[]> {
    const migratedEntries: SessionHistoryEntry[] = [];
    let changed = false;

    for (const entry of entries) {
      const legacyBuffer = 'terminalBuffer' in entry ? entry.terminalBuffer : undefined;
      if (legacyBuffer) {
        const existingTail = await transcriptStore.readTail(entry.id);
        if (existingTail.byteSize === 0) {
          await transcriptStore.appendOutput(entry.id, legacyBuffer);
        }
        changed = true;
      }

      const session = await sessionWithTranscriptMetadata(entry.session);
      migratedEntries.push({ id: entry.id, session });
      if ('terminalBuffer' in entry || JSON.stringify(entry.session.transcript) !== JSON.stringify(session.transcript)) {
        changed = true;
      }
    }

    const sortedEntries = sortRecentFirst(migratedEntries).slice(0, maxSessions);
    if (changed || sortedEntries.length !== entries.length) {
      await saveEntries(sortedEntries);
    }
    return sortedEntries;
  }

  function canDeleteSession(session: AgentSession): boolean {
    return session.status !== 'running' && session.status !== 'starting';
  }

  function totalTranscriptBytes(entries: SessionHistoryEntry[]): number {
    return entries.reduce((total, entry) => total + (entry.session.transcript?.byteSize ?? 0), 0);
  }

  async function cleanupEntries(entries: SessionHistoryEntry[]): Promise<SessionHistoryEntry[]> {
    const nextEntries = sortRecentFirst(entries);
    const deletedEntries: SessionHistoryEntry[] = [];

    function deleteOldestCandidate(): boolean {
      for (let index = nextEntries.length - 1; index >= 0; index -= 1) {
        if (canDeleteSession(nextEntries[index].session)) {
          deletedEntries.push(nextEntries[index]);
          nextEntries.splice(index, 1);
          return true;
        }
      }
      return false;
    }

    while (nextEntries.length > maxSessions && deleteOldestCandidate()) {
      // Keep deleting until the count limit is satisfied or only running sessions remain.
    }

    while (totalTranscriptBytes(nextEntries) > maxTranscriptBytes && deleteOldestCandidate()) {
      // Keep deleting until the byte limit is satisfied or only running sessions remain.
    }

    await Promise.all(deletedEntries.map((entry) => transcriptStore.deleteTranscript(entry.id)));
    return nextEntries;
  }

  async function listEntries(): Promise<SessionHistoryEntry[]> {
    return migrateLegacyEntries(await recoverSessionHistoryEntries(sessionsFilePath));
  }

  async function saveEntries(entries: SessionHistoryEntry[]): Promise<void> {
    await store.replaceAll(await cleanupEntries(entries));
  }

  async function saveSession(session: AgentSession): Promise<void> {
    const entries = await listEntries();
    const existingEntry = entries.find((entry) => entry.id === session.id);
    const nextEntry: SessionHistoryEntry = {
      id: session.id,
      session: await sessionWithTranscriptMetadata({
        ...existingEntry?.session,
        ...session,
      }),
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

    closeView(sessionId: string, viewId: string): Promise<void> {
      return enqueue(async () => {
        await updateSession(sessionId, (entry) => ({
          ...entry,
          session: {
            ...entry.session,
            closedViewIds: Array.from(new Set([...(entry.session.closedViewIds ?? []), viewId])),
          },
        }));
      });
    },

    archiveSession(sessionId: string): Promise<void> {
      return enqueue(async () => {
        await updateSession(sessionId, (entry) => ({
          ...entry,
          session: {
            ...entry.session,
            archived: true,
          },
        }));
      });
    },

    async appendOutput(sessionId: string, data: string): Promise<{ limitReached: boolean }> {
      return enqueue(async () => {
        const entries = await listEntries();
        const currentEntry = entries.find((entry) => entry.id === sessionId);
        if (!currentEntry) {
          return { limitReached: false };
        }
        await transcriptStore.appendOutput(sessionId, data);
        const nextEntry = {
          ...currentEntry,
          session: await sessionWithTranscriptMetadata(currentEntry.session),
        };

        await saveEntries([
          nextEntry,
          ...entries.filter((entry) => entry.id !== sessionId),
        ]);
        return { limitReached: false };
      });
    },

    async readBuffer(sessionId: string): Promise<string> {
      return enqueue(async () => (await transcriptStore.readTail(sessionId)).content);
    },

    async deleteRecord(sessionId: string): Promise<void> {
      return enqueue(async () => {
        const entries = await listEntries();
        await saveEntries(entries.filter((entry) => entry.id !== sessionId));
        await transcriptStore.deleteTranscript(sessionId);
      });
    },

    deleteSession(sessionId: string): Promise<void> {
      return this.deleteRecord(sessionId);
    },

    async archiveBuffer(sessionId: string): Promise<{ filePath: string }> {
      return enqueue(async () => {
        const entries = await listEntries();
        const existingEntry = entries.find((entry) => entry.id === sessionId);
        if (!existingEntry) {
          throw new Error('未找到指定的历史会话');
        }

        const output = (await transcriptStore.readTail(sessionId)).content;
        await mkdir(archiveDir, { recursive: true });
        const filePath = path.join(archiveDir, safeArchiveFileName(sessionId));
        await writeFile(filePath, output, 'utf-8');
        await transcriptStore.deleteTranscript(sessionId);
        await updateSession(sessionId, (entry) => ({
          ...entry,
          session: {
            ...entry.session,
            historyLimitReached: false,
            historyArchivePath: filePath,
          },
        }));

        return { filePath };
      });
    },
  };
}
