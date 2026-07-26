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
type CodexMetadata = {
  nativeSessionId?: string;
  workspacePath?: string;
  startedAt?: string;
  originator?: string;
};
type CodexCandidate = {
  path: string;
  records: JsonRecord[];
  recordLines: number[];
  metadata: CodexMetadata;
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

function metadataFrom(records: readonly JsonRecord[]): CodexMetadata {
  for (const record of records) {
    if (record.type !== 'session_meta') continue;
    const payload = asRecord(record.payload);
    if (payload === undefined) continue;
    return {
      nativeSessionId: stringValue(payload.id) ?? stringValue(payload.thread_id) ?? stringValue(payload.session_id),
      workspacePath: stringValue(payload.cwd) ?? stringValue(payload.workspace),
      startedAt: stringValue(payload.timestamp) ?? stringValue(payload.started_at) ?? stringValue(record.timestamp),
      originator: stringValue(payload.originator),
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

function candidateMatches(candidate: CodexCandidate, binding: RecordSourceBinding): boolean {
  if (binding.nativeSessionId !== undefined) {
    return candidate.metadata.nativeSessionId === binding.nativeSessionId;
  }
  const workspaceMatches = candidate.metadata.workspacePath !== undefined
    && path.resolve(candidate.metadata.workspacePath) === path.resolve(binding.workspacePath);
  const sourceMatches = candidate.metadata.originator === 'codex_cli_rs'
    || candidate.metadata.originator === 'codex';
  return workspaceMatches && sourceMatches && timeNear(candidate.metadata.startedAt, binding.startedAt);
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
  source: 'codex';
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
    source: 'codex',
    trust: 'native',
  };
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => item !== undefined)
    .filter((item) => ['input_text', 'output_text', 'text'].includes(stringValue(item.type) ?? ''))
    .map((item) => stringValue(item.text) ?? '')
    .join('');
}

function outcomeOf(payload: JsonRecord): 'success' | 'failure' | 'partial' {
  const outcome = stringValue(payload.outcome) ?? stringValue(payload.status);
  if (outcome === 'success' || outcome === 'completed') return 'success';
  if (outcome === 'failure' || outcome === 'failed' || outcome === 'error') return 'failure';
  return 'partial';
}

function mapCodexRecord(
  record: JsonRecord,
  binding: RecordSourceBinding,
  nativeSessionId: string,
  readAt: string,
  fallback?: number,
): { recognized: boolean; events: Exclude<SessionRecordEventDto, { kind: 'status' }>[] } {
  if (record.type === 'session_meta') return { recognized: true, events: [] };
  if (record.type !== 'response_item') return { recognized: false, events: [] };
  const payload = asRecord(record.payload);
  if (payload === undefined) return { recognized: false, events: [] };
  const payloadType = stringValue(payload.type);
  const sequence = sequenceOf(record, fallback);
  const nativeEventId = safeNativeIdentifier(record.id) ?? safeNativeIdentifier(payload.id);
  const eventId = nativeEventId ?? stableEventId('codex', nativeSessionId, sequence, payload);

  if (payloadType === 'message') {
    const role = stringValue(payload.role);
    if (role !== 'user' && role !== 'assistant') return { recognized: false, events: [] };
    const text = boundedText(messageText(payload.content), 8_000);
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

  if (payloadType === 'function_call') {
    const args = boundedArguments(payload.arguments);
    return {
      recognized: true,
      events: [{
        ...eventBase(binding, record, eventId, sequence, readAt),
        kind: 'tool_call',
        truncated: args.truncated,
        payload: {
          toolName: safeToolName(payload.name),
          ...(args.text.length > 0 ? { argumentsSummary: args.text } : {}),
        },
      }],
    };
  }

  if (payloadType === 'function_call_output') {
    const result = boundedText(payload.output, 8_000);
    return {
      recognized: true,
      events: [{
        ...eventBase(binding, record, eventId, sequence, readAt),
        kind: 'tool_result',
        truncated: result.truncated,
        payload: {
          outcome: outcomeOf(payload),
          ...(result.text.length > 0 ? { text: result.text } : {}),
        },
      }],
    };
  }

  return { recognized: false, events: [] };
}

type CodexCandidateAssessment = {
  readable: boolean;
  unknown: boolean;
};

function assessCodexCandidate(
  candidate: CodexCandidate,
  binding: RecordSourceBinding,
): CodexCandidateAssessment {
  const nativeSessionId = candidate.metadata.nativeSessionId ?? binding.nativeSessionId ?? '';
  let readable = false;
  let unknown = false;
  for (let index = 0; index < candidate.records.length; index += 1) {
    const record = asRecord(candidate.records[index]);
    if (record === undefined) {
      unknown = true;
      continue;
    }
    const mapped = mapCodexRecord(record, binding, nativeSessionId, new Date().toISOString(), candidate.recordLines[index]);
    if (!mapped.recognized) unknown = true;
    if (mapped.events.length > 0) readable = true;
  }
  return { readable, unknown };
}

function emptyBatch(status: RecordSourceBatch['status'], warnings: string[] = []): RecordSourceBatch {
  return { status, events: [], hasMore: false, warnings: [...new Set(warnings)] };
}

export function createCodexRecordSource(options: AdapterOptions): RecordSourceAdapter {
  const approvedRoots = assertApprovedRoots(options?.approvedRoots as readonly string[]);

  async function inspect(binding: RecordSourceBinding): Promise<{
    candidates: CodexCandidate[];
    warnings: string[];
    partial: boolean;
  }> {
    try {
      const inspected = await inspectJsonlFiles<JsonRecord>({
        rootPath: path.join(binding.recordHome, 'sessions'),
        approvedRoots,
        sourceType: 'codex',
        // Codex partitions rollouts by date directory; newest first keeps the
        // current session inside the finite scan budget.
        scanOrder: 'descending',
      });
      const candidates = inspected.files.map((file) => ({
        path: file.path,
        records: file.records,
        recordLines: file.recordLines,
        metadata: metadataFrom(file.records),
        warnings: mapReaderWarnings('codex', file.warnings),
        partial: file.partial,
      }));
      const warnings = [
        ...mapDiscoveryWarnings('codex', inspected.discovery),
      ];
      return {
        candidates,
        warnings: [...new Set(warnings)],
        partial: inspected.discovery.status === 'partial',
      };
    } catch {
      return { candidates: [], warnings: [sourceWarning('codex', 'path_unavailable')], partial: true };
    }
  }

  async function select(binding: RecordSourceBinding, cursor?: string): Promise<{
    candidate?: CodexCandidate;
    cursor: ReturnType<typeof decodeAdapterCursor>;
    warnings: string[];
    partial: boolean;
    ambiguous: boolean;
  }> {
    const inspected = await inspect(binding);
    const decoded = decodeAdapterCursor(cursor);
    const warnings = [...inspected.warnings];
    if (cursor !== undefined && decoded === undefined) warnings.push(sourceWarning('codex', 'cursor_invalid'));
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
          ...(cursorMismatch ? [sourceWarning('codex', 'cursor_file_mismatch')] : []),
        ],
        partial: inspected.partial || candidate.partial || cursorMismatch,
        ambiguous: false,
      };
    }
    if (matches.length > 1) warnings.push(sourceWarning('codex', 'ambiguous_source'));
    return {
      cursor: decoded,
      warnings,
      partial: true,
      ambiguous: matches.length > 1,
    };
  }

  return {
    source: 'codex',
    async probe(binding): Promise<RecordSourceCapability> {
      const selected = await select(binding);
      if (selected.candidate === undefined) {
        if (selected.ambiguous) {
          return { status: 'partial', reason: sourceWarning('codex', 'ambiguous_source') };
        }
        // 计划 3.4：仅当扫描被截断（发现/元数据上限）时上报 partial 并保留真实
        // warning，让上层区分「没扫全，可能还有」。安全拒绝/目录不存在等 warning
        // 代表「这里确实没有可信来源」，必须保持 unavailable。
        const truncated = findTruncationWarning(selected.warnings);
        if (truncated !== undefined) {
          return { status: 'partial', reason: truncated };
        }
        return { status: 'unavailable', reason: sourceWarning('codex', 'source_unavailable') };
      }
      const assessment = assessCodexCandidate(selected.candidate, binding);
      const incomplete = selected.partial || selected.warnings.length > 0 || assessment.unknown;
      return {
        status: reduceRecordSourceStatus({ readable: assessment.readable, incomplete }),
        ...(safeNativeIdentifier(selected.candidate.metadata.nativeSessionId) === undefined
          ? {}
          : { nativeSessionId: safeNativeIdentifier(selected.candidate.metadata.nativeSessionId) }),
        ...(assessment.readable ? {} : { reason: sourceWarning('codex', assessment.unknown ? 'unknown_record' : 'no_readable_events') }),
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
      const selectedKey = fileKey(selected.candidate.path);
      let result;
      try {
        result = await readSelectedJsonl<JsonRecord>({
          filePath: selected.candidate.path,
          approvedRoots,
          sourceType: 'codex',
          maxRecords: RECORD_MAX_EVENTS_PER_BATCH,
          cursor: selected.cursor?.fileKey === selectedKey ? selected.cursor.readerCursor : undefined,
        });
      } catch {
        return emptyBatch('unavailable', [...selected.warnings, sourceWarning('codex', 'read_failed')]);
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
        const mapped = mapCodexRecord(record, binding, nativeSessionId, readAt, result.recordLines[index]);
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
        ...mapReaderWarnings('codex', result.warnings),
        ...(unknown > 0 ? [sourceWarning('codex', 'unknown_record')] : []),
      ];
      const candidateAssessment = assessCodexCandidate(selected.candidate, binding);
      if (candidateAssessment.unknown && unknown === 0) warnings.push(sourceWarning('codex', 'unknown_record'));
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
