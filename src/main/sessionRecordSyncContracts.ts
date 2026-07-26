import type {
  SessionRecordEventDto,
  SessionRecordSnapshot,
  SessionRecordSyncStatus,
} from '../shared/agentdockTypes.js';
import type {
  RecordSourceAdapter,
  RecordSourceBinding,
  RecordSourceStatus,
} from './recordSources/types.js';
import type {
  SessionRecordEventStore,
  SessionRecordStoreSnapshot,
} from './stores/sessionRecordEventStore.js';

export const DEFAULT_SESSION_RECORD_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;
export const SESSION_RECORD_FINAL_SYNC_TIMEOUT_MS = 5_000;
/**
 * Backlog continuation yields the event loop between batches: a large native
 * transcript drains as many bounded batches, and a 0ms follow-up would keep
 * the Electron main thread busy for the whole drain.
 */
export const SESSION_RECORD_CONTINUATION_DELAY_MS = 25;
export const SESSION_RECORD_RESTORE_MAX_CHARS = 20_000;
export const SESSION_RECORD_STATUS_MESSAGE_MAX_CHARS = 240;

export type TimerHandle = unknown;

export type SessionRecordSyncClock = {
  now(): Date;
};

export type SessionRecordSyncScheduler = {
  set(callback: () => void, delayMs: number): TimerHandle;
  clear(handle: TimerHandle): void;
};

export type SessionRecordSyncServiceOptions = {
  adapters: readonly RecordSourceAdapter[];
  store: SessionRecordEventStore;
  clock?: SessionRecordSyncClock;
  scheduler?: SessionRecordSyncScheduler;
  retryDelaysMs?: readonly number[];
  finalSyncTimeoutMs?: number;
};

export type SessionRecordSyncReason = 'launch' | 'opened' | 'manual' | 'retry';
export type SessionRecordFinalSyncReason = 'stop' | 'exit' | 'restart' | 'dispose';
export type SessionRecordScheduleReason = 'pty-output' | 'opened' | 'manual';

export type SessionRecordSyncService = {
  bind(binding: RecordSourceBinding): Promise<void>;
  appendStatus(input: {
    sessionId: string;
    runId: string;
    code: Extract<SessionRecordEventDto, { kind: 'status' }>['payload']['code'];
    text?: string;
    occurredAt: string;
  }): Promise<void>;
  schedule(sessionId: string, reason: SessionRecordScheduleReason): void;
  syncNow(sessionId: string, reason: SessionRecordSyncReason): Promise<SessionRecordSnapshot>;
  finalSync(sessionId: string, reason: SessionRecordFinalSyncReason): Promise<SessionRecordSnapshot>;
  getSnapshot(
    sessionId: string,
    window?: { beforeEventId?: string; limit?: number },
  ): Promise<SessionRecordSnapshot>;
  buildRestoreMaterial(sessionId: string): Promise<string | undefined>;
  deleteSession(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
};

export type SessionRecordSessionState = {
  sessionId: string;
  binding?: RecordSourceBinding;
  loaded: boolean;
  deleted: boolean;
  generation: number;
  inFlight?: Promise<SessionRecordSnapshot>;
  inFlightGeneration?: number;
  inFlightStarted?: boolean;
  finalInFlight?: Promise<SessionRecordSnapshot>;
  debounceTimer?: TimerHandle;
  retryTimer?: TimerHandle;
  retryAttempt: number;
  retryDelaysMs: readonly number[];
  probed: boolean;
  capabilityStatus?: RecordSourceStatus;
  hasMore: boolean;
  pendingAfterFlight: boolean;
  /** True while a drain already persisted `syncing`; later batches skip the write. */
  syncingMarked?: boolean;
  lastCommitted?: SessionRecordStoreSnapshot;
  rollbackBase?: SessionRecordStoreSnapshot;
  timeoutCleanup?: Promise<void>;
  statusOverride?: { status: SessionRecordSyncStatus; message?: string };
  controlTail: Promise<void>;
};

export const DEFAULT_SESSION_RECORD_CLOCK: SessionRecordSyncClock = { now: () => new Date() };
export const DEFAULT_SESSION_RECORD_SCHEDULER: SessionRecordSyncScheduler = {
  set(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
