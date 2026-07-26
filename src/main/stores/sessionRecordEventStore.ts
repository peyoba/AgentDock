import type {
  SessionRecordEventDto,
  SessionRecordSyncStatus,
} from '../../shared/agentdockTypes.js';
import type { RecordSourceBinding } from '../recordSources/types.js';
import {
  SESSION_RECORD_FILE_MAX_BYTES,
  SESSION_RECORD_MAX_EVENTS,
  nativeSourceFromEntries,
  publicSessionRecordError,
  retainLatestSessionRecordEvents,
  safeSessionRecordError,
  serializeSessionRecordEvent,
  type NativeRecordSource,
  type SerializedSessionRecordEvent,
} from './sessionRecordEventCodec.js';
import {
  appendSessionRecordEvents,
  deleteSessionRecordFiles,
  loadSessionRecordFiles,
  replaceSessionRecordEvents,
  writeSessionRecordIndex,
  type LoadedSessionRecordFiles,
} from './sessionRecordEventFiles.js';
import {
  assertSafeSessionRecordId,
  normalizeSessionRecordEvent,
  prepareSessionRecordAppendBatch,
  prepareSessionRecordStatusAppend,
  prepareSessionRecordSyncStateUpdate,
} from './sessionRecordEventSchema.js';

export {
  SESSION_RECORD_BATCH_MAX_BYTES,
  SESSION_RECORD_BATCH_MAX_EVENTS,
  SESSION_RECORD_EVENT_MAX_BYTES,
  SESSION_RECORD_EVENTS_READ_MAX_BYTES,
  SESSION_RECORD_FILE_MAX_BYTES,
  SESSION_RECORD_INDEX_MAX_BYTES,
  SESSION_RECORD_MAX_EVENTS,
} from './sessionRecordEventCodec.js';

export type SessionRecordIndex = {
  schemaVersion: 1;
  source?: NativeRecordSource;
  binding?: RecordSourceBinding;
  cursor?: string;
  seenEventKeys: string[];
  status: SessionRecordSyncStatus;
  lastSyncedAt?: string;
  message?: string;
  truncated: boolean;
};

export type SessionRecordEventStore = {
  appendBatch(input: SessionRecordAppendBatch, options?: SessionRecordStoreWriteOptions): Promise<SessionRecordStoreSnapshot>;
  appendStatus(input: SessionRecordStatusAppend, options?: SessionRecordStoreWriteOptions): Promise<SessionRecordStoreSnapshot>;
  readSnapshot(sessionId: string): Promise<SessionRecordStoreSnapshot>;
  updateSyncState(input: SessionRecordSyncStateUpdate, options?: SessionRecordStoreWriteOptions): Promise<void>;
  /** Restore a stale write only when the current private version still matches it. */
  restoreSnapshotIfCurrent(
    input: SessionRecordSnapshotRestore,
    options?: SessionRecordStoreWriteOptions,
  ): Promise<boolean>;
  deleteSession(sessionId: string): Promise<void>;
};

/** Optional generation/deadline guard used by background sync commits. */
export type SessionRecordStoreWriteOptions = {
  guard?: () => boolean;
};

export type SessionRecordAppendBatch = {
  sessionId: string;
  source: NativeRecordSource;
  runId: string;
  cursor?: string;
  status: SessionRecordSyncStatus;
  events: SessionRecordEventDto[];
  syncedAt: string;
  message?: string;
};

export type SessionRecordStatusAppend = {
  sessionId: string;
  runId: string;
  event: Extract<SessionRecordEventDto, { kind: 'status' }>;
};

export type SessionRecordSyncStateUpdate = {
  sessionId: string;
  status: SessionRecordSyncStatus;
  binding?: RecordSourceBinding;
  cursor?: string;
  source?: NativeRecordSource;
  lastSyncedAt?: string;
  message?: string;
  truncated?: boolean;
};

export type SessionRecordStoreSnapshot = {
  events: SessionRecordEventDto[];
  index: SessionRecordIndex;
  byteSize: number;
};

export type SessionRecordSnapshotRestore = {
  sessionId: string;
  expected: SessionRecordStoreSnapshot;
  restore: SessionRecordStoreSnapshot;
};

function privateStoreSnapshot(loaded: LoadedSessionRecordFiles): SessionRecordStoreSnapshot {
  return {
    events: loaded.entries.map(({ event }) => event),
    index: loaded.index,
    byteSize: loaded.byteSize,
  };
}

function serializedEntriesForSnapshot(
  snapshot: SessionRecordStoreSnapshot,
): SerializedSessionRecordEvent[] {
  return snapshot.events.map(
    (event) => serializeSessionRecordEvent(normalizeSessionRecordEvent(event), false),
  );
}

function sameRollbackVersion(
  loaded: LoadedSessionRecordFiles,
  expected: SessionRecordStoreSnapshot,
  expectedEntries: readonly SerializedSessionRecordEvent[],
): boolean {
  if (loaded.entries.length !== expectedEntries.length) return false;
  if (!loaded.entries.every((entry, index) => entry.line === expectedEntries[index].line)) return false;
  // A timeout marker may update status/message while an outer adapter Promise is
  // still settling. Cursor/source/binding/event fields must remain identical.
  const comparableIndex = (index: SessionRecordIndex) => ({
    schemaVersion: index.schemaVersion,
    source: index.source,
    binding: index.binding,
    cursor: index.cursor,
    seenEventKeys: index.seenEventKeys,
    lastSyncedAt: index.lastSyncedAt,
    truncated: index.truncated,
  });
  return JSON.stringify(comparableIndex(loaded.index))
    === JSON.stringify(comparableIndex(expected.index));
}

function assertSessionRecordWritable(loaded: LoadedSessionRecordFiles): void {
  if (loaded.middleCorruption) {
    throw safeSessionRecordError('会话记录事件文件损坏，无法写入。');
  }
}

function assertCommitAllowed(options: SessionRecordStoreWriteOptions | undefined): void {
  if (options?.guard !== undefined && !options.guard()) {
    throw safeSessionRecordError('会话记录提交已失效。');
  }
}

export function createSessionRecordEventStore(rootDir: string): SessionRecordEventStore {
  const queues = new Map<string, Promise<void>>();

  function enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const tracked = next.then(
      () => {
        if (queues.get(sessionId) === tracked) {
          queues.delete(sessionId);
        }
      },
      () => {
        if (queues.get(sessionId) === tracked) {
          queues.delete(sessionId);
        }
      },
    );
    queues.set(sessionId, tracked);
    return next;
  }

  async function appendPrepared(
    sessionId: string,
    loaded: LoadedSessionRecordFiles,
    serializedEvents: readonly SerializedSessionRecordEvent[],
    nextIndex: SessionRecordIndex,
    options?: SessionRecordStoreWriteOptions,
  ): Promise<SessionRecordStoreSnapshot> {
    assertSessionRecordWritable(loaded);
    assertCommitAllowed(options);
    const existingKeys = new Set(loaded.index.seenEventKeys);
    const newEntries = serializedEvents.filter(({ eventKey }) => !existingKeys.has(eventKey));
    const combinedEntries = [...loaded.entries, ...newEntries];
    const appendedByteSize = newEntries.reduce((total, entry) => total + entry.lineBytes, 0);
    const exceedsRetention = combinedEntries.length > SESSION_RECORD_MAX_EVENTS
      || loaded.byteSize + appendedByteSize > SESSION_RECORD_FILE_MAX_BYTES;

    let retainedEntries = combinedEntries;
    let byteSize = loaded.byteSize;
    let truncatedByRetention = false;
    if (exceedsRetention) {
      const retained = retainLatestSessionRecordEvents(combinedEntries);
      retainedEntries = retained.entries;
      byteSize = await replaceSessionRecordEvents(rootDir, sessionId, retainedEntries);
      truncatedByRetention = retained.dropped;
    } else if (newEntries.length > 0) {
      await appendSessionRecordEvents(rootDir, sessionId, newEntries);
      byteSize += appendedByteSize;
    }

    if (options?.guard !== undefined && !options.guard()) {
      // Restore the last complete version before exposing an aborted commit.
      await replaceSessionRecordEvents(rootDir, sessionId, loaded.entries);
      await writeSessionRecordIndex(rootDir, sessionId, loaded.index);
      throw safeSessionRecordError('会话记录提交已失效。');
    }

    const persistedIndex: SessionRecordIndex = {
      ...nextIndex,
      seenEventKeys: retainedEntries.map(({ eventKey }) => eventKey),
      truncated: nextIndex.truncated || loaded.index.truncated || truncatedByRetention,
    };
    await writeSessionRecordIndex(rootDir, sessionId, persistedIndex);
    if (options?.guard !== undefined && !options.guard()) {
      await replaceSessionRecordEvents(rootDir, sessionId, loaded.entries);
      await writeSessionRecordIndex(rootDir, sessionId, loaded.index);
      throw safeSessionRecordError('会话记录提交已失效。');
    }
    return {
      events: retainedEntries.map(({ event }) => event),
      index: persistedIndex,
      byteSize,
    };
  }

  return {
    appendBatch(input, options): Promise<SessionRecordStoreSnapshot> {
      let prepared: ReturnType<typeof prepareSessionRecordAppendBatch>;
      try {
        prepared = prepareSessionRecordAppendBatch(input);
      } catch (error) {
        return Promise.reject(publicSessionRecordError(error));
      }
      return enqueue(prepared.sessionId, async () => {
        assertCommitAllowed(options);
        const loaded = await loadSessionRecordFiles(rootDir, prepared.sessionId);
        assertCommitAllowed(options);
        assertSessionRecordWritable(loaded);
        if (
          (loaded.index.source !== undefined && loaded.index.source !== prepared.source)
          || (loaded.index.binding !== undefined && loaded.index.binding.source !== prepared.source)
        ) {
          throw safeSessionRecordError('会话记录来源与已有记录不匹配。');
        }

        const { message: _oldMessage, ...indexWithoutMessage } = loaded.index;
        let nextIndex: SessionRecordIndex = {
          ...indexWithoutMessage,
          source: prepared.source,
          status: prepared.status,
          lastSyncedAt: prepared.syncedAt,
          ...(prepared.message === undefined ? {} : { message: prepared.message }),
        };
        if (prepared.hasCursor) {
          const { cursor: _oldCursor, ...indexWithoutCursor } = nextIndex;
          nextIndex = prepared.cursor === undefined
            ? indexWithoutCursor
            : { ...indexWithoutCursor, cursor: prepared.cursor };
        }
        return appendPrepared(
          prepared.sessionId,
          loaded,
          prepared.serializedEvents,
          nextIndex,
          options,
        );
      }).catch((error) => {
        throw publicSessionRecordError(error);
      });
    },

    appendStatus(input, options): Promise<SessionRecordStoreSnapshot> {
      let prepared: ReturnType<typeof prepareSessionRecordStatusAppend>;
      try {
        prepared = prepareSessionRecordStatusAppend(input);
      } catch (error) {
        return Promise.reject(publicSessionRecordError(error));
      }
      return enqueue(prepared.sessionId, async () => {
        assertCommitAllowed(options);
        const loaded = await loadSessionRecordFiles(rootDir, prepared.sessionId);
        assertCommitAllowed(options);
        assertSessionRecordWritable(loaded);
        if (loaded.index.seenEventKeys.includes(prepared.serializedEvent.eventKey)) {
          return privateStoreSnapshot(loaded);
        }
        return appendPrepared(
          prepared.sessionId,
          loaded,
          [prepared.serializedEvent],
          loaded.index,
          options,
        );
      }).catch((error) => {
        throw publicSessionRecordError(error);
      });
    },

    readSnapshot(sessionId): Promise<SessionRecordStoreSnapshot> {
      try {
        assertSafeSessionRecordId(sessionId);
      } catch (error) {
        return Promise.reject(publicSessionRecordError(error));
      }
      return enqueue(
        sessionId,
        async () => privateStoreSnapshot(await loadSessionRecordFiles(rootDir, sessionId)),
      ).catch((error) => {
        throw publicSessionRecordError(error);
      });
    },

    updateSyncState(input, options): Promise<void> {
      let prepared: ReturnType<typeof prepareSessionRecordSyncStateUpdate>;
      try {
        prepared = prepareSessionRecordSyncStateUpdate(input);
      } catch (error) {
        return Promise.reject(publicSessionRecordError(error));
      }
      return enqueue(prepared.sessionId, async () => {
        assertCommitAllowed(options);
        const loaded = await loadSessionRecordFiles(rootDir, prepared.sessionId);
        assertCommitAllowed(options);
        // 中段损坏冻结事件写入，但 status/message/lastSyncedAt 只落 index.json，
        // 不触碰 events.jsonl —— 放行它们才能按 SPEC §8.3 持久化失败/退避状态。
        // 推进 cursor 或改写 binding/source 属于同步进度，损坏时仍然拒绝。
        const syncProgressUpdate = prepared.hasCursor || prepared.hasBinding || prepared.hasSource;
        if (syncProgressUpdate) assertSessionRecordWritable(loaded);
        const eventSource = nativeSourceFromEntries(loaded.entries);
        const nextIndex: SessionRecordIndex = { ...loaded.index, status: prepared.status };

        if (prepared.hasBinding) {
          if (prepared.binding === undefined) {
            delete nextIndex.binding;
          } else {
            nextIndex.binding = prepared.binding;
          }
        }
        if (prepared.hasSource) {
          if (prepared.source === undefined) {
            delete nextIndex.source;
          } else {
            nextIndex.source = prepared.source;
          }
        }
        const bindingSource = nextIndex.binding?.source;
        if (eventSource !== undefined && bindingSource !== undefined && eventSource !== bindingSource) {
          throw safeSessionRecordError('会话记录同步来源不匹配。');
        }
        const persistedSource = eventSource ?? bindingSource;
        if (
          persistedSource !== undefined
          && nextIndex.source !== undefined
          && nextIndex.source !== persistedSource
        ) {
          throw safeSessionRecordError('会话记录同步来源不匹配。');
        }
        if (persistedSource !== undefined) {
          nextIndex.source = persistedSource;
        }

        if (prepared.hasCursor) {
          prepared.cursor === undefined
            ? delete nextIndex.cursor
            : nextIndex.cursor = prepared.cursor;
        }
        if (prepared.hasLastSyncedAt) {
          prepared.lastSyncedAt === undefined
            ? delete nextIndex.lastSyncedAt
            : nextIndex.lastSyncedAt = prepared.lastSyncedAt;
        }
        if (prepared.hasMessage) {
          prepared.message === undefined
            ? delete nextIndex.message
            : nextIndex.message = prepared.message;
        }
        nextIndex.truncated = loaded.index.truncated
          || (prepared.hasTruncated && prepared.truncated === true);
        await writeSessionRecordIndex(rootDir, prepared.sessionId, nextIndex);
        if (options?.guard !== undefined && !options.guard()) {
          await writeSessionRecordIndex(rootDir, prepared.sessionId, loaded.index);
          throw safeSessionRecordError('会话记录提交已失效。');
        }
      }).catch((error) => {
        throw publicSessionRecordError(error);
      });
    },

    restoreSnapshotIfCurrent(input, options): Promise<boolean> {
      let sessionId: string;
      try {
        assertSafeSessionRecordId(input.sessionId);
        sessionId = input.sessionId;
      } catch (error) {
        return Promise.reject(publicSessionRecordError(error));
      }
      let expectedEntries: SerializedSessionRecordEvent[];
      let restoreEntries: SerializedSessionRecordEvent[];
      try {
        expectedEntries = serializedEntriesForSnapshot(input.expected);
        restoreEntries = serializedEntriesForSnapshot(input.restore);
      } catch (error) {
        return Promise.reject(publicSessionRecordError(error));
      }
      return enqueue(sessionId, async () => {
        assertCommitAllowed(options);
        const loaded = await loadSessionRecordFiles(rootDir, sessionId);
        assertSessionRecordWritable(loaded);
        assertCommitAllowed(options);
        if (
          input.expected.events.some((event) => event.sessionId !== sessionId)
          || input.restore.events.some((event) => event.sessionId !== sessionId)
        ) {
          throw safeSessionRecordError('会话记录回滚目标不匹配。');
        }
        if (!sameRollbackVersion(loaded, input.expected, expectedEntries)) return false;
        const {
          status: _restoreStatus,
          message: _restoreMessage,
          ...restoreIndex
        } = input.restore.index;
        const restoredIndex: SessionRecordIndex = {
          ...restoreIndex,
          // Preserve a durable timeout/failure marker written while the outer
          // adapter Promise was still pending.
          status: loaded.index.status,
          ...(loaded.index.message === undefined ? {} : { message: loaded.index.message }),
        };
        try {
          await replaceSessionRecordEvents(rootDir, sessionId, restoreEntries);
          assertCommitAllowed(options);
          await writeSessionRecordIndex(rootDir, sessionId, restoredIndex);
          assertCommitAllowed(options);
        } catch (error) {
          await replaceSessionRecordEvents(rootDir, sessionId, loaded.entries);
          await writeSessionRecordIndex(rootDir, sessionId, loaded.index);
          throw error;
        }
        return true;
      }).catch((error) => {
        throw publicSessionRecordError(error);
      });
    },

    deleteSession(sessionId): Promise<void> {
      try {
        assertSafeSessionRecordId(sessionId);
      } catch (error) {
        return Promise.reject(publicSessionRecordError(error));
      }
      return enqueue(
        sessionId,
        async () => deleteSessionRecordFiles(rootDir, sessionId),
      ).catch((error) => {
        throw publicSessionRecordError(error);
      });
    },
  };
}
