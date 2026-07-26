import path from 'node:path';
import type { SessionRecordEventDto } from '../../shared/agentdockTypes.js';
import type {
  RecordSourceAdapter,
  RecordSourceBatch,
  RecordSourceBinding,
  RecordSourceCapability,
} from './types.js';
import {
  assertApprovedRoots,
  boundedArguments,
  boundedText,
  decodeAdapterCursor,
  encodeAdapterCursor,
  eventTime,
  fileKey,
  findTruncationWarning,
  hasTruncationWarning,
  inspectJsonlFiles,
  mapDiscoveryWarnings,
  mapReaderWarnings,
  reduceRecordSourceStatus,
  RECORD_MAX_EVENTS_PER_BATCH,
  readSelectedJsonl,
  safeNativeIdentifier,
  safeToolName,
  sourceWarning,
  stableEventId,
  type AdapterOptions,
} from './adapterSupport.js';

type JsonRecord = Record<string, unknown>;
type GrokMetadata = {
  nativeSessionId?: string;
  workspacePath?: string;
  startedAt?: string;
  schemaVersion?: number;
};
type GrokCandidate = {
  path: string;
  records: JsonRecord[];
  recordLines: number[];
  metadata: GrokMetadata;
  warnings: string[];
  partial: boolean;
};

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sequenceOf(record: JsonRecord, fallback?: number): number | undefined {
  return typeof record.sequence === 'number'
    && Number.isSafeInteger(record.sequence)
    && record.sequence >= 0
    ? record.sequence
    : fallback;
}

function metadataFrom(records: readonly JsonRecord[]): GrokMetadata {
  for (const record of records) {
    if (record.type !== 'session_meta') continue;
    return {
      nativeSessionId: stringValue(record.session_id),
      workspacePath: stringValue(record.workspace),
      startedAt: stringValue(record.started_at),
      schemaVersion: typeof record.schema_version === 'number' && Number.isSafeInteger(record.schema_version)
        ? record.schema_version
        : undefined,
    };
  }
  return {};
}

function timeNear(left: string | undefined, right: string): boolean {
  if (left === undefined) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && Math.abs(leftMs - rightMs) <= 10 * 60 * 1_000;
}

function candidateMatches(candidate: GrokCandidate, binding: RecordSourceBinding): boolean {
  if (binding.nativeSessionId !== undefined) return candidate.metadata.nativeSessionId === binding.nativeSessionId;
  return candidate.metadata.workspacePath !== undefined
    && path.resolve(candidate.metadata.workspacePath) === path.resolve(binding.workspacePath)
    && timeNear(candidate.metadata.startedAt, binding.startedAt);
}

function eventBase(
  binding: RecordSourceBinding,
  record: JsonRecord,
  eventId: string,
  sequence: number | undefined,
  readAt: string,
): {
  eventId: string;
  sessionId: string;
  runId: string;
  sequence?: number;
  occurredAt: string;
  timeSource: 'native' | 'read';
  source: 'grok';
  trust: 'native';
} {
  const time = eventTime(record.timestamp, readAt);
  return {
    eventId,
    sessionId: binding.sessionId,
    runId: binding.runId,
    ...(sequence === undefined ? {} : { sequence }),
    occurredAt: time.occurredAt,
    timeSource: time.timeSource,
    source: 'grok',
    trust: 'native',
  };
}

function outcomeOf(record: JsonRecord): 'success' | 'failure' | 'partial' {
  const outcome = stringValue(record.outcome) ?? stringValue(record.status);
  if (outcome === 'success' || outcome === 'completed') return 'success';
  if (outcome === 'failure' || outcome === 'failed' || outcome === 'error') return 'failure';
  return 'partial';
}

function mapGrokRecord(
  record: JsonRecord,
  binding: RecordSourceBinding,
  nativeSessionId: string,
  readAt: string,
  fallback?: number,
): { recognized: boolean; events: Exclude<SessionRecordEventDto, { kind: 'status' }>[] } {
  if (record.schema_version !== 1) return { recognized: false, events: [] };
  if (stringValue(record.session_id) !== nativeSessionId) return { recognized: false, events: [] };
  if (record.type === 'session_meta') return { recognized: true, events: [] };
  const sequence = sequenceOf(record, fallback);
  const eventId = safeNativeIdentifier(record.id) ?? stableEventId('grok', nativeSessionId, sequence, record);

  if (record.type === 'message') {
    const role = stringValue(record.role);
    if (role !== 'user' && role !== 'assistant') return { recognized: false, events: [] };
    const text = boundedText(record.text, 8_000);
    if (text.text.length === 0) return { recognized: false, events: [] };
    return {
      recognized: true,
      events: [{
        ...eventBase(binding, record, eventId, sequence, readAt),
        kind: role === 'user' ? 'user_message' : 'assistant_message',
        truncated: text.truncated,
        payload: { text: text.text },
      }],
    };
  }

  if (record.type === 'tool_call') {
    const args = boundedArguments(record.arguments);
    return {
      recognized: true,
      events: [{
        ...eventBase(binding, record, eventId, sequence, readAt),
        kind: 'tool_call',
        truncated: args.truncated,
        payload: {
          toolName: safeToolName(record.tool_name),
          ...(args.text.length > 0 ? { argumentsSummary: args.text } : {}),
        },
      }],
    };
  }

  if (record.type === 'tool_result') {
    const result = boundedText(record.text, 8_000);
    return {
      recognized: true,
      events: [{
        ...eventBase(binding, record, eventId, sequence, readAt),
        kind: 'tool_result',
        truncated: result.truncated,
        payload: {
          outcome: outcomeOf(record),
          ...(result.text.length > 0 ? { text: result.text } : {}),
        },
      }],
    };
  }

  return { recognized: false, events: [] };
}

type GrokCandidateAssessment = {
  readable: boolean;
  unknown: boolean;
};

function assessGrokCandidate(
  candidate: GrokCandidate,
  binding: RecordSourceBinding,
): GrokCandidateAssessment {
  const nativeSessionId = candidate.metadata.nativeSessionId ?? binding.nativeSessionId ?? '';
  let readable = false;
  let unknown = false;
  for (let index = 0; index < candidate.records.length; index += 1) {
    const record = asRecord(candidate.records[index]);
    if (record === undefined) {
      unknown = true;
      continue;
    }
    const mapped = mapGrokRecord(
      record,
      binding,
      nativeSessionId,
      new Date().toISOString(),
      candidate.recordLines[index],
    );
    if (!mapped.recognized) unknown = true;
    if (mapped.events.length > 0) readable = true;
  }
  return { readable, unknown };
}

function emptyBatch(status: RecordSourceBatch['status'], warnings: string[] = []): RecordSourceBatch {
  return { status, events: [], hasMore: false, warnings: [...new Set(warnings)] };
}

export function createGrokRecordSource(options: AdapterOptions): RecordSourceAdapter {
  const approvedRoots = assertApprovedRoots(options?.approvedRoots as readonly string[]);

  async function inspect(binding: RecordSourceBinding): Promise<{
    candidates: GrokCandidate[];
    warnings: string[];
    partial: boolean;
  }> {
    try {
      const inspected = await inspectJsonlFiles<JsonRecord>({
        rootPath: path.join(binding.recordHome, 'sessions'),
        approvedRoots,
        sourceType: 'grok',
        // Newest files first so a long history cannot starve the current
        // session out of the finite scan budget.
        scanOrder: 'descending',
      });
      const candidates = inspected.files.map((file) => ({
        path: file.path,
        records: file.records,
        recordLines: file.recordLines,
        metadata: metadataFrom(file.records),
        warnings: mapReaderWarnings('grok', file.warnings),
        partial: file.partial,
      }));
      const warnings = [
        ...mapDiscoveryWarnings('grok', inspected.discovery),
      ];
      return {
        candidates,
        warnings: [...new Set(warnings)],
        partial: inspected.discovery.status === 'partial',
      };
    } catch {
      return { candidates: [], warnings: [sourceWarning('grok', 'path_unavailable')], partial: true };
    }
  }

  async function select(binding: RecordSourceBinding, cursor?: string): Promise<{
    candidate?: GrokCandidate;
    cursor: ReturnType<typeof decodeAdapterCursor>;
    warnings: string[];
    partial: boolean;
    ambiguous: boolean;
  }> {
    const inspected = await inspect(binding);
    const decoded = decodeAdapterCursor(cursor);
    const warnings = [...inspected.warnings];
    if (cursor !== undefined && decoded === undefined) warnings.push(sourceWarning('grok', 'cursor_invalid'));
    if (decoded !== undefined) {
      const byKey = inspected.candidates.find((candidate) => (
        fileKey(candidate.path) === decoded.fileKey && candidateMatches(candidate, binding)
      ));
      if (byKey !== undefined) {
        return {
          candidate: byKey,
          cursor: decoded,
          warnings: [...warnings, ...byKey.warnings],
          partial: inspected.partial || byKey.partial,
          ambiguous: false,
        };
      }
    }
    const matches = inspected.candidates.filter((candidate) => candidateMatches(candidate, binding));
    if (matches.length === 1) {
      const candidate = matches[0];
      const cursorMismatch = decoded !== undefined;
      return {
        candidate,
        cursor: cursorMismatch ? undefined : decoded,
        warnings: [
          ...warnings,
          ...candidate.warnings,
          ...(cursorMismatch ? [sourceWarning('grok', 'cursor_file_mismatch')] : []),
        ],
        partial: inspected.partial || candidate.partial || cursorMismatch,
        ambiguous: false,
      };
    }
    if (matches.length > 1) warnings.push(sourceWarning('grok', 'ambiguous_source'));
    return {
      cursor: decoded,
      warnings,
      partial: true,
      ambiguous: matches.length > 1,
    };
  }

  return {
    source: 'grok',
    async probe(binding): Promise<RecordSourceCapability> {
      const selected = await select(binding);
      if (selected.candidate === undefined) {
        if (selected.ambiguous) {
          return { status: 'partial', reason: sourceWarning('grok', 'ambiguous_source') };
        }
        // 计划 3.4：仅当扫描被截断（发现/元数据上限）时上报 partial 并保留真实
        // warning，让上层区分「没扫全，可能还有」。安全拒绝/目录不存在等 warning
        // 代表「这里确实没有可信来源」，必须保持 unavailable。
        const truncated = findTruncationWarning(selected.warnings);
        if (truncated !== undefined) {
          return { status: 'partial', reason: truncated };
        }
        return { status: 'unavailable', reason: sourceWarning('grok', 'source_unavailable') };
      }
      const supported = selected.candidate.metadata.schemaVersion === 1;
      const assessment = supported ? assessGrokCandidate(selected.candidate, binding) : { readable: false, unknown: true };
      const incomplete = selected.partial || selected.warnings.length > 0 || assessment.unknown;
      return {
        status: !supported
          ? 'partial'
          : reduceRecordSourceStatus({ readable: assessment.readable, incomplete }),
        ...(safeNativeIdentifier(selected.candidate.metadata.nativeSessionId) === undefined
          ? {}
          : { nativeSessionId: safeNativeIdentifier(selected.candidate.metadata.nativeSessionId) }),
        ...(!supported
          ? { reason: sourceWarning('grok', 'unsupported_schema') }
          : assessment.readable ? {} : { reason: sourceWarning('grok', assessment.unknown ? 'unknown_record' : 'no_readable_events') }),
      };
    },
    async readIncremental(binding, cursor): Promise<RecordSourceBatch> {
      const selected = await select(binding, cursor);
      if (selected.candidate === undefined) {
        // 与 probe 一致：仅扫描截断上报 partial，安全拒绝/不存在保持 unavailable。
        return emptyBatch(
          selected.ambiguous || hasTruncationWarning(selected.warnings) ? 'partial' : 'unavailable',
          selected.warnings,
        );
      }
      if (selected.candidate.metadata.schemaVersion !== 1) {
        return emptyBatch('partial', [...selected.warnings, sourceWarning('grok', 'unsupported_schema')]);
      }
      const selectedKey = fileKey(selected.candidate.path);
      let result;
      try {
        result = await readSelectedJsonl<JsonRecord>({
          filePath: selected.candidate.path,
          approvedRoots,
          sourceType: 'grok',
          maxRecords: RECORD_MAX_EVENTS_PER_BATCH,
          cursor: selected.cursor?.fileKey === selectedKey ? selected.cursor.readerCursor : undefined,
        });
      } catch {
        return emptyBatch('unavailable', [...selected.warnings, sourceWarning('grok', 'read_failed')]);
      }
      const nativeSessionId = selected.candidate.metadata.nativeSessionId ?? binding.nativeSessionId ?? '';
      const readAt = new Date().toISOString();
      const readerReset = result.warnings.some((warning) => (
        warning.category === 'file_replaced'
        || warning.category === 'file_shrunk'
        || warning.category === 'cursor_invalid'
      ));
      const seen = new Set(readerReset ? [] : (selected.cursor?.seenEventIds ?? []));
      const events: Exclude<SessionRecordEventDto, { kind: 'status' }>[] = [];
      let unknown = 0;
      for (let index = 0; index < result.records.length; index += 1) {
        const record = asRecord(result.records[index]);
        if (record === undefined) {
          unknown += 1;
          continue;
        }
        const mapped = mapGrokRecord(record, binding, nativeSessionId, readAt, result.recordLines[index]);
        if (!mapped.recognized) {
          unknown += 1;
          continue;
        }
        for (const event of mapped.events) {
          if (seen.has(event.eventId)) continue;
          seen.add(event.eventId);
          events.push(event);
        }
      }
      const warnings = [
        ...selected.warnings,
        ...mapReaderWarnings('grok', result.warnings),
        ...(unknown > 0 ? [sourceWarning('grok', 'unknown_record')] : []),
      ];
      const candidateAssessment = assessGrokCandidate(selected.candidate, binding);
      if (candidateAssessment.unknown && unknown === 0) warnings.push(sourceWarning('grok', 'unknown_record'));
      const incomplete = warnings.length > 0 || result.partial || selected.partial || unknown > 0 || candidateAssessment.unknown;
      return {
        status: reduceRecordSourceStatus({
          readable: candidateAssessment.readable || events.length > 0,
          incomplete,
        }),
        events,
        nextCursor: encodeAdapterCursor({
          version: 1,
          fileKey: selectedKey,
          readerCursor: result.nextCursor,
          seenEventIds: [...seen],
        }),
        hasMore: result.hasMore,
        warnings: [...new Set(warnings)],
      };
    },
  };
}
