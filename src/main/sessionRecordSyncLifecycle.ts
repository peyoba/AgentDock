import type {
  SessionRecordEventDto,
  SessionRecordSnapshot,
} from '../shared/agentdockTypes.js';
import type { RecordSourceBinding } from './recordSources/types.js';
import type {
  SessionRecordFinalSyncReason,
  SessionRecordSessionState,
} from './sessionRecordSyncContracts.js';
import type { SessionRecordStoreCoordinator } from './sessionRecordStoreCoordinator.js';
import {
  normalizeSessionRecordTimestamp,
} from './stores/sessionRecordEventSchema.js';
import type { SessionRecordEventStore } from './stores/sessionRecordEventStore.js';
import {
  safeSessionRecordMessage,
  sameRecordSourceBinding,
  stableSessionRecordStatusEventId,
} from './sessionRecordSnapshot.js';

type SessionState = SessionRecordSessionState;

type Options = {
  store: SessionRecordEventStore;
  coordinator: SessionRecordStoreCoordinator;
  states: Map<string, SessionState>;
  clock: { now(): Date };
  finalSyncTimeoutMs: number;
  stateFor(sessionId: string): SessionState;
  enqueueControl<T>(state: SessionState, operation: () => Promise<T>): Promise<T>;
  clearTimer(state: SessionState, key: 'debounceTimer' | 'retryTimer'): void;
  settleBeforeDeadline<T>(
    promise: Promise<T>,
    deadline: number,
  ): Promise<{ settled: true; value: T } | { settled: false }>;
  finalSync(sessionId: string, reason: SessionRecordFinalSyncReason): Promise<SessionRecordSnapshot>;
};

export function createSessionRecordSyncLifecycle(options: Options) {
  let disposing = false;
  let disposed = false;
  let disposeInFlight: Promise<void> | undefined;

  /**
   * A stalled adapter read (network volume, iCloud placeholder) must never
   * block a lifecycle operation forever: wait a bounded time, then invalidate
   * the stuck generation and move on.
   */
  async function awaitInFlightBounded(state: SessionState): Promise<void> {
    const inFlight = state.inFlight;
    if (inFlight === undefined || state.inFlightStarted !== true) return;
    const deadline = options.clock.now().getTime() + options.finalSyncTimeoutMs;
    const settled = await options.settleBeforeDeadline(
      inFlight.then(() => undefined, () => undefined),
      deadline,
    );
    if (!settled.settled) {
      options.coordinator.invalidateForTimeout(state);
    }
  }

  async function bindState(state: SessionState, binding: RecordSourceBinding): Promise<void> {
    await awaitInFlightBounded(state);
    const previous = state.deleted
      ? undefined
      : await options.coordinator.readPrivateSnapshot(state);
    const previousBinding = state.binding ?? previous?.index.binding;
    const runChanged = previousBinding === undefined
      ? previous?.index.cursor !== undefined
      : !sameRecordSourceBinding(previousBinding, binding);
    await options.store.updateSyncState({
      sessionId: binding.sessionId,
      status: 'pending',
      binding,
      source: binding.source,
      ...(runChanged ? { cursor: undefined } : {}),
      message: undefined,
    });
    let committed;
    try {
      committed = await options.store.readSnapshot(binding.sessionId);
    } catch {
      committed = undefined;
    }
    state.generation += 1;
    state.binding = committed?.index.binding ?? binding;
    state.loaded = true;
    state.deleted = false;
    state.probed = false;
    state.capabilityStatus = undefined;
    state.hasMore = false;
    state.pendingAfterFlight = false;
    state.rollbackBase = undefined;
    state.statusOverride = undefined;
    state.retryAttempt = 0;
    options.clearTimer(state, 'debounceTimer');
    options.clearTimer(state, 'retryTimer');
    state.lastCommitted = committed;
  }

  function bind(binding: RecordSourceBinding): Promise<void> {
    if (disposing || disposed) return Promise.reject(new Error('同步服务已释放。'));
    const state = options.stateFor(binding.sessionId);
    return options.enqueueControl(state, () => bindState(state, binding));
  }

  async function appendStatusState(state: SessionState, input: {
    sessionId: string;
    runId: string;
    code: Extract<SessionRecordEventDto, { kind: 'status' }>['payload']['code'];
    text?: string;
    occurredAt: string;
  }): Promise<void> {
    if (state.deleted) return;
    const current = await options.coordinator.readPrivateSnapshot(state);
    const currentBinding = state.binding ?? current.index.binding;
    if (currentBinding !== undefined && currentBinding.runId !== input.runId) {
      throw new Error('会话状态与当前运行不匹配。');
    }
    const text = safeSessionRecordMessage(input.text);
    const occurredAt = normalizeSessionRecordTimestamp(input.occurredAt);
    const event: Extract<SessionRecordEventDto, { kind: 'status' }> = {
      eventId: stableSessionRecordStatusEventId({
        sessionId: input.sessionId,
        runId: input.runId,
        code: input.code,
        occurredAt,
        ...(text === undefined ? {} : { text }),
      }),
      sessionId: input.sessionId,
      runId: input.runId,
      occurredAt,
      timeSource: 'read',
      source: 'agentdock',
      trust: 'derived-status',
      truncated: false,
      kind: 'status',
      payload: {
        code: input.code,
        ...(text === undefined ? {} : { text }),
      },
    };
    state.lastCommitted = await options.store.appendStatus({
      sessionId: input.sessionId,
      runId: input.runId,
      event,
    });
  }

  function appendStatus(input: {
    sessionId: string;
    runId: string;
    code: Extract<SessionRecordEventDto, { kind: 'status' }>['payload']['code'];
    text?: string;
    occurredAt: string;
  }): Promise<void> {
    if (disposing || disposed) return Promise.resolve();
    const state = options.stateFor(input.sessionId);
    return options.enqueueControl(state, () => appendStatusState(state, input));
  }

  async function deleteSessionState(state: SessionState): Promise<void> {
    const sessionId = state.sessionId;
    const currentGeneration = state.generation;
    state.deleted = true;
    state.generation += 1;
    options.clearTimer(state, 'debounceTimer');
    options.clearTimer(state, 'retryTimer');
    const inFlight = state.inFlightStarted === true
      && state.inFlightGeneration === currentGeneration
      ? state.inFlight
      : undefined;
    if (inFlight !== undefined) {
      const deadline = options.clock.now().getTime() + options.finalSyncTimeoutMs;
      await options.settleBeforeDeadline(
        inFlight.then(() => undefined, () => undefined),
        deadline,
      );
    }
    await options.store.deleteSession(sessionId);
    state.binding = undefined;
    state.loaded = true;
    state.probed = false;
    state.capabilityStatus = undefined;
    state.hasMore = false;
    state.pendingAfterFlight = false;
    state.rollbackBase = undefined;
    state.lastCommitted = undefined;
    state.statusOverride = undefined;
  }

  function deleteSession(sessionId: string): Promise<void> {
    if (disposing || disposed) return Promise.resolve();
    const state = options.stateFor(sessionId);
    const queued = options.enqueueControl(state, () => deleteSessionState(state));
    // The wall-clock deadline covers the control-queue wait as well: a hung
    // earlier operation must not make the delete IPC handler wait forever.
    const deadline = options.clock.now().getTime() + 2 * options.finalSyncTimeoutMs;
    return (async () => {
      const settled = await options.settleBeforeDeadline(
        queued.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
        deadline,
      );
      if (!settled.settled) {
        options.coordinator.invalidateForTimeout(state);
        throw new Error('删除会话记录超时。');
      }
      if (!settled.value.ok) throw settled.value.error;
    })();
  }

  function dispose(): Promise<void> {
    if (disposeInFlight !== undefined) return disposeInFlight;
    if (disposed) return Promise.resolve();
    disposing = true;
    const promise = (async () => {
      try {
        const currentStates = [...options.states.values()];
        for (const state of currentStates) {
          options.clearTimer(state, 'debounceTimer');
          options.clearTimer(state, 'retryTimer');
        }
        await Promise.all(currentStates.map(async (state) => {
          if (state.deleted) return;
          // One failing session must not leave the service half-disposed.
          await options.finalSync(state.sessionId, 'dispose').catch(() => undefined);
          await state.timeoutCleanup?.catch(() => undefined);
        }));
      } finally {
        disposed = true;
      }
    })();
    disposeInFlight = promise;
    return promise;
  }

  return {
    bind,
    appendStatus,
    deleteSession,
    dispose,
    isDisposing: () => disposing,
    isDisposed: () => disposed,
  };
}

export type SessionRecordSyncLifecycle = ReturnType<typeof createSessionRecordSyncLifecycle>;
