import type { SessionRecordSnapshot } from '../shared/agentdockTypes.js';
import {
  SESSION_RECORD_CONTINUATION_DELAY_MS,
  type SessionRecordSessionState,
  type SessionRecordSyncClock,
  type SessionRecordSyncReason,
  type SessionRecordSyncScheduler as SchedulerContract,
} from './sessionRecordSyncContracts.js';

type Options = {
  clock: SessionRecordSyncClock;
  scheduler: SchedulerContract;
  isDisposing(): boolean;
  syncNow(sessionId: string, reason: SessionRecordSyncReason): Promise<SessionRecordSnapshot>;
};

export function createSessionRecordSyncScheduler(options: Options) {
  const { clock, scheduler } = options;

  function clearTimer(state: SessionRecordSessionState, key: 'debounceTimer' | 'retryTimer'): void {
    const handle = state[key];
    if (handle !== undefined) {
      scheduler.clear(handle);
      state[key] = undefined;
    }
  }

  function scheduleRetry(state: SessionRecordSessionState): void {
    if (options.isDisposing() || state.deleted || state.retryTimer !== undefined) return;
    const delay = state.retryDelaysMs[state.retryAttempt];
    if (delay === undefined) return;
    state.retryAttempt += 1;
    state.retryTimer = scheduler.set(() => {
      state.retryTimer = undefined;
      void options.syncNow(state.sessionId, 'retry').catch(() => undefined);
    }, delay);
  }

  function scheduleContinuation(state: SessionRecordSessionState, force = false): void {
    if (
      options.isDisposing()
      || state.deleted
      || (!force && !state.hasMore)
      || state.debounceTimer !== undefined
    ) return;
    // Non-zero delay: a long backlog drain must yield the event loop between
    // batches instead of monopolizing the main thread at 0ms intervals.
    state.debounceTimer = scheduler.set(() => {
      state.debounceTimer = undefined;
      void options.syncNow(state.sessionId, 'retry').catch(() => undefined);
    }, SESSION_RECORD_CONTINUATION_DELAY_MS);
  }

  async function settleBeforeDeadline<T>(
    promise: Promise<T>,
    deadline: number,
  ): Promise<{ settled: true; value: T } | { settled: false }> {
    return new Promise((resolve) => {
      let finished = false;
      const timer = scheduler.set(() => {
        if (finished) return;
        finished = true;
        resolve({ settled: false });
      }, Math.max(0, deadline - clock.now().getTime()));
      promise.then(
        (value) => {
          if (finished) return;
          finished = true;
          scheduler.clear(timer);
          resolve({ settled: true, value });
        },
        () => {
          if (finished) return;
          finished = true;
          scheduler.clear(timer);
          resolve({ settled: false });
        },
      );
    });
  }

  function trackInFlight(
    state: SessionRecordSessionState,
    generation: number | undefined,
    promise: Promise<SessionRecordSnapshot>,
    started = true,
  ): void {
    state.inFlightGeneration = generation;
    state.inFlight = promise;
    state.inFlightStarted = started;
    const settled = (): void => {
      if (state.inFlight !== promise) return;
      const staleGeneration = state.inFlightGeneration !== undefined
        && state.inFlightGeneration !== state.generation;
      state.inFlight = undefined;
      state.inFlightGeneration = undefined;
      state.inFlightStarted = undefined;
      if (!staleGeneration) state.rollbackBase = undefined;
      if (state.pendingAfterFlight && !state.deleted && !options.isDisposing()) {
        state.pendingAfterFlight = false;
        scheduleContinuation(state, true);
      }
    };
    promise.then(settled, settled);
  }

  return {
    clearTimer,
    scheduleRetry,
    scheduleContinuation,
    settleBeforeDeadline,
    trackInFlight,
  };
}

export type SessionRecordSyncSchedulerRuntime = ReturnType<typeof createSessionRecordSyncScheduler>;
