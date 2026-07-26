import type { SessionRecordSnapshot } from '../shared/agentdockTypes.js';
import type {
  RecordSourceAdapter,
  RecordSourceBinding,
} from './recordSources/types.js';
import { createSessionRecordBatchSynchronizer } from './sessionRecordBatchSynchronizer.js';
import { createSessionRecordStoreCoordinator } from './sessionRecordStoreCoordinator.js';
import { createSessionRecordSyncLifecycle } from './sessionRecordSyncLifecycle.js';
import { createSessionRecordSyncScheduler } from './sessionRecordSyncScheduler.js';
import {
  DEFAULT_SESSION_RECORD_CLOCK,
  DEFAULT_SESSION_RECORD_RETRY_DELAYS_MS,
  DEFAULT_SESSION_RECORD_SCHEDULER,
  SESSION_RECORD_FINAL_SYNC_TIMEOUT_MS,
  type SessionRecordFinalSyncReason,
  type SessionRecordScheduleReason,
  type SessionRecordSessionState,
  type SessionRecordSyncReason,
  type SessionRecordSyncService,
  type SessionRecordSyncServiceOptions,
} from './sessionRecordSyncContracts.js';
import {
  buildSessionRecordRestoreMaterial,
  defaultSessionRecordSnapshot,
  sessionRecordNowMs,
  SESSION_RECORD_LIST_DEFAULT_LIMIT,
  SESSION_RECORD_LIST_MAX_LIMIT,
  type SessionRecordSnapshotWindow,
} from './sessionRecordSnapshot.js';

export {
  DEFAULT_SESSION_RECORD_RETRY_DELAYS_MS,
  SESSION_RECORD_FINAL_SYNC_TIMEOUT_MS,
  SESSION_RECORD_RESTORE_MAX_CHARS,
  SESSION_RECORD_STATUS_MESSAGE_MAX_CHARS,
} from './sessionRecordSyncContracts.js';
export type {
  SessionRecordFinalSyncReason,
  SessionRecordScheduleReason,
  SessionRecordSyncClock,
  SessionRecordSyncReason,
  SessionRecordSyncScheduler,
  SessionRecordSyncService,
  SessionRecordSyncServiceOptions,
} from './sessionRecordSyncContracts.js';

type SessionState = SessionRecordSessionState;

function assertSessionId(sessionId: string): void {
  if (
    typeof sessionId !== 'string'
    || sessionId.length === 0
    || sessionId.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)
  ) {
    throw new Error('会话 ID 无效。');
  }
}

export function createSessionRecordSyncService(
  options: SessionRecordSyncServiceOptions,
): SessionRecordSyncService {
  const clock = options.clock ?? DEFAULT_SESSION_RECORD_CLOCK;
  const scheduler = options.scheduler ?? DEFAULT_SESSION_RECORD_SCHEDULER;
  const retryDelaysMs = Object.freeze([...(options.retryDelaysMs ?? DEFAULT_SESSION_RECORD_RETRY_DELAYS_MS)]);
  const finalSyncTimeoutMs = options.finalSyncTimeoutMs ?? SESSION_RECORD_FINAL_SYNC_TIMEOUT_MS;
  if (!Number.isFinite(finalSyncTimeoutMs) || finalSyncTimeoutMs <= 0) {
    throw new Error('最终同步超时时间无效。');
  }
  if (retryDelaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
    throw new Error('同步重试间隔无效。');
  }
  const adapters = new Map<RecordSourceBinding['source'], RecordSourceAdapter>();
  for (const adapter of options.adapters) {
    if (adapters.has(adapter.source)) {
      throw new Error(`记录来源适配器重复：${adapter.source}`);
    }
    adapters.set(adapter.source, adapter);
  }

  const states = new Map<string, SessionState>();
  const coordinator = createSessionRecordStoreCoordinator({ store: options.store, clock });

  function stateFor(sessionId: string): SessionState {
    assertSessionId(sessionId);
    const existing = states.get(sessionId);
    if (existing) return existing;
    const state: SessionState = {
      sessionId,
      loaded: false,
      deleted: false,
      generation: 0,
      retryAttempt: 0,
      retryDelaysMs,
      probed: false,
      hasMore: false,
      pendingAfterFlight: false,
      controlTail: Promise.resolve(),
    };
    states.set(sessionId, state);
    return state;
  }

  function enqueueControl<T>(state: SessionState, operation: () => Promise<T>): Promise<T> {
    const next = state.controlTail.catch(() => undefined).then(operation);
    state.controlTail = next.then(() => undefined, () => undefined);
    return next;
  }

  let lifecycle!: ReturnType<typeof createSessionRecordSyncLifecycle>;
  const schedulerRuntime = createSessionRecordSyncScheduler({
    clock,
    scheduler,
    isDisposing: () => lifecycle.isDisposing(),
    syncNow,
  });
  lifecycle = createSessionRecordSyncLifecycle({
    store: options.store,
    coordinator,
    states,
    clock,
    finalSyncTimeoutMs,
    stateFor,
    enqueueControl,
    clearTimer: schedulerRuntime.clearTimer,
    settleBeforeDeadline: schedulerRuntime.settleBeforeDeadline,
    finalSync,
  });
  const {
    clearTimer,
    scheduleRetry,
    scheduleContinuation,
    settleBeforeDeadline,
    trackInFlight,
  } = schedulerRuntime;
  const batchSynchronizer = createSessionRecordBatchSynchronizer({
    adapters,
    store: options.store,
    clock,
    coordinator,
    scheduleRetry,
    scheduleContinuation,
    clearRetry: (state) => clearTimer(state, 'retryTimer'),
  });
  const { snapshotFor, invalidateForTimeout } = coordinator;
  const { performSync, handleFailure } = batchSynchronizer;

  async function syncNow(sessionId: string, reason: SessionRecordSyncReason): Promise<SessionRecordSnapshot> {
    const state = stateFor(sessionId);
    if (lifecycle.isDisposing()) return snapshotFor(state);
    if (state.deleted) return defaultSessionRecordSnapshot(sessionId, 'unavailable');
    if (
      state.inFlight !== undefined
      && (state.inFlightStarted === false || state.inFlightGeneration === state.generation)
    ) {
      state.pendingAfterFlight = true;
      return state.inFlight;
    }
    let generation = state.generation;
    const promise = state.controlTail
      .catch(() => undefined)
      .then(() => {
        generation = state.generation;
        if (state.inFlight === promise) {
          state.inFlightStarted = true;
          state.inFlightGeneration = generation;
        }
        if (lifecycle.isDisposing() || state.deleted) return snapshotFor(state);
        return performSync(state, reason, generation);
      })
      .catch(async (error) => {
        return handleFailure(
          state,
          generation,
          error instanceof Error ? error.message : '同步失败。',
          false,
        );
      });
    trackInFlight(state, undefined, promise, false);
    return promise;
  }

  function schedule(sessionId: string, _reason: SessionRecordScheduleReason): void {
    if (lifecycle.isDisposing() || lifecycle.isDisposed()) return;
    const state = stateFor(sessionId);
    if (state.deleted || state.debounceTimer !== undefined) return;
    if (state.inFlight !== undefined) state.pendingAfterFlight = true;
    state.debounceTimer = scheduler.set(() => {
      state.debounceTimer = undefined;
      void syncNow(sessionId, 'opened').catch(() => undefined);
    }, 250);
  }

  async function runFinalBatch(
    state: SessionState,
    deadline: number,
  ): Promise<{ timedOut: boolean; snapshot: SessionRecordSnapshot }> {
    const generation = state.generation;
    const promise = performSync(state, 'manual', generation, deadline);
    trackInFlight(state, generation, promise);
    const settled = await settleBeforeDeadline(promise, deadline);
    if (settled.settled) return { timedOut: false, snapshot: settled.value };
    return {
      timedOut: true,
      snapshot: invalidateForTimeout(state),
    };
  }

  async function finalSyncState(
    state: SessionState,
    _reason: SessionRecordFinalSyncReason,
  ): Promise<SessionRecordSnapshot> {
    const sessionId = state.sessionId;
    if (state.deleted) return defaultSessionRecordSnapshot(sessionId, 'unavailable');
    clearTimer(state, 'debounceTimer');
    clearTimer(state, 'retryTimer');
    const deadline = sessionRecordNowMs(clock) + finalSyncTimeoutMs;
    const invalidatedInFlight = state.inFlightStarted === true
      && state.inFlightGeneration !== undefined
      && state.inFlightGeneration !== state.generation;
    if (invalidatedInFlight) {
      await state.timeoutCleanup?.catch(() => undefined);
      return coordinator.cachedSnapshotFor(state, state.statusOverride?.status ?? 'stale');
    }
    const initial = state.inFlightStarted === true ? state.inFlight : undefined;
    if (initial !== undefined) {
      const settled = await settleBeforeDeadline(initial, deadline);
      if (!settled.settled) {
        return invalidateForTimeout(state);
      }
    }
    clearTimer(state, 'debounceTimer');
    if (sessionRecordNowMs(clock) >= deadline) {
      return invalidateForTimeout(state);
    }
    let batch = await runFinalBatch(state, deadline);
    let result = batch.snapshot;
    if (batch.timedOut) return result;
    while (state.hasMore && sessionRecordNowMs(clock) < deadline) {
      batch = await runFinalBatch(state, deadline);
      result = batch.snapshot;
      if (
        batch.timedOut
        || result.status === 'failed'
        || result.status === 'stale'
        || result.status === 'unavailable'
      ) {
        break;
      }
    }
    if (state.hasMore && sessionRecordNowMs(clock) >= deadline) {
      return invalidateForTimeout(state);
    }
    return result;
  }

  function finalSync(
    sessionId: string,
    reason: SessionRecordFinalSyncReason,
  ): Promise<SessionRecordSnapshot> {
    const state = stateFor(sessionId);
    if (lifecycle.isDisposed()) return snapshotFor(state);
    if (state.finalInFlight !== undefined) return state.finalInFlight;
    const queued = enqueueControl(state, () => finalSyncState(state, reason))
      .catch((error: unknown) => coordinator.timeoutFailure(
        state,
        error instanceof Error ? error.message : '最终同步失败。',
      ));
    // The deadline includes the control-queue wait: `before-quit` awaits this
    // call, so a hung earlier operation must not stop the app from exiting.
    const deadline = sessionRecordNowMs(clock) + 2 * finalSyncTimeoutMs;
    const promise = (async () => {
      const settled = await settleBeforeDeadline(queued, deadline);
      if (settled.settled) return settled.value;
      return invalidateForTimeout(state);
    })();
    state.finalInFlight = promise;
    promise.then(
      () => {
        if (state.finalInFlight === promise) state.finalInFlight = undefined;
      },
      () => {
        if (state.finalInFlight === promise) state.finalInFlight = undefined;
      },
    );
    return promise;
  }

  async function getSnapshot(
    sessionId: string,
    window?: SessionRecordSnapshotWindow,
  ): Promise<SessionRecordSnapshot> {
    const state = stateFor(sessionId);
    // The public surface is always paged: without an explicit window the
    // caller gets the latest default page, never an unbounded event list.
    return snapshotFor(state, window ?? { limit: SESSION_RECORD_LIST_DEFAULT_LIMIT });
  }

  async function buildRestoreMaterial(sessionId: string): Promise<string | undefined> {
    return buildSessionRecordRestoreMaterial(
      await getSnapshot(sessionId, { limit: SESSION_RECORD_LIST_MAX_LIMIT }),
    );
  }

  return {
    bind: lifecycle.bind,
    appendStatus: lifecycle.appendStatus,
    schedule,
    syncNow,
    finalSync,
    getSnapshot,
    buildRestoreMaterial,
    deleteSession: lifecycle.deleteSession,
    dispose: lifecycle.dispose,
  };
}
