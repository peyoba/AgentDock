import { createHash } from 'node:crypto';
import type {
  SessionRecordEventDto,
  SessionRecordTimeSource,
} from '../../shared/agentdockTypes.js';
import type { RecordSourceStatus } from './types.js';
import { redactCommandSecrets, redactSecrets } from '../secretRedaction.js';
import {
  discoverJsonlFiles,
  type JsonlDiscoveryResult,
} from './pathValidation.js';
import {
  readJsonlIncremental,
  isValidJsonlReaderCursor,
  type JsonlIncrementalResult,
  type JsonlReadWarning,
} from './jsonlReader.js';

export const RECORD_TEXT_MAX_LENGTH = 8_000;
export const RECORD_ARGUMENTS_MAX_LENGTH = 2_000;
export const RECORD_RESULT_MAX_LENGTH = 8_000;
export const RECORD_DISCOVERY_MAX_FILES = 5_000;
export const RECORD_METADATA_SCAN_MAX_FILES = 256;
export const RECORD_METADATA_SCAN_BYTES = 8 * 1024 * 1024;
/**
 * Per-file byte ceiling for the metadata preview.  Binding proof requires a
 * parsed record, so the ceiling must cover one oversized first line (for
 * example a huge pasted user message) instead of failing it as too long.
 */
export const RECORD_METADATA_SCAN_FILE_BYTES = 256 * 1024;
// The metadata pass only needs the first few records of each file: session
// metadata sits on line one and native session ids repeat on every record.
// The budget is per file so a large history can never starve later files.
export const RECORD_METADATA_MAX_RECORDS_PER_FILE = 8;
/** Hard upper bound for mapper fan-out from one native JSONL record. */
export const RECORD_MAX_EVENTS_PER_RECORD = 256;
/** Hard upper bound for events returned by one adapter read batch. */
export const RECORD_MAX_EVENTS_PER_BATCH = 4_096;

const MAX_APPROVED_ROOTS = 16;
const CURSOR_VERSION = 1;

export type AdapterOptions = {
  approvedRoots: readonly string[];
};

export type AdapterCursor = {
  version: 1;
  fileKey: string;
  readerCursor?: string;
  seenEventIds: string[];
};

export type InspectedJsonlFile<T> = {
  path: string;
  records: T[];
  recordLines: number[];
  readerCursor: string;
  warnings: JsonlReadWarning[];
  partial: boolean;
};

export type DiscoveryInspection<T> = {
  discovery: JsonlDiscoveryResult;
  files: InspectedJsonlFile<T>[];
};

export function assertApprovedRoots(approvedRoots: readonly string[]): string[] {
  if (!Array.isArray(approvedRoots) || approvedRoots.length === 0 || approvedRoots.length > MAX_APPROVED_ROOTS) {
    throw new Error('允许的记录目录不能为空。');
  }
  const normalized = approvedRoots.map((root) => {
    if (typeof root !== 'string' || root.trim().length === 0) {
      throw new Error('允许的记录目录无效。');
    }
    return root;
  });
  return normalized;
}

export function sourceWarning(source: string, category: string): string {
  const safeSource = /^[A-Za-z0-9._-]{1,16}$/.test(source) ? source : 'record';
  const safeCategory = /^[A-Za-z0-9._-]{1,48}$/.test(category) ? category : 'unknown';
  return `${safeSource}:${safeCategory}`;
}

/**
 * Warning categories that mean "the scan stopped early, more may exist" — a
 * discovery/inspection budget was reached, not a missing or rejected source.
 * Only these justify reporting `partial` when no candidate was found; every
 * other warning (rejected path, unreadable directory, corrupt content) means
 * "no trusted source here" and must stay `unavailable`.
 */
const TRUNCATION_WARNING_CATEGORIES: ReadonlySet<string> = new Set([
  'file_limit',
  'directory_limit',
  'entry_limit',
  'depth_limit',
  'inspection_limit',
  'record_limit',
]);

/** Returns the first truncation warning ("${source}:${category}"), if any. */
export function findTruncationWarning(warnings: readonly string[]): string | undefined {
  return warnings.find((warning) => {
    const separator = warning.indexOf(':');
    const category = separator >= 0 ? warning.slice(separator + 1) : warning;
    return TRUNCATION_WARNING_CATEGORIES.has(category);
  });
}

export function hasTruncationWarning(warnings: readonly string[]): boolean {
  return findTruncationWarning(warnings) !== undefined;
}

/**
 * Shared availability reduction used by probe and read paths.  A source with
 * no trustworthy event is unavailable unless another explicit incompleteness
 * signal explains why only a partial source was observed.
 */
export function reduceRecordSourceStatus(input: {
  readable: boolean;
  incomplete: boolean;
}): Exclude<RecordSourceStatus, 'failed'> {
  if (input.readable) return input.incomplete ? 'partial' : 'ready';
  return input.incomplete ? 'partial' : 'unavailable';
}

export function mapReaderWarnings(source: string, warnings: readonly JsonlReadWarning[]): string[] {
  return warnings.map((item) => sourceWarning(source, item.category));
}

export function mapDiscoveryWarnings(source: string, discovery: JsonlDiscoveryResult): string[] {
  return discovery.warnings.map((item) => sourceWarning(source, item.category));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSecretKey(key: string): boolean {
  return /(?:api[_-]?key|token|secret|password|passwd|credential|cookie|bearer|authorization)/i.test(key);
}

/** Normalize only data that is about to become a bounded public summary. */
export function normalizeSummaryValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return redactCommandSecrets(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 64).map((entry) => normalizeSummaryValue(entry, depth + 1));
  if (isPlainRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort().slice(0, 64)) {
      result[key] = isSecretKey(key)
        ? '[REDACTED]'
        : normalizeSummaryValue(value[key], depth + 1);
    }
    return result;
  }
  return '[UNSUPPORTED]';
}

export function boundedText(value: unknown, maxLength: number): { text: string; truncated: boolean } {
  let source: string;
  if (typeof value === 'string') {
    source = value;
  } else if (value === undefined || value === null) {
    source = '';
  } else {
    try {
      source = JSON.stringify(normalizeSummaryValue(value)) ?? '';
    } catch {
      source = '[UNSUPPORTED]';
    }
  }
  // Redact before cutting the boundary.  Cutting first can leave the prefix
  // of a credential whose suffix is just beyond the limit.
  const redacted = redactCommandSecrets(source);
  const initiallyTruncated = source.length > maxLength || redacted.length > maxLength;
  return { text: redacted.slice(0, maxLength), truncated: initiallyTruncated };
}

export function boundedArguments(value: unknown): { text: string; truncated: boolean } {
  let normalized = value;
  if (typeof value === 'string') {
    try {
      normalized = JSON.parse(value) as unknown;
    } catch {
      normalized = value;
    }
  }
  return boundedText(normalizeSummaryValue(normalized), RECORD_ARGUMENTS_MAX_LENGTH);
}

export function safeNativeIdentifier(value: unknown, maxLength = 256): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) return undefined;
  if (redactSecrets(value) !== value) return undefined;
  return value;
}

export function safeToolName(value: unknown): string {
  const safe = safeNativeIdentifier(value, 128);
  return safe ?? 'unknown';
}

export function stablePayload(value: unknown): string {
  try {
    return JSON.stringify(normalizeSummaryValue(value)) ?? '';
  } catch {
    return '';
  }
}

export function stableEventId(
  source: string,
  nativeSessionId: string,
  sequence: number | undefined,
  payload: unknown,
): string {
  return createHash('sha256')
    .update(source)
    .update('\u0000')
    .update(nativeSessionId)
    .update('\u0000')
    .update(String(sequence ?? 0))
    .update('\u0000')
    .update(stablePayload(payload))
    .digest('hex');
}

export function eventTime(
  value: unknown,
  readAt = new Date().toISOString(),
): { occurredAt: string; timeSource: SessionRecordTimeSource } {
  const strictIso = typeof value === 'string'
    && value.length <= 64
    && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,9})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value);
  if (strictIso) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      try {
        return { occurredAt: new Date(parsed).toISOString(), timeSource: 'native' };
      } catch {
        // Fall through to the bounded read timestamp.
      }
    }
  }
  const safeReadAt = typeof readAt === 'string'
    && readAt.length <= 64
    && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,9})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(readAt)
    && Number.isFinite(Date.parse(readAt))
    ? new Date(Date.parse(readAt)).toISOString()
    : new Date().toISOString();
  return { occurredAt: safeReadAt, timeSource: 'read' };
}

function isSafeCursorEventId(value: unknown): value is string {
  return typeof value === 'string'
    && (safeNativeIdentifier(value, 256) !== undefined || /^[a-f0-9]{64}$/.test(value));
}

export function encodeAdapterCursor(cursor: AdapterCursor): string {
  const safeReaderCursor = isValidJsonlReaderCursor(cursor.readerCursor)
    ? cursor.readerCursor
    : undefined;
  const safeFileKey = /^[a-f0-9]{64}$/.test(cursor.fileKey)
    ? cursor.fileKey
    : '0'.repeat(64);
  const safeSeenEventIds = [...new Set(
    (Array.isArray(cursor.seenEventIds) ? cursor.seenEventIds : [])
      .filter(isSafeCursorEventId),
  )].slice(-128);
  const safeCursor: AdapterCursor = {
    version: CURSOR_VERSION,
    fileKey: safeFileKey,
    ...(safeReaderCursor === undefined ? {} : { readerCursor: safeReaderCursor }),
    seenEventIds: safeSeenEventIds,
  };
  return Buffer.from(JSON.stringify(safeCursor), 'utf8').toString('base64url');
}

export function decodeAdapterCursor(value: string | undefined): AdapterCursor | undefined {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 48_000
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    if (keys.some((key) => !['version', 'fileKey', 'readerCursor', 'seenEventIds'].includes(key))) return undefined;
    if (
      parsed.version !== CURSOR_VERSION
      || typeof parsed.fileKey !== 'string'
      || !/^[a-f0-9]{64}$/.test(parsed.fileKey)
      || (parsed.readerCursor !== undefined && !isValidJsonlReaderCursor(parsed.readerCursor))
      || !Array.isArray(parsed.seenEventIds)
      || parsed.seenEventIds.length > 128
      || parsed.seenEventIds.some((id) => !isSafeCursorEventId(id))
    ) return undefined;
    return {
      version: 1,
      fileKey: parsed.fileKey,
      readerCursor: parsed.readerCursor as string | undefined,
      seenEventIds: (parsed.seenEventIds as string[]).slice(-128),
    };
  } catch {
    return undefined;
  }
}

export function fileKey(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex');
}

function fileBasename(filePath: string): string {
  const name = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

export async function inspectJsonlFiles<T>(input: {
  rootPath: string;
  approvedRoots: readonly string[];
  sourceType: string;
  /** Files whose basename (without extension) matches are scanned first. */
  preferredBasenames?: readonly string[];
  /** Scan order for the remaining files; 'descending' favors newest date-partitioned paths. */
  scanOrder?: 'ascending' | 'descending';
}): Promise<DiscoveryInspection<T>> {
  const approvedRoots = assertApprovedRoots(input.approvedRoots);
  const discovery = await discoverJsonlFiles({
    rootPath: input.rootPath,
    approvedRoots,
    maxDepth: 8,
    maxFiles: RECORD_DISCOVERY_MAX_FILES,
  });
  // The scan budget is finite, so the current session's file must never queue
  // behind a large history: preferred basenames first, then recency order.
  const ordered = input.scanOrder === 'descending'
    ? [...discovery.files].reverse()
    : [...discovery.files];
  const preferred = new Set(input.preferredBasenames ?? []);
  const prioritized = preferred.size === 0
    ? ordered
    : [
      ...ordered.filter((candidate) => preferred.has(fileBasename(candidate))),
      ...ordered.filter((candidate) => !preferred.has(fileBasename(candidate))),
    ];
  const files: InspectedJsonlFile<T>[] = [];
  let inspectedBytes = 0;
  let byteBudgetExhausted = false;
  for (const candidate of prioritized.slice(0, RECORD_METADATA_SCAN_MAX_FILES)) {
    const remainingBytes = RECORD_METADATA_SCAN_BYTES - inspectedBytes;
    if (remainingBytes <= 0) {
      byteBudgetExhausted = true;
      break;
    }
    try {
      const result = await readJsonlIncremental<T>({
        filePath: candidate,
        approvedRoots,
        maxBytes: Math.min(32 * 1024, remainingBytes),
        maxTotalBytes: Math.min(RECORD_METADATA_SCAN_FILE_BYTES, remainingBytes),
        maxRecords: RECORD_METADATA_MAX_RECORDS_PER_FILE,
        sourceType: input.sourceType,
      });
      inspectedBytes += result.bytesRead;
      // The preview deliberately stops after a handful of records, so its own
      // record-limit signal is expected and must not mark the candidate partial.
      const previewWarnings = result.warnings.filter((item) => item.category !== 'record_limit');
      files.push({
        path: candidate,
        records: result.records,
        recordLines: result.recordLines,
        readerCursor: result.nextCursor,
        warnings: previewWarnings,
        partial: previewWarnings.length > 0,
      });
    } catch {
      // Candidate paths and parser errors are intentionally collapsed into a
      // fixed warning by the adapter; no raw filesystem detail is returned.
    }
  }
  if (
    discovery.files.length > RECORD_METADATA_SCAN_MAX_FILES
    || byteBudgetExhausted
  ) {
    discovery.status = 'partial';
    discovery.hasMore = true;
    discovery.warnings.push({ category: 'inspection_limit', sourceType: 'path' });
  }
  return { discovery, files };
}

export async function readSelectedJsonl<T>(input: {
  filePath: string;
  approvedRoots: readonly string[];
  sourceType: string;
  cursor?: string;
  maxRecords?: number;
}): Promise<JsonlIncrementalResult<T>> {
  return readJsonlIncremental<T>({
    filePath: input.filePath,
    approvedRoots: assertApprovedRoots(input.approvedRoots),
    cursor: input.cursor,
    maxBytes: 1024 * 1024,
    ...(input.maxRecords === undefined ? {} : { maxRecords: input.maxRecords }),
    sourceType: input.sourceType,
  });
}

export function isRecordEvent(value: unknown): value is Exclude<SessionRecordEventDto, { kind: 'status' }> {
  return typeof value === 'object' && value !== null && 'kind' in value;
}
