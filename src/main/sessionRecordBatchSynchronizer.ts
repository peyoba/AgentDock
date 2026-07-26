import type {
  SessionRecordSnapshot,
  SessionRecordSyncStatus,
} from '../shared/agentdockTypes.js';
import type {
  RecordSourceAdapter,
  RecordSourceBatch,
  RecordSourceBinding,
  RecordSourceCapability,
} from './recordSources/types.js';
import {
  mergeRecordSourceBindingNativeId,
  publicSessionRecordSnapshot,
  safeSessionRecordMessage,
  sameRecordSourceBinding,
  sessionRecordNowIso,
  sessionRecordNowMs,
  sessionRecordStatusFromSource,
} from './sessionRecordSnapshot.js';
import type {
  SessionRecordSessionState,
  SessionRecordSyncClock,
  SessionRecordSyncReason,
} from './sessionRecordSyncContracts.js';
import type { SessionRecordStoreCoordinator } from './sessionRecordStoreCoordinator.js';
import type {
  SessionRecordEventStore,
  SessionRecordStoreSnapshot,
} from './stores/sessionRecordEventStore.js';

type Options = {
  adapters: Map<RecordSourceBinding['source'], RecordSourceAdapter>;
  store: SessionRecordEventStore;
  clock: SessionRecordSyncClock;
  coordinator: SessionRecordStoreCoordinator;
  scheduleRetry(state: SessionRecordSessionState): void;
  scheduleContinuation(state: SessionRecordSessionState): void;
  clearRetry(state: SessionRecordSessionState): void;
};

export function createSessionRecordBatchSynchronizer(options: Options) {
  const { coordinator, store, clock } = options;

  async function handleFailure(
    state: SessionRecordSessionState,
    generation: number,
    message: string,
    final: boolean,
    deadline?: number,
  ): Promise<SessionRecordSnapshot> {
    state.syncingMarked = false;
    if (!coordinator.isCurrent(state, generation)) return coordinator.cachedSnapshotFor(state);
    if (final && deadline !== undefined && sessionRecordNowMs(clock) >= deadline) {
      return coordinator.invalidateForTimeout(state);
    }
    let current: SessionRecordStoreSnapshot;
    try {
      current = await coordinator.readPrivateSnapshot(state);
    } catch {
      return coordinator.cachedSnapshotFor(state, 'failed');
    }
    const status: SessionRecordSyncStatus = final && current.events.length > 0
      ? 'stale'
      : 'failed';
    const result = await coordinator.markState(state, generation, status, message, deadline);
    if (!final) options.scheduleRetry(state);
    return result;
  }

  async function probeIfNeeded(
    state: SessionRecordSessionState,
    binding: RecordSourceBinding,
    generation: number,
    deadline?: number,
  ): Promise<{ binding: RecordSourceBinding; capability?: RecordSourceCapability; error?: string }> {
    const adapter = options.adapters.get(binding.source);
    if (adapter === undefined) return { binding, error: '没有可用的记录来源适配器。' };
    const shouldProbe = !state.probed
      || state.capabilityStatus === 'unavailable'
      || state.capabilityStatus === 'partial'
      || state.capabilityStatus === 'failed'
      || binding.nativeSessionId === undefined;
    if (!shouldProbe) return { binding };
    let capability: RecordSourceCapability;
    try {
      capability = await adapter.probe(binding);
    } catch {
      return { binding, error: '记录来源探测失败。' };
    }
    if (!coordinator.isCurrent(state, generation)) return { binding, error: '同步已失效。' };
    state.probed = true;
    state.capabilityStatus = capability.status;
    let upgraded: RecordSourceBinding;
    try {
      upgraded = mergeRecordSourceBindingNativeId(binding, capability);
    } catch (error) {
      return {
        binding,
        capability,
        error: error instanceof Error ? error.message : '原生会话标识冲突。',
      };
    }
    if (!sameRecordSourceBinding(binding, upgraded)) {
      try {
        await store.updateSyncState({
          sessionId: state.sessionId,
          status: 'syncing',
          binding: upgraded,
          source: upgraded.source,
        }, coordinator.writeGuard(state, generation, deadline));
      } catch {
        return { binding, capability, error: '原生会话绑定保存失败。' };
      }
      if (!coordinator.isCurrent(state, generation)) {
        return { binding, capability, error: '同步已失效。' };
      }
      state.binding = upgraded;
    }
    return { binding: upgraded, capability };
  }

  async function readBatch(
    adapter: RecordSourceAdapter,
    binding: RecordSourceBinding,
    cursor: string | undefined,
  ): Promise<RecordSourceBatch | undefined> {
    try {
      return await adapter.readIncremental(binding, cursor);
    } catch {
      return undefined;
    }
  }

  async function performSync(
    state: SessionRecordSessionState,
    _reason: SessionRecordSyncReason,
    generation: number,
    deadline?: number,
  ): Promise<SessionRecordSnapshot> {
    if (!coordinator.isCurrent(state, generation)) return coordinator.cachedSnapshotFor(state);
    // A fresh drain (no pending backlog) persists the `syncing` marker again.
    if (!state.hasMore) state.syncingMarked = false;
    const privateSnapshot = await coordinator.readPrivateSnapshot(state);
    if (!coordinator.isCurrent(state, generation)) return coordinator.cachedSnapshotFor(state);
    state.rollbackBase = privateSnapshot;
    const binding = state.binding ?? privateSnapshot.index.binding;
    if (binding === undefined) {
      state.capabilityStatus = 'unavailable';
      return coordinator.markState(
        state,
        generation,
        'unavailable',
        '没有可靠的原生记录来源。',
      );
    }
    state.binding = binding;
    const adapter = options.adapters.get(binding.source);
    if (adapter === undefined) {
      state.capabilityStatus = 'unavailable';
      return coordinator.markState(
        state,
        generation,
        'unavailable',
        '没有可用的记录来源适配器。',
      );
    }
    if (deadline !== undefined && sessionRecordNowMs(clock) >= deadline) {
      return coordinator.invalidateForTimeout(state);
    }
    // One drain persists `syncing` once: continuation batches skip both the
    // marker write and its full snapshot read-back.
    if (state.syncingMarked !== true) {
      await coordinator.markSyncing(state, generation, deadline);
      state.syncingMarked = true;
    }
    const probe = await probeIfNeeded(state, binding, generation, deadline);
    if (probe.error !== undefined) {
      await coordinator.appendDerivedAvailabilityStatus(
        state, generation, probe.binding, 'failed', probe.error, deadline,
      );
      return handleFailure(
        state, generation, probe.error, deadline !== undefined, deadline,
      );
    }
    const capability = probe.capability;
    if (capability?.status === 'unavailable') {
      state.capabilityStatus = 'unavailable';
      state.syncingMarked = false;
      await coordinator.appendDerivedAvailabilityStatus(
        state, generation, probe.binding, 'waiting', '清晰记录暂不可用。', deadline,
      );
      return coordinator.markState(
        state, generation, 'unavailable', capability.reason, deadline,
      );
    }
    if (capability?.status === 'failed') {
      state.capabilityStatus = 'failed';
      await coordinator.appendDerivedAvailabilityStatus(
        state, generation, probe.binding, 'failed', '清晰记录同步失败。', deadline,
      );
      return handleFailure(
        state,
        generation,
        capability.reason ?? '记录来源探测失败。',
        deadline !== undefined,
        deadline,
      );
    }

    const beforeCursor = privateSnapshot.index.cursor;
    const batch = await readBatch(adapter, probe.binding, beforeCursor);
    if (batch === undefined) {
      return handleFailure(
        state, generation, '读取原生记录失败。', deadline !== undefined, deadline,
      );
    }
    if (!coordinator.isCurrent(state, generation)) return coordinator.cachedSnapshotFor(state);
    if (deadline !== undefined && sessionRecordNowMs(clock) >= deadline) {
      return coordinator.invalidateForTimeout(state);
    }
    state.capabilityStatus = capability?.status === 'partial' ? 'partial' : batch.status;
    const warnings = safeSessionRecordMessage(...batch.warnings);
    const nextCursor = typeof batch.nextCursor === 'string' && batch.nextCursor.length > 0
      ? batch.nextCursor
      : undefined;
    const cursorAdvanced = nextCursor !== undefined && nextCursor !== beforeCursor;
    if (batch.status === 'failed') {
      return handleFailure(
        state,
        generation,
        warnings ?? '原生记录读取失败。',
        deadline !== undefined,
        deadline,
      );
    }
    if (batch.status === 'unavailable') {
      state.syncingMarked = false;
      await coordinator.appendDerivedAvailabilityStatus(
        state, generation, probe.binding, 'waiting', '清晰记录暂不可用。', deadline,
      );
      return coordinator.markState(state, generation, 'unavailable', warnings, deadline);
    }
    const noProgressWithMore = batch.hasMore && !cursorAdvanced;
    const status = noProgressWithMore || capability?.status === 'partial' || warnings !== undefined
      ? 'partial'
      : sessionRecordStatusFromSource(batch.status);
    const message = safeSessionRecordMessage(
      capability?.reason,
      warnings,
      noProgressWithMore ? '原生记录游标未推进。' : undefined,
    );
    if (deadline !== undefined && sessionRecordNowMs(clock) >= deadline) {
      return coordinator.invalidateForTimeout(state);
    }
    // The snapshot loaded at the top of this sync is still the commit base:
    // the store is single-writer per generation, so re-reading the full event
    // file here only repeated a multi-MB parse per batch.
    const commitBase = privateSnapshot;
    state.rollbackBase = commitBase;
    if (!coordinator.isCurrent(state, generation)) return coordinator.cachedSnapshotFor(state);
    let committed: SessionRecordStoreSnapshot;
    try {
      if (batch.events.length > 0 || nextCursor !== undefined) {
        committed = await store.appendBatch({
          sessionId: state.sessionId,
          source: probe.binding.source,
          runId: probe.binding.runId,
          status,
          events: batch.events,
          syncedAt: sessionRecordNowIso(clock),
          ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
          ...(message === undefined ? {} : { message }),
        }, coordinator.writeGuard(state, generation, deadline));
      } else {
        await store.updateSyncState({
          sessionId: state.sessionId,
          status,
          message,
          lastSyncedAt: sessionRecordNowIso(clock),
        }, coordinator.writeGuard(state, generation, deadline));
        committed = await store.readSnapshot(state.sessionId);
      }
    } catch {
      return handleFailure(
        state, generation, '保存清晰记录失败。', deadline !== undefined, deadline,
      );
    }
    if (!coordinator.isCurrent(state, generation)) {
      if (state.rollbackBase !== undefined || state.timeoutCleanup !== undefined) {
        await coordinator.rollbackStaleCommit(state, committed, commitBase);
      }
      return coordinator.cachedSnapshotFor(state);
    }
    state.rollbackBase = undefined;
    state.lastCommitted = committed;
    state.statusOverride = undefined;
    state.hasMore = batch.hasMore && cursorAdvanced;
    if (!state.hasMore) state.syncingMarked = false;
    state.retryAttempt = 0;
    options.clearRetry(state);
    if (state.hasMore && deadline === undefined) options.scheduleContinuation(state);
    return publicSessionRecordSnapshot(state.sessionId, committed);
  }

  return { performSync, handleFailure };
}

export type SessionRecordBatchSynchronizer = ReturnType<typeof createSessionRecordBatchSynchronizer>;
