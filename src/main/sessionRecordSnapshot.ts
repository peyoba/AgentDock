import { createHash } from 'node:crypto';
import type {
  SessionRecordEventDto,
  SessionRecordSnapshot,
  SessionRecordSyncStatus,
} from '../shared/agentdockTypes.js';
import { redactSecrets } from './secretRedaction.js';
import type {
  RecordSourceBinding,
  RecordSourceCapability,
  RecordSourceStatus,
} from './recordSources/types.js';
import type { SessionRecordStoreSnapshot } from './stores/sessionRecordEventStore.js';
import {
  normalizeSessionRecordEvent,
  normalizeSessionRecordTimestamp,
} from './stores/sessionRecordEventSchema.js';
import type { SessionRecordSyncClock } from './sessionRecordSyncContracts.js';
import {
  SESSION_RECORD_RESTORE_MAX_CHARS,
  SESSION_RECORD_STATUS_MESSAGE_MAX_CHARS,
} from './sessionRecordSyncContracts.js';

export function safeSessionRecordMessage(
  ...parts: readonly (string | undefined)[]
): string | undefined {
  const value = redactSecrets(
    parts
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('；')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ).replace(
    /(?:[A-Za-z]:[\\/]|\/(?:Users|private|tmp|var|home|Volumes|Applications|opt|etc)(?:\/|$))[^\s"'<>；，。]+/g,
    '[PATH]',
  ).replace(
    /(?<![:/])(?:\\\\|\/\/)[^\s"'<>；，。]+/g,
    '[PATH]',
  ).replace(
    /(?<![:/])(?:\/[^\s"'<>；，。/]+){2,}/g,
    '[PATH]',
  );
  if (value.length === 0) return undefined;
  return value.slice(0, SESSION_RECORD_STATUS_MESSAGE_MAX_CHARS);
}

export function sessionRecordNowIso(clock: SessionRecordSyncClock): string {
  return new Date(sessionRecordNowMs(clock)).toISOString();
}

export function sessionRecordNowMs(clock: SessionRecordSyncClock): number {
  const value = clock.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('同步时钟无效。');
  }
  return value.getTime();
}

export function defaultSessionRecordSnapshot(
  sessionId: string,
  status: SessionRecordSyncStatus = 'pending',
): SessionRecordSnapshot {
  return {
    sessionId,
    status,
    events: [],
    eventCount: 0,
    truncated: false,
    hasMore: false,
  };
}

export const SESSION_RECORD_LIST_DEFAULT_LIMIT = 200;
export const SESSION_RECORD_LIST_MAX_LIMIT = 500;

/** Tail window over the normalized event list; `hasMore` means older events exist. */
export type SessionRecordSnapshotWindow = {
  beforeEventId?: string;
  limit?: number;
};

function normalizeWindowLimit(limit: number | undefined): number {
  if (!Number.isSafeInteger(limit) || (limit as number) < 1) {
    return SESSION_RECORD_LIST_DEFAULT_LIMIT;
  }
  return Math.min(limit as number, SESSION_RECORD_LIST_MAX_LIMIT);
}

function windowSessionRecordEvents(
  events: readonly SessionRecordEventDto[],
  window: SessionRecordSnapshotWindow,
): { events: SessionRecordEventDto[]; hasMore: boolean } {
  const limit = normalizeWindowLimit(window.limit);
  let end = events.length;
  if (typeof window.beforeEventId === 'string' && window.beforeEventId.length <= 256) {
    const anchor = events.findIndex((event) => event.eventId === window.beforeEventId);
    // An unknown anchor falls back to the latest page instead of failing: the
    // caller's cursor may predate a retention rewrite.
    if (anchor >= 0) end = anchor;
  }
  const start = Math.max(0, end - limit);
  return { events: events.slice(start, end), hasMore: start > 0 };
}

export function publicSessionRecordSnapshot(
  sessionId: string,
  snapshot: SessionRecordStoreSnapshot,
  window?: SessionRecordSnapshotWindow,
): SessionRecordSnapshot {
  const events = snapshot.events.flatMap((event) => {
    try {
      return [normalizeSessionRecordEvent(event)];
    } catch {
      return [];
    }
  });
  const source = snapshot.index.source === 'claude'
    || snapshot.index.source === 'codex'
    || snapshot.index.source === 'grok'
    ? snapshot.index.source
    : undefined;
  const knownStatus = snapshot.index.status === 'pending'
    || snapshot.index.status === 'syncing'
    || snapshot.index.status === 'ready'
    || snapshot.index.status === 'partial'
    || snapshot.index.status === 'stale'
    || snapshot.index.status === 'failed'
    || snapshot.index.status === 'unavailable';
  const droppedUnsafeEvent = events.length !== snapshot.events.length;
  const status = !knownStatus
    ? 'failed'
    : droppedUnsafeEvent
      && snapshot.index.status !== 'failed'
      && snapshot.index.status !== 'stale'
      && snapshot.index.status !== 'unavailable'
      ? 'partial'
      : snapshot.index.status;
  let lastSyncedAt: string | undefined;
  try {
    lastSyncedAt = snapshot.index.lastSyncedAt === undefined
      ? undefined
      : normalizeSessionRecordTimestamp(snapshot.index.lastSyncedAt);
  } catch {
    lastSyncedAt = undefined;
  }
  const message = safeSessionRecordMessage(snapshot.index.message);
  const windowed = window === undefined ? undefined : windowSessionRecordEvents(events, window);
  return {
    sessionId,
    status,
    ...(source === undefined ? {} : { source }),
    events: windowed?.events ?? events,
    // `eventCount` stays the total so consumers can show progress while paging.
    eventCount: events.length,
    ...(lastSyncedAt === undefined ? {} : { lastSyncedAt }),
    ...(message === undefined ? {} : { message }),
    truncated: snapshot.index.truncated === true || droppedUnsafeEvent,
    hasMore: windowed?.hasMore ?? false,
  };
}

export function stableSessionRecordStatusEventId(input: {
  sessionId: string;
  runId: string;
  code: string;
  occurredAt: string;
  text?: string;
}): string {
  const digest = createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex');
  return `status-${digest}`;
}

export function sessionRecordStatusFromSource(
  status: RecordSourceStatus,
): SessionRecordSyncStatus {
  return status;
}

export function sameRecordSourceBinding(
  left: RecordSourceBinding | undefined,
  right: RecordSourceBinding,
): boolean {
  return left !== undefined
    && left.sessionId === right.sessionId
    && left.runId === right.runId
    && left.source === right.source
    && left.nativeSessionId === right.nativeSessionId
    && left.workspacePath === right.workspacePath
    && left.recordHome === right.recordHome
    && left.startedAt === right.startedAt;
}

function safeNativeSessionId(value: unknown): string | undefined {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 256
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    || redactSecrets(value) !== value
  ) {
    return undefined;
  }
  return value;
}

export function mergeRecordSourceBindingNativeId(
  binding: RecordSourceBinding,
  capability: RecordSourceCapability,
): RecordSourceBinding {
  const nativeSessionId = safeNativeSessionId(capability.nativeSessionId);
  if (capability.nativeSessionId !== undefined && nativeSessionId === undefined) {
    throw new Error('原生会话标识无效。');
  }
  if (nativeSessionId === undefined) return binding;
  if (binding.nativeSessionId !== undefined && binding.nativeSessionId !== nativeSessionId) {
    throw new Error('原生会话标识冲突。');
  }
  return binding.nativeSessionId === nativeSessionId
    ? binding
    : { ...binding, nativeSessionId };
}

function statusText(event: Extract<SessionRecordEventDto, { kind: 'status' }>): string {
  const labels: Record<typeof event.payload.code, string> = {
    started: '已启动',
    restored: '记忆已恢复',
    completed: '已完成',
    failed: '失败',
    waiting: '等待输入',
  };
  const label = labels[event.payload.code];
  return event.payload.text === undefined ? label : `${label}：${event.payload.text}`;
}

function restoreEventText(event: SessionRecordEventDto): string {
  if (event.kind === 'user_message' || event.kind === 'assistant_message') {
    return event.payload.text;
  }
  return event.kind === 'status' ? statusText(event) : '';
}

function compareRestoreEvents(
  left: SessionRecordEventDto,
  right: SessionRecordEventDto,
  leftIndex: number,
  rightIndex: number,
): number {
  const timeDifference = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  if (timeDifference !== 0) return timeDifference;
  const sequenceDifference = (left.sequence ?? Number.POSITIVE_INFINITY)
    - (right.sequence ?? Number.POSITIVE_INFINITY);
  return sequenceDifference !== 0 ? sequenceDifference : leftIndex - rightIndex;
}

export function buildSessionRecordRestoreMaterial(
  snapshot: SessionRecordSnapshot,
): string | undefined {
  const indexed = snapshot.events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => compareRestoreEvents(left.event, right.event, left.index, right.index));
  const hasNativeRole = indexed.some(({ event }) => (
    event.trust === 'native'
    && (event.kind === 'user_message' || event.kind === 'assistant_message')
  ));
  if (!hasNativeRole) return undefined;
  const lines = indexed
    .filter(({ event }) => (
      event.kind === 'user_message'
      || event.kind === 'assistant_message'
      || (event.kind === 'status' && event.payload.code !== 'started')
    ))
    .map(({ event }) => {
      const label = event.kind === 'user_message'
        ? '用户'
        : event.kind === 'assistant_message'
          ? 'Agent'
          : '状态';
      return `[${event.occurredAt}] ${label}：${restoreEventText(event)}`;
    });
  const material = redactSecrets(lines.join('\n')).trim();
  if (material.length === 0) return undefined;
  return material.length > SESSION_RECORD_RESTORE_MAX_CHARS
    ? material.slice(-SESSION_RECORD_RESTORE_MAX_CHARS)
    : material;
}
