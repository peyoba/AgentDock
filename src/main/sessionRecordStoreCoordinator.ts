import type {
  SessionRecordEventDto,
  SessionRecordSnapshot,
  SessionRecordSyncStatus,
} from '../shared/agentdockTypes.js';
import type { RecordSourceBinding } from './recordSources/types.js';
import {
  defaultSessionRecordSnapshot,
  publicSessionRecordSnapshot,
  safeSessionRecordMessage,
  sessionRecordNowMs,
  stableSessionRecordStatusEventId,
  type SessionRecordSnapshotWindow,
} from './sessionRecordSnapshot.js';
import type {
  SessionRecordSessionState,
  SessionRecordSyncClock,
} from './sessionRecordSyncContracts.js';
import type {
  SessionRecordEventStore,
  SessionRecordSnapshotRestore,
  SessionRecordStoreSnapshot,
  SessionRecordStoreWriteOptions,
} from './stores/sessionRecordEventStore.js';

type Options = {
  store: SessionRecordEventStore;
  clock: SessionRecordSyncClock;
};

export function createSessionRecordStoreCoordinator({ store, clock }: Options) {
  function isCurrent(state: SessionRecordSessionState, generation: number): boolean {
    return !state.deleted && state.generation === generation;
  }

  function writeGuard(
    state: SessionRecordSessionState,
    generation: number,
    deadline?: number,
  ): SessionRecordStoreWriteOptions {
    return {
      guard: () => isCurrent(state, generation)
        && (deadline === undefined || sessionRecordNowMs(clock) < deadline),
    };
  }

  async function readPrivateSnapshot(
    state: SessionRecordSessionState,
  ): Promise<SessionRecordStoreSnapshot> {
    const snapshot = await store.readSnapshot(state.sessionId);
    if (!state.deleted) state.lastCommitted = snapshot;
    if (!state.loaded) {
      state.binding = snapshot.index.binding;
      state.loaded = true;
      state.hasMore = false;
      state.pendingAfterFlight = false;
    }
    return snapshot;
  }

  function withStatusOverride(
    state: SessionRecordSessionState,
    snapshot: SessionRecordStoreSnapshot,
  ): SessionRecordStoreSnapshot {
    if (state.statusOverride === undefined) return snapshot;
    return {
      ...snapshot,
      index: {
        ...snapshot.index,
        status: state.statusOverride.status,
        ...(state.statusOverride.message === undefined
          ? {}
          : { message: state.statusOverride.message }),
      },
    };
  }

  function cachedSnapshotFor(
    state: SessionRecordSessionState,
    fallbackStatus: SessionRecordSyncStatus = 'pending',
    window?: SessionRecordSnapshotWindow,
  ): SessionRecordSnapshot {
    if (state.deleted) return defaultSessionRecordSnapshot(state.sessionId, 'unavailable');
    if (state.lastCommitted !== undefined) {
      return publicSessionRecordSnapshot(
        state.sessionId,
        withStatusOverride(state, state.lastCommitted),
        window,
      );
    }
    const status = state.statusOverride?.status ?? fallbackStatus;
    const snapshot = defaultSessionRecordSnapshot(state.sessionId, status);
    const message = safeSessionRecordMessage(state.statusOverride?.message);
    return message === undefined ? snapshot : { ...snapshot, message };
  }

  async function snapshotFor(
    state: SessionRecordSessionState,
    window?: SessionRecordSnapshotWindow,
  ): Promise<SessionRecordSnapshot> {
    if (state.deleted) return defaultSessionRecordSnapshot(state.sessionId, 'unavailable');
    try {
      return publicSessionRecordSnapshot(
        state.sessionId,
        withStatusOverride(state, await readPrivateSnapshot(state)),
        window,
      );
    } catch {
      return cachedSnapshotFor(state, 'failed', window);
    }
  }

  function timeoutFailure(
    state: SessionRecordSessionState,
    message: string,
  ): SessionRecordSnapshot {
    const base = state.lastCommitted ?? {
      events: [],
      index: {
        schemaVersion: 1 as const,
        seenEventKeys: [],
        status: 'pending' as const,
        truncated: false,
      },
      byteSize: 0,
    } satisfies SessionRecordStoreSnapshot;
    const status: SessionRecordSyncStatus = base.events.length > 0 ? 'stale' : 'failed';
    state.statusOverride = { status, message: safeSessionRecordMessage(message) };
    return cachedSnapshotFor(state, status);
  }

  function invalidateForTimeout(state: SessionRecordSessionState): SessionRecordSnapshot {
    state.generation += 1;
    state.hasMore = false;
    state.pendingAfterFlight = false;
    const snapshot = timeoutFailure(state, '最终同步超时。');
    const generation = state.generation;
    const rollbackBase = state.rollbackBase;
    const prior = state.timeoutCleanup;
    const reconcile = rollbackBase === undefined
      ? undefined
      : reconcileTimeoutCommit(state, rollbackBase);
    const statusWrite = store.updateSyncState({
      sessionId: state.sessionId,
      status: snapshot.status,
      message: snapshot.message,
    }, {
      guard: () => isCurrent(state, generation),
    }).then(() => undefined, () => undefined);
    // Both writes start immediately; the cleanup chain only makes them
    // awaitable so dispose() cannot exit while the stale/failed marker is
    // still in flight.
    const cleanup = (async () => {
      await prior?.catch(() => undefined);
      await reconcile;
      await statusWrite;
    })();
    state.timeoutCleanup = cleanup;
    void cleanup.then(
      () => {
        if (state.timeoutCleanup === cleanup) {
          state.timeoutCleanup = undefined;
          if (rollbackBase !== undefined && state.rollbackBase === rollbackBase) {
            state.rollbackBase = undefined;
          }
        }
      },
      () => {
        if (state.timeoutCleanup === cleanup) {
          state.timeoutCleanup = undefined;
        }
      },
    );
    return snapshot;
  }

  async function rollbackStaleCommit(
    state: SessionRecordSessionState,
    expected: SessionRecordStoreSnapshot,
    restore: SessionRecordStoreSnapshot,
  ): Promise<void> {
    if (state.deleted) return;
    const input: SessionRecordSnapshotRestore = {
      sessionId: state.sessionId,
      expected,
      restore,
    };
    try {
      await store.restoreSnapshotIfCurrent(input, { guard: () => !state.deleted });
    } catch {
      // A newer generation or a newer write owns the store; never overwrite it.
    }
  }

  async function reconcileTimeoutCommit(
    state: SessionRecordSessionState,
    restore: SessionRecordStoreSnapshot,
  ): Promise<void> {
    if (state.deleted) return;
    try {
      const current = await store.readSnapshot(state.sessionId);
      await store.restoreSnapshotIfCurrent({
        sessionId: state.sessionId,
        expected: current,
        restore,
      }, { guard: () => !state.deleted });
    } catch {
      // A newer generation or a newer write owns the store.
    }
  }

  async function markState(
    state: SessionRecordSessionState,
    generation: number,
    status: SessionRecordSyncStatus,
    message?: string,
    deadline?: number,
  ): Promise<SessionRecordSnapshot> {
    if (!isCurrent(state, generation)) return snapshotFor(state);
    try {
      await store.updateSyncState({
        sessionId: state.sessionId,
        status,
        message: safeSessionRecordMessage(message),
      }, writeGuard(state, generation, deadline));
      state.statusOverride = undefined;
    } catch {
      // Preserve the last complete store version.
    }
    return snapshotFor(state);
  }

  /**
   * Write-only `syncing` marker.  Unlike markState it never reads the store
   * back — the caller does not need a snapshot, and re-parsing the full event
   * file for a transient marker is what made large drains block the main
   * thread (one extra full load per batch).
   */
  async function markSyncing(
    state: SessionRecordSessionState,
    generation: number,
    deadline?: number,
  ): Promise<void> {
    if (!isCurrent(state, generation)) return;
    try {
      await store.updateSyncState({
        sessionId: state.sessionId,
        status: 'syncing',
      }, writeGuard(state, generation, deadline));
      state.statusOverride = undefined;
    } catch {
      // Preserve the last complete store version.
    }
  }

  async function appendDerivedAvailabilityStatus(
    state: SessionRecordSessionState,
    generation: number,
    binding: RecordSourceBinding,
    code: 'failed' | 'waiting',
    text: string,
    deadline?: number,
  ): Promise<void> {
    if (!isCurrent(state, generation)) return;
    const safeText = safeSessionRecordMessage(text);
    const event: Extract<SessionRecordEventDto, { kind: 'status' }> = {
      eventId: stableSessionRecordStatusEventId({
        sessionId: binding.sessionId,
        runId: binding.runId,
        code,
        occurredAt: binding.startedAt,
      }),
      sessionId: binding.sessionId,
      runId: binding.runId,
      occurredAt: binding.startedAt,
      timeSource: 'read',
      source: 'agentdock',
      trust: 'derived-status',
      truncated: false,
      kind: 'status',
      payload: { code, ...(safeText === undefined ? {} : { text: safeText }) },
    };
    try {
      await store.appendStatus({
        sessionId: state.sessionId,
        runId: binding.runId,
        event,
      }, writeGuard(state, generation, deadline));
    } catch {
      // The index status remains authoritative.
    }
  }

  return {
    isCurrent,
    writeGuard,
    readPrivateSnapshot,
    cachedSnapshotFor,
    snapshotFor,
    timeoutFailure,
    invalidateForTimeout,
    rollbackStaleCommit,
    reconcileTimeoutCommit,
    markState,
    markSyncing,
    appendDerivedAvailabilityStatus,
  };
}

export type SessionRecordStoreCoordinator = ReturnType<typeof createSessionRecordStoreCoordinator>;
