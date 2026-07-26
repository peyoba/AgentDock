import path from 'node:path';
import type {
  SessionRecordEventDto,
  SessionRecordSyncStatus,
} from '../../shared/agentdockTypes.js';
import type { RecordSourceBinding } from '../recordSources/types.js';
import { redactCommandSecrets, redactSecrets } from '../secretRedaction.js';
import {
  SESSION_RECORD_BATCH_MAX_BYTES,
  SESSION_RECORD_BATCH_MAX_EVENTS,
  SESSION_RECORD_MAX_EVENTS,
  safeSessionRecordError,
  serializeSessionRecordEvent,
  type NativeRecordSource,
  type SerializedSessionRecordEvent,
} from './sessionRecordEventCodec.js';
import type {
  SessionRecordAppendBatch,
  SessionRecordIndex,
  SessionRecordStatusAppend,
  SessionRecordSyncStateUpdate,
} from './sessionRecordEventStore.js';

export type PreparedSessionRecordAppendBatch = {
  sessionId: string;
  source: NativeRecordSource;
  runId: string;
  cursor?: string;
  hasCursor: boolean;
  status: SessionRecordSyncStatus;
  serializedEvents: SerializedSessionRecordEvent[];
  syncedAt: string;
  message?: string;
};

export type PreparedSessionRecordStatusAppend = {
  sessionId: string;
  runId: string;
  serializedEvent: SerializedSessionRecordEvent;
};

export type PreparedSessionRecordSyncStateUpdate = SessionRecordSyncStateUpdate & {
  hasBinding: boolean;
  hasCursor: boolean;
  hasSource: boolean;
  hasLastSyncedAt: boolean;
  hasMessage: boolean;
  hasTruncated: boolean;
};

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NATIVE_SOURCES = new Set<NativeRecordSource>(['claude', 'codex', 'grok']);
const SYNC_STATUSES = new Set<SessionRecordSyncStatus>([
  'pending', 'syncing', 'ready', 'partial', 'stale', 'failed', 'unavailable',
]);
const EVENT_KINDS = new Set([
  'user_message', 'assistant_message', 'tool_call', 'tool_result', 'status',
]);
const TIME_SOURCES = new Set(['native', 'read']);
const STATUS_CODES = new Set(['started', 'restored', 'completed', 'failed', 'waiting']);
const TOOL_OUTCOMES = new Set(['success', 'failure', 'partial']);

export const SESSION_RECORD_SESSION_ID_MAX_LENGTH = 128;
export const SESSION_RECORD_IDENTIFIER_MAX_LENGTH = 256;
export const SESSION_RECORD_CURSOR_MAX_LENGTH = 48_000;
export const SESSION_RECORD_MESSAGE_MAX_LENGTH = 240;
export const SESSION_RECORD_PATH_MAX_BYTES = 4_096;
export const SESSION_RECORD_SEEN_EVENT_KEY_MAX_LENGTH = 280;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_CURSOR = /^[A-Za-z0-9_-]+$/;
const SAFE_SEEN_EVENT_KEY = /^(?:claude|codex|grok|agentdock):[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const STRICT_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Reflect.ownKeys(value).every(
    (key) => typeof key === 'string' && allowed.has(key),
  );
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Accept bounded RFC3339 input and always persist canonical UTC milliseconds. */
export function normalizeSessionRecordTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw safeSessionRecordError('会话记录时间字段无效。');
  }
  const match = STRICT_TIMESTAMP.exec(value);
  if (match === null) {
    throw safeSessionRecordError('会话记录时间字段无效。');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59
  ) {
    throw safeSessionRecordError('会话记录时间字段无效。');
  }
  const offset = match[8];
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      throw safeSessionRecordError('会话记录时间字段无效。');
    }
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw safeSessionRecordError('会话记录时间字段无效。');
  }
  try {
    const canonical = new Date(parsed).toISOString();
    if (!CANONICAL_TIMESTAMP.test(canonical)) {
      throw safeSessionRecordError('会话记录时间字段无效。');
    }
    return canonical;
  } catch {
    throw safeSessionRecordError('会话记录时间字段无效。');
  }
}

export function assertSafeSessionRecordId(sessionId: unknown): asserts sessionId is string {
  if (
    typeof sessionId !== 'string'
    || sessionId.length > SESSION_RECORD_SESSION_ID_MAX_LENGTH
    || !SAFE_SESSION_ID.test(sessionId)
    || redactSecrets(sessionId) !== sessionId
  ) {
    throw safeSessionRecordError('会话 ID 不安全。');
  }
}

function requiredIdentifier(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw safeSessionRecordError(message);
  }
  if (value.length > SESSION_RECORD_IDENTIFIER_MAX_LENGTH) {
    throw safeSessionRecordError('会话记录事件结构超过大小限制。');
  }
  if (!SAFE_IDENTIFIER.test(value) || redactSecrets(value) !== value) {
    throw safeSessionRecordError(message);
  }
  return value;
}

function optionalIdentifier(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredIdentifier(value, message);
}

function optionalCursor(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > SESSION_RECORD_CURSOR_MAX_LENGTH
    || !SAFE_CURSOR.test(value)
    || redactSecrets(value) !== value
  ) {
    throw safeSessionRecordError(message);
  }
  // Adapter cursors are opaque base64url, but reject an encoded known secret
  // before it can be persisted in the private index.
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (redactSecrets(decoded) !== decoded) {
      throw safeSessionRecordError(message);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'SessionRecordStoreError') throw error;
    throw safeSessionRecordError(message);
  }
  return value;
}

function optionalMessage(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw safeSessionRecordError(message);
  const redacted = redactSecrets(value);
  if (
    Array.from(redacted).length > SESSION_RECORD_MESSAGE_MAX_LENGTH
    || redacted.includes('\u0000')
  ) {
    throw safeSessionRecordError(message);
  }
  return redacted;
}

function requiredPath(value: unknown, message: string): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || !path.isAbsolute(value)
    || Buffer.byteLength(value, 'utf8') > SESSION_RECORD_PATH_MAX_BYTES
    || /[\u0000\r\n]/.test(value)
  ) {
    throw safeSessionRecordError(message);
  }
  return value;
}

function redactText(value: string): string {
  // The command-secret patterns also catch unregistered credentials passed as
  // env assignments, CLI flags, or Authorization headers inside record text.
  return redactCommandSecrets(value);
}

function normalizeNativeSource(value: unknown): NativeRecordSource {
  if (!NATIVE_SOURCES.has(value as NativeRecordSource)) {
    throw safeSessionRecordError('会话记录来源无效。');
  }
  return value as NativeRecordSource;
}

function normalizeSyncStatus(value: unknown): SessionRecordSyncStatus {
  if (!SYNC_STATUSES.has(value as SessionRecordSyncStatus)) {
    throw safeSessionRecordError('会话记录同步状态无效。');
  }
  return value as SessionRecordSyncStatus;
}

function normalizeBinding(value: unknown, sessionId: string): RecordSourceBinding {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, [
      'sessionId', 'runId', 'source', 'nativeSessionId',
      'workspacePath', 'recordHome', 'startedAt',
    ])
  ) {
    throw safeSessionRecordError('会话记录绑定无效。');
  }
  assertSafeSessionRecordId(value.sessionId);
  if (value.sessionId !== sessionId) {
    throw safeSessionRecordError('会话记录绑定与目标会话不匹配。');
  }
  const nativeSessionId = optionalIdentifier(value.nativeSessionId, '会话记录绑定无效。');
  return {
    sessionId,
    runId: requiredIdentifier(value.runId, '会话记录绑定无效。'),
    source: normalizeNativeSource(value.source),
    ...(nativeSessionId === undefined ? {} : { nativeSessionId }),
    workspacePath: requiredPath(value.workspacePath, '会话记录绑定无效。'),
    recordHome: requiredPath(value.recordHome, '会话记录绑定无效。'),
    startedAt: normalizeSessionRecordTimestamp(value.startedAt),
  };
}

function normalizeEventBase(value: Record<string, unknown>) {
  if (
    value.sequence !== undefined
    && (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0)
  ) {
    throw safeSessionRecordError('会话记录事件字段无效。');
  }
  if (!TIME_SOURCES.has(value.timeSource as string) || typeof value.truncated !== 'boolean') {
    throw safeSessionRecordError('会话记录事件字段无效。');
  }
  return {
    eventId: requiredIdentifier(value.eventId, '会话记录事件字段无效。'),
    sessionId: (() => {
      assertSafeSessionRecordId(value.sessionId);
      return value.sessionId;
    })(),
    runId: requiredIdentifier(value.runId, '会话记录事件字段无效。'),
    ...(value.sequence === undefined ? {} : { sequence: value.sequence as number }),
    occurredAt: normalizeSessionRecordTimestamp(value.occurredAt),
    timeSource: value.timeSource as 'native' | 'read',
    truncated: value.truncated,
  };
}

export function normalizeSessionRecordEvent(value: unknown): SessionRecordEventDto {
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, [
      'eventId', 'sessionId', 'runId', 'sequence', 'occurredAt',
      'timeSource', 'source', 'trust', 'truncated', 'kind', 'payload',
    ])
    || !EVENT_KINDS.has(value.kind as string)
    || !isPlainRecord(value.payload)
  ) {
    throw safeSessionRecordError('会话记录事件字段无效。');
  }

  const base = normalizeEventBase(value);
  const payload = value.payload;
  if (value.kind === 'user_message' || value.kind === 'assistant_message') {
    if (value.trust !== 'native' || !NATIVE_SOURCES.has(value.source as NativeRecordSource)) {
      throw safeSessionRecordError('角色事件必须来自原生记录。');
    }
    if (!hasOnlyKeys(payload, ['text']) || typeof payload.text !== 'string') {
      throw safeSessionRecordError('会话记录事件字段无效。');
    }
    return {
      ...base,
      kind: value.kind,
      source: value.source as NativeRecordSource,
      trust: 'native',
      payload: { text: redactText(payload.text) },
    };
  }

  if (value.kind === 'tool_call') {
    if (value.trust !== 'native' || !NATIVE_SOURCES.has(value.source as NativeRecordSource)) {
      throw safeSessionRecordError('角色事件必须来自原生记录。');
    }
    if (
      !hasOnlyKeys(payload, ['toolName', 'argumentsSummary'])
      || typeof payload.toolName !== 'string'
      || payload.toolName.length === 0
      || (payload.argumentsSummary !== undefined && typeof payload.argumentsSummary !== 'string')
    ) {
      throw safeSessionRecordError('会话记录事件字段无效。');
    }
    return {
      ...base,
      kind: 'tool_call',
      source: value.source as NativeRecordSource,
      trust: 'native',
      payload: {
        toolName: redactText(payload.toolName),
        ...(payload.argumentsSummary === undefined
          ? {}
          : { argumentsSummary: redactText(payload.argumentsSummary) }),
      },
    };
  }

  if (value.kind === 'tool_result') {
    if (value.trust !== 'native' || !NATIVE_SOURCES.has(value.source as NativeRecordSource)) {
      throw safeSessionRecordError('角色事件必须来自原生记录。');
    }
    if (
      !hasOnlyKeys(payload, ['outcome', 'text'])
      || !TOOL_OUTCOMES.has(payload.outcome as string)
      || (payload.text !== undefined && typeof payload.text !== 'string')
    ) {
      throw safeSessionRecordError('会话记录事件字段无效。');
    }
    return {
      ...base,
      kind: 'tool_result',
      source: value.source as NativeRecordSource,
      trust: 'native',
      payload: {
        outcome: payload.outcome as 'success' | 'failure' | 'partial',
        ...(payload.text === undefined ? {} : { text: redactText(payload.text) }),
      },
    };
  }

  if (value.source !== 'agentdock' || value.trust !== 'derived-status') {
    throw safeSessionRecordError('状态事件必须来自 AgentDock 派生状态。');
  }
  if (
    !hasOnlyKeys(payload, ['code', 'text'])
    || !STATUS_CODES.has(payload.code as string)
    || (payload.text !== undefined && typeof payload.text !== 'string')
  ) {
    throw safeSessionRecordError('会话记录事件字段无效。');
  }
  return {
    ...base,
    kind: 'status',
    source: 'agentdock',
    trust: 'derived-status',
    payload: {
      code: payload.code as 'started' | 'restored' | 'completed' | 'failed' | 'waiting',
      ...(payload.text === undefined ? {} : { text: redactText(payload.text) }),
    },
  };
}

export function normalizeSessionRecordIndex(
  value: unknown,
  sessionId: string,
): SessionRecordIndex {
  assertSafeSessionRecordId(sessionId);
  if (
    !isPlainRecord(value)
    || !hasOnlyKeys(value, [
      'schemaVersion', 'source', 'binding', 'cursor', 'seenEventKeys',
      'status', 'lastSyncedAt', 'message', 'truncated',
    ])
    || value.schemaVersion !== 1
    || !Array.isArray(value.seenEventKeys)
    || value.seenEventKeys.length > SESSION_RECORD_MAX_EVENTS
    || typeof value.truncated !== 'boolean'
  ) {
    throw safeSessionRecordError('会话记录索引无效。');
  }
  const seenEventKeys = value.seenEventKeys.map((eventKey) => {
    if (
      typeof eventKey !== 'string'
      || eventKey.length > SESSION_RECORD_SEEN_EVENT_KEY_MAX_LENGTH
      || !SAFE_SEEN_EVENT_KEY.test(eventKey)
      || redactSecrets(eventKey) !== eventKey
    ) {
      throw safeSessionRecordError('会话记录索引无效。');
    }
    return eventKey;
  });
  if (new Set(seenEventKeys).size !== seenEventKeys.length) {
    throw safeSessionRecordError('会话记录索引无效。');
  }
  const binding = value.binding === undefined
    ? undefined
    : normalizeBinding(value.binding, sessionId);
  const source = value.source === undefined
    ? binding?.source
    : normalizeNativeSource(value.source);
  if (binding !== undefined && source !== undefined && binding.source !== source) {
    throw safeSessionRecordError('会话记录索引无效。');
  }
  const cursor = optionalCursor(value.cursor, '会话记录索引无效。');
  const lastSyncedAt = value.lastSyncedAt === undefined
    ? undefined
    : normalizeSessionRecordTimestamp(value.lastSyncedAt);
  const message = optionalMessage(value.message, '会话记录索引无效。');
  return {
    schemaVersion: 1,
    ...(source === undefined ? {} : { source }),
    ...(binding === undefined ? {} : { binding }),
    ...(cursor === undefined ? {} : { cursor }),
    seenEventKeys,
    status: normalizeSyncStatus(value.status),
    ...(lastSyncedAt === undefined ? {} : { lastSyncedAt }),
    ...(message === undefined ? {} : { message }),
    truncated: value.truncated,
  };
}

export function defaultSessionRecordIndex(): SessionRecordIndex {
  return { schemaVersion: 1, seenEventKeys: [], status: 'pending', truncated: false };
}

export function prepareSessionRecordAppendBatch(
  input: SessionRecordAppendBatch,
): PreparedSessionRecordAppendBatch {
  if (!isPlainRecord(input)) {
    throw safeSessionRecordError('会话记录批次无效。');
  }
  assertSafeSessionRecordId(input.sessionId);
  if (
    !hasOnlyKeys(input, [
      'sessionId', 'source', 'runId', 'cursor', 'status',
      'events', 'syncedAt', 'message',
    ])
    || !Array.isArray(input.events)
  ) {
    throw safeSessionRecordError('会话记录批次无效。');
  }
  if (input.events.length > SESSION_RECORD_BATCH_MAX_EVENTS) {
    throw safeSessionRecordError('会话记录批次超过事件数量限制。');
  }
  const source = normalizeNativeSource(input.source);
  const runId = requiredIdentifier(input.runId, '会话记录批次无效。');
  const cursor = optionalCursor(input.cursor, '会话记录批次无效。');
  const status = normalizeSyncStatus(input.status);
  const syncedAt = normalizeSessionRecordTimestamp(input.syncedAt);
  const message = optionalMessage(input.message, '会话记录批次无效。');
  const seenInBatch = new Set<string>();
  const serializedEvents: SerializedSessionRecordEvent[] = [];
  let serializedBatchBytes = 0;

  for (const rawEvent of input.events) {
    const event = normalizeSessionRecordEvent(rawEvent);
    if (event.sessionId !== input.sessionId) {
      throw safeSessionRecordError('事件与目标会话不匹配。');
    }
    if (event.runId !== runId) {
      throw safeSessionRecordError('事件与目标运行不匹配。');
    }
    if (event.source !== source) {
      throw safeSessionRecordError('事件来源与批次不匹配。');
    }
    const serializedEvent = serializeSessionRecordEvent(event, true);
    serializedBatchBytes += serializedEvent.lineBytes;
    if (serializedBatchBytes > SESSION_RECORD_BATCH_MAX_BYTES) {
      throw safeSessionRecordError('会话记录批次超过字节限制。');
    }
    if (!seenInBatch.has(serializedEvent.eventKey)) {
      seenInBatch.add(serializedEvent.eventKey);
      serializedEvents.push(serializedEvent);
    }
  }

  return {
    sessionId: input.sessionId,
    source,
    runId,
    ...(cursor === undefined ? {} : { cursor }),
    hasCursor: Object.hasOwn(input, 'cursor'),
    status,
    serializedEvents,
    syncedAt,
    ...(message === undefined ? {} : { message }),
  };
}

export function prepareSessionRecordStatusAppend(
  input: SessionRecordStatusAppend,
): PreparedSessionRecordStatusAppend {
  if (!isPlainRecord(input) || !hasOnlyKeys(input, ['sessionId', 'runId', 'event'])) {
    throw safeSessionRecordError('会话状态事件无效。');
  }
  assertSafeSessionRecordId(input.sessionId);
  const runId = requiredIdentifier(input.runId, '会话状态事件无效。');
  const event = normalizeSessionRecordEvent(input.event);
  if (event.kind !== 'status') {
    throw safeSessionRecordError('appendStatus 只接受状态事件。');
  }
  if (event.sessionId !== input.sessionId) {
    throw safeSessionRecordError('事件与目标会话不匹配。');
  }
  if (event.runId !== runId) {
    throw safeSessionRecordError('事件与目标运行不匹配。');
  }
  return { sessionId: input.sessionId, runId, serializedEvent: serializeSessionRecordEvent(event, true) };
}

export function prepareSessionRecordSyncStateUpdate(
  input: SessionRecordSyncStateUpdate,
): PreparedSessionRecordSyncStateUpdate {
  if (
    !isPlainRecord(input)
    || !hasOnlyKeys(input, [
      'sessionId', 'status', 'binding', 'cursor', 'source',
      'lastSyncedAt', 'message', 'truncated',
    ])
  ) {
    throw safeSessionRecordError('会话记录同步更新无效。');
  }
  assertSafeSessionRecordId(input.sessionId);
  const binding = input.binding === undefined
    ? undefined
    : normalizeBinding(input.binding, input.sessionId);
  const source = input.source === undefined ? undefined : normalizeNativeSource(input.source);
  if (binding !== undefined && source !== undefined && binding.source !== source) {
    throw safeSessionRecordError('会话记录绑定来源不匹配。');
  }
  if (input.truncated !== undefined && typeof input.truncated !== 'boolean') {
    throw safeSessionRecordError('会话记录同步更新无效。');
  }
  const lastSyncedAt = input.lastSyncedAt === undefined
    ? undefined
    : normalizeSessionRecordTimestamp(input.lastSyncedAt);
  const cursor = optionalCursor(input.cursor, '会话记录同步更新无效。');
  const message = optionalMessage(input.message, '会话记录同步更新无效。');
  return {
    sessionId: input.sessionId,
    status: normalizeSyncStatus(input.status),
    ...(binding === undefined ? {} : { binding }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(source === undefined ? {} : { source }),
    ...(lastSyncedAt === undefined ? {} : { lastSyncedAt }),
    ...(message === undefined ? {} : { message }),
    ...(input.truncated === undefined ? {} : { truncated: input.truncated }),
    hasBinding: Object.hasOwn(input, 'binding'),
    hasCursor: Object.hasOwn(input, 'cursor'),
    hasSource: Object.hasOwn(input, 'source'),
    hasLastSyncedAt: Object.hasOwn(input, 'lastSyncedAt'),
    hasMessage: Object.hasOwn(input, 'message'),
    hasTruncated: Object.hasOwn(input, 'truncated'),
  };
}
