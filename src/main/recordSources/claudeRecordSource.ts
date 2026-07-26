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
  RECORD_MAX_EVENTS_PER_RECORD,
  readSelectedJsonl,
  safeNativeIdentifier,
  safeToolName,
  stableEventId,
  sourceWarning,
  type AdapterOptions,
} from './adapterSupport.js';

type JsonRecord = Record<string, unknown>;
type ClaudeCandidate = {
  path: string;
  records: JsonRecord[];
  recordLines: number[];
  readerCursor: string;
  warnings: string[];
  partial: boolean;
  nativeSessionId?: string;
  workspacePath?: string;
  startedAt?: string;
};

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nativeId(record: JsonRecord): string | undefined {
  return stringValue(record.sessionId)
    ?? stringValue(record.session_id)
    ?? stringValue(asRecord(record.message)?.sessionId);
}

function sequenceOf(record: JsonRecord, fallback?: number): number | undefined {
  return typeof record.sequence === 'number'
    && Number.isSafeInteger(record.sequence)
    && record.sequence >= 0
    ? record.sequence
    : fallback;
}

function uniquePartEventId(input: {
  preferred?: string;
  baseId?: string;
  partKind: string;
  partIndex: number;
  partCount: number;
  preferPreferredWhenSingle?: boolean;
  sourcePayload: unknown;
  nativeSessionId: string;
  sequence?: number;
  recordLine?: number;
  correlationOnly?: boolean;
  used: Set<string>;
}): string {
  const preferred = safeNativeIdentifier(input.preferred);
  let candidate: string | undefined;
  if (input.partCount === 1) {
    candidate = input.correlationOnly
      ? input.baseId
      : input.preferPreferredWhenSingle ? (preferred ?? input.baseId) : (input.baseId ?? preferred);
  } else if (!input.correlationOnly && preferred !== undefined && !input.used.has(preferred)) {
    candidate = preferred;
  } else if (input.baseId !== undefined) {
    const composed = `${input.baseId}:${input.partKind}:${input.partIndex}`;
    candidate = safeNativeIdentifier(composed);
  }
  candidate ??= stableEventId(
    'claude',
    input.nativeSessionId,
    input.recordLine ?? input.sequence,
    {
      payload: input.sourcePayload,
      partKind: input.partKind,
      partIndex: input.partIndex,
      ...(preferred === undefined ? {} : { correlationId: preferred }),
    },
  );
  if (input.used.has(candidate)) {
    candidate = stableEventId(
      'claude',
      input.nativeSessionId,
      input.recordLine ?? input.sequence,
      {
        payload: input.sourcePayload,
        partKind: input.partKind,
        partIndex: input.partIndex,
        collision: true,
        ...(preferred === undefined ? {} : { correlationId: preferred }),
      },
    );
  }
  input.used.add(candidate);
  return candidate;
}

function timeNear(left: string | undefined, right: string): boolean {
  if (left === undefined) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && Math.abs(leftMs - rightMs) <= 10 * 60 * 1_000;
}

function recordMatchesBinding(record: JsonRecord, binding: RecordSourceBinding): boolean {
  const id = nativeId(record);
  return id === undefined || binding.nativeSessionId === undefined || id === binding.nativeSessionId;
}

function buildBase(
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
  source: 'claude';
  trust: 'native';
} {
  const time = eventTime(record.timestamp ?? record.created_at, readAt);
  return {
    eventId,
    sessionId: binding.sessionId,
    runId: binding.runId,
    ...(sequence === undefined ? {} : { sequence }),
    occurredAt: time.occurredAt,
    timeSource: time.timeSource,
    source: 'claude',
    trust: 'native',
  };
}

function mapClaudeRecord(
  record: JsonRecord,
  binding: RecordSourceBinding,
  readAt: string,
  recordLine?: number,
): {
  events: Exclude<SessionRecordEventDto, { kind: 'status' }>[];
  recognized: boolean;
  bindingMismatch?: boolean;
  eventLimitReached?: boolean;
} {
  if (!recordMatchesBinding(record, binding)) {
    return { events: [], recognized: false, bindingMismatch: true };
  }
  const type = stringValue(record.type);
  const message = asRecord(record.message);
  const role = stringValue(message?.role);
  const sequence = sequenceOf(record, recordLine);
  const basePayload = { type, message: record.message };
  const baseId = safeNativeIdentifier(record.uuid) ?? safeNativeIdentifier(record.id);
  const events: Exclude<SessionRecordEventDto, { kind: 'status' }>[] = [];
  const usedIds = new Set<string>();
  let eventLimitReached = false;

  if (type === 'user' && role === 'user') {
    const content = message?.content;
    if (Array.isArray(content)) {
      const limitedContent = content.slice(0, RECORD_MAX_EVENTS_PER_RECORD);
      eventLimitReached = content.length > RECORD_MAX_EVENTS_PER_RECORD;
      const textParts = limitedContent.filter((item) => {
        const part = asRecord(item);
        return part?.type === 'text' || (part === undefined && typeof item === 'string');
      });
      const resultParts = limitedContent.filter((item) => asRecord(item)?.type === 'tool_result');
      let textIndex = 0;
      let resultIndex = 0;
      for (let index = 0; index < limitedContent.length; index += 1) {
        if (events.length >= RECORD_MAX_EVENTS_PER_RECORD) {
          eventLimitReached = true;
          break;
        }
        const itemValue = limitedContent[index];
        const item = asRecord(itemValue);
        if (item?.type === 'text' || (item === undefined && typeof itemValue === 'string')) {
          // A user turn mixing text with tool results still carries the user's
          // own words; dropping them would silently rewrite the conversation.
          const text = boundedText(item?.text ?? itemValue, 8_000);
          if (text.text.length > 0) {
            events.push({
              ...buildBase(binding, record, uniquePartEventId({
                baseId,
                partKind: 'text',
                partIndex: textIndex,
                partCount: textParts.length,
                recordLine,
                sourcePayload: basePayload,
                nativeSessionId: binding.nativeSessionId ?? '',
                sequence,
                used: usedIds,
              }), sequence, readAt),
              kind: 'user_message',
              truncated: text.truncated,
              payload: { text: text.text },
            });
          }
          textIndex += 1;
          continue;
        }
        if (item?.type !== 'tool_result') continue;
        const result = boundedText(item.content, 8_000);
        const id = uniquePartEventId({
          preferred: safeNativeIdentifier(item.tool_use_id),
          baseId,
          partKind: 'result',
          partIndex: resultIndex,
          partCount: resultParts.length,
          recordLine,
          // A tool_use_id is correlation metadata, never an event identity.
          correlationOnly: true,
          sourcePayload: basePayload,
          nativeSessionId: binding.nativeSessionId ?? '',
          sequence,
          used: usedIds,
        });
        events.push({
          ...buildBase(binding, record, id, sequence, readAt),
          kind: 'tool_result',
          truncated: result.truncated,
          payload: {
            outcome: item.is_error === true ? 'failure' : 'success',
            ...(result.text.length > 0 ? { text: result.text } : {}),
          },
        });
        resultIndex += 1;
      }
      return { events, recognized: events.length > 0, eventLimitReached };
    }
    const text = boundedText(content, 8_000);
    if (text.text.length === 0) return { events: [], recognized: false };
    events.push({
      ...buildBase(binding, record, baseId ?? stableEventId('claude', binding.nativeSessionId ?? '', sequence, basePayload), sequence, readAt),
      kind: 'user_message',
      truncated: text.truncated,
      payload: { text: text.text },
    });
    return { events, recognized: true, eventLimitReached };
  }

  if (type === 'assistant' && role === 'assistant') {
    const content = message?.content;
    const allParts = Array.isArray(content) ? content : [content];
    const parts = allParts.slice(0, RECORD_MAX_EVENTS_PER_RECORD);
    eventLimitReached = allParts.length > RECORD_MAX_EVENTS_PER_RECORD;
    const textParts = parts.filter((part) => {
      const recordPart = asRecord(part);
      return recordPart?.type === 'text' || (recordPart === undefined && typeof part === 'string');
    });
    const toolParts = parts.filter((part) => asRecord(part)?.type === 'tool_use');
    let textIndex = 0;
    let toolIndex = 0;
    for (const partValue of parts) {
      if (events.length >= RECORD_MAX_EVENTS_PER_RECORD) {
        eventLimitReached = true;
        break;
      }
      const part = asRecord(partValue);
      if (part?.type === 'text' || (part === undefined && typeof partValue === 'string')) {
        const text = boundedText(part?.text ?? partValue, 8_000);
        if (text.text.length > 0) {
          events.push({
            ...buildBase(binding, record, uniquePartEventId({
              baseId,
              partKind: 'text',
              partIndex: textIndex,
              partCount: textParts.length,
              recordLine,
              sourcePayload: basePayload,
              nativeSessionId: binding.nativeSessionId ?? '',
              sequence,
              used: usedIds,
            }), sequence, readAt),
            kind: 'assistant_message',
            truncated: text.truncated,
            payload: { text: text.text },
          });
        }
        textIndex += 1;
      } else if (part?.type === 'tool_use') {
        const args = boundedArguments(part.input);
        const id = uniquePartEventId({
          preferred: safeNativeIdentifier(part.id),
          baseId,
          partKind: 'tool',
          partIndex: toolIndex,
          partCount: toolParts.length,
          recordLine,
          preferPreferredWhenSingle: true,
          sourcePayload: basePayload,
          nativeSessionId: binding.nativeSessionId ?? '',
          sequence,
          used: usedIds,
        });
        events.push({
          ...buildBase(binding, record, id, sequence, readAt),
          kind: 'tool_call',
          truncated: args.truncated,
          payload: {
            toolName: safeToolName(part.name),
            ...(args.text.length > 0 ? { argumentsSummary: args.text } : {}),
          },
        });
        toolIndex += 1;
      }
    }
    return { events, recognized: events.length > 0, eventLimitReached };
  }

  if (type === 'tool_use') {
    const args = boundedArguments(record.input);
    const id = baseId ?? stableEventId('claude', binding.nativeSessionId ?? '', sequence, basePayload);
    return {
      recognized: true,
      eventLimitReached: false,
      events: [{
        ...buildBase(binding, record, id, sequence, readAt),
        kind: 'tool_call',
        truncated: args.truncated,
        payload: {
          toolName: safeToolName(record.name),
          ...(args.text.length > 0 ? { argumentsSummary: args.text } : {}),
        },
      }],
    };
  }

  if (type === 'tool_result') {
    const result = boundedText(record.content, 8_000);
    const correlationId = safeNativeIdentifier(record.tool_use_id);
    const id = baseId
      ?? stableEventId('claude', binding.nativeSessionId ?? '', recordLine ?? sequence, {
        payload: basePayload,
        partKind: 'result',
        partIndex: 0,
        correlationId,
      });
    return {
      recognized: true,
      eventLimitReached: false,
      events: [{
        ...buildBase(binding, record, id, sequence, readAt),
        kind: 'tool_result',
        truncated: result.truncated,
        payload: {
          outcome: record.is_error === true ? 'failure' : 'success',
          ...(result.text.length > 0 ? { text: result.text } : {}),
        },
      }],
    };
  }

  return { events: [], recognized: false };
}

type ClaudeCandidateAssessment = {
  readable: boolean;
  unknown: boolean;
  bindingMismatch: boolean;
  eventLimit: boolean;
};

function assessClaudeCandidate(
  candidate: ClaudeCandidate,
  binding: RecordSourceBinding,
): ClaudeCandidateAssessment {
  let readable = false;
  let unknown = false;
  let bindingMismatch = false;
  let eventLimit = false;
  let mappedEvents = 0;
  for (let index = 0; index < candidate.records.length; index += 1) {
    const record = asRecord(candidate.records[index]);
    if (record === undefined) {
      unknown = true;
      continue;
    }
    const mapped = mapClaudeRecord(record, binding, new Date().toISOString(), candidate.recordLines[index]);
    if (mapped.bindingMismatch) bindingMismatch = true;
    if (!mapped.recognized) unknown = true;
    if (mapped.events.length > 0) readable = true;
    if (mapped.eventLimitReached) eventLimit = true;
    mappedEvents += mapped.events.length;
    if (mappedEvents >= RECORD_MAX_EVENTS_PER_BATCH) {
      eventLimit = true;
      break;
    }
  }
  return { readable, unknown, bindingMismatch, eventLimit };
}

function candidateMatches(candidate: ClaudeCandidate, binding: RecordSourceBinding): boolean {
  if (binding.nativeSessionId !== undefined) {
    // A matching file name is only a scan-priority hint.  `.claude/projects`
    // is user-writable, so binding requires at least one record that proves
    // the native session id from inside the file.
    return candidate.nativeSessionId === binding.nativeSessionId
      || candidate.records.some((record) => nativeId(record) === binding.nativeSessionId);
  }
  return candidate.workspacePath !== undefined
    && path.resolve(candidate.workspacePath) === path.resolve(binding.workspacePath)
    && timeNear(candidate.startedAt, binding.startedAt)
    && candidate.nativeSessionId !== undefined;
}

function emptyBatch(status: RecordSourceBatch['status'], warnings: string[] = []): RecordSourceBatch {
  return { status, events: [], hasMore: false, warnings: [...new Set(warnings)] };
}

export function createClaudeRecordSource(options: AdapterOptions): RecordSourceAdapter {
  const approvedRoots = assertApprovedRoots(options?.approvedRoots as readonly string[]);

  async function inspect(binding: RecordSourceBinding): Promise<{
    candidates: ClaudeCandidate[];
    warnings: string[];
    partial: boolean;
  }> {
    const rootPath = path.join(binding.recordHome, 'projects');
    try {
      const inspected = await inspectJsonlFiles<JsonRecord>({
        rootPath,
        approvedRoots,
        sourceType: 'claude',
        // Claude names each transcript after its native session id, so the
        // current session's file can be scanned before any history.
        ...(binding.nativeSessionId === undefined
          ? {}
          : { preferredBasenames: [binding.nativeSessionId] }),
      });
      const warnings = [
        ...mapDiscoveryWarnings('claude', inspected.discovery),
      ];
      const candidates = inspected.files.map((file) => ({
        path: file.path,
        records: file.records,
        recordLines: file.recordLines,
        readerCursor: file.readerCursor,
        warnings: mapReaderWarnings('claude', file.warnings),
        partial: file.partial,
        nativeSessionId: file.records.map((record) => nativeId(record)).find((value) => value !== undefined),
        workspacePath: file.records.map((record) => stringValue(record.cwd)).find((value) => value !== undefined),
        startedAt: file.records.map((record) => stringValue(record.timestamp)).find((value) => value !== undefined),
      }));
      return {
        candidates,
        warnings: [...new Set(warnings)],
        partial: inspected.discovery.status === 'partial',
      };
    } catch {
      return { candidates: [], warnings: [sourceWarning('claude', 'path_unavailable')], partial: true };
    }
  }

  async function select(binding: RecordSourceBinding, cursor?: string): Promise<{
    candidate?: ClaudeCandidate;
    cursor: ReturnType<typeof decodeAdapterCursor>;
    warnings: string[];
    partial: boolean;
    ambiguous: boolean;
  }> {
    const inspected = await inspect(binding);
    const decoded = decodeAdapterCursor(cursor);
    const warnings = [...inspected.warnings];
    if (cursor !== undefined && decoded === undefined) warnings.push(sourceWarning('claude', 'cursor_invalid'));
    let candidates = inspected.candidates;
    if (decoded !== undefined) {
      const byKey = candidates.find((candidate) => (
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
    candidates = candidates.filter((candidate) => candidateMatches(candidate, binding));
    if (candidates.length === 0) return { cursor: decoded, warnings, partial: true, ambiguous: false };
    if (candidates.length > 1) {
      warnings.push(sourceWarning('claude', 'ambiguous_source'));
      return { cursor: decoded, warnings, partial: true, ambiguous: true };
    }
    const candidate = candidates[0];
    const cursorMismatch = decoded !== undefined;
    return {
      candidate,
      cursor: cursorMismatch ? undefined : decoded,
      warnings: [
        ...warnings,
        ...candidate.warnings,
        ...(cursorMismatch ? [sourceWarning('claude', 'cursor_file_mismatch')] : []),
      ],
      partial: inspected.partial || candidate.partial || cursorMismatch,
      ambiguous: false,
    };
  }

  return {
    source: 'claude',
    async probe(binding): Promise<RecordSourceCapability> {
      const selected = await select(binding);
      if (selected.candidate === undefined) {
        if (selected.ambiguous) {
          return { status: 'partial', reason: sourceWarning('claude', 'ambiguous_source') };
        }
        // 计划 3.4：仅当扫描被截断（发现/元数据上限）时上报 partial 并保留真实
        // warning，让上层区分「没扫全，可能还有」。安全拒绝/目录不存在等 warning
        // 代表「这里确实没有可信来源」，必须保持 unavailable。
        const truncated = findTruncationWarning(selected.warnings);
        if (truncated !== undefined) {
          return { status: 'partial', reason: truncated };
        }
        return { status: 'unavailable', reason: sourceWarning('claude', 'source_unavailable') };
      }
      const assessment = assessClaudeCandidate(selected.candidate, binding);
      const incomplete = selected.partial
        || selected.warnings.length > 0
        || assessment.unknown
        || assessment.bindingMismatch
        || assessment.eventLimit;
      const reason = assessment.bindingMismatch
        ? sourceWarning('claude', 'binding_mismatch')
        : assessment.eventLimit
          ? sourceWarning('claude', 'event_limit')
          : assessment.unknown
            ? sourceWarning('claude', 'unknown_record')
            : assessment.readable ? undefined : sourceWarning('claude', 'no_readable_events');
      return {
        status: reduceRecordSourceStatus({ readable: assessment.readable, incomplete }),
        ...(safeNativeIdentifier(binding.nativeSessionId ?? selected.candidate.nativeSessionId) === undefined
          ? {}
          : { nativeSessionId: safeNativeIdentifier(binding.nativeSessionId ?? selected.candidate.nativeSessionId) }),
        ...(reason === undefined ? {} : { reason }),
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
      const decoded = selected.cursor;
      let result;
      try {
        result = await readSelectedJsonl<JsonRecord>({
          filePath: selected.candidate.path,
          approvedRoots,
          sourceType: 'claude',
          maxRecords: Math.floor(RECORD_MAX_EVENTS_PER_BATCH / RECORD_MAX_EVENTS_PER_RECORD),
          cursor: decoded?.fileKey === fileKey(selected.candidate.path) ? decoded.readerCursor : undefined,
        });
      } catch {
        return emptyBatch('unavailable', [...selected.warnings, sourceWarning('claude', 'read_failed')]);
      }
      const readAt = new Date().toISOString();
      const effectiveBinding: RecordSourceBinding = {
        ...binding,
        nativeSessionId: binding.nativeSessionId ?? selected.candidate.nativeSessionId,
      };
      const events: Exclude<SessionRecordEventDto, { kind: 'status' }>[] = [];
      const readerReset = result.warnings.some((warning) => (
        warning.category === 'file_replaced'
        || warning.category === 'file_shrunk'
        || warning.category === 'cursor_invalid'
      ));
      const seen = new Set(readerReset ? [] : (decoded?.seenEventIds ?? []));
      let recognized = 0;
      let unknown = 0;
      let bindingMismatch = false;
      let eventLimit = false;
      for (let index = 0; index < result.records.length; index += 1) {
        const record = asRecord(result.records[index]);
        if (record === undefined) {
          unknown += 1;
          continue;
        }
        const mapped = mapClaudeRecord(
          record,
          effectiveBinding,
          readAt,
          result.recordLines[index],
        );
        bindingMismatch = bindingMismatch || mapped.bindingMismatch === true;
        eventLimit = eventLimit || mapped.eventLimitReached === true;
        if (!mapped.recognized) {
          unknown += 1;
          continue;
        }
        recognized += mapped.events.length;
        for (const event of mapped.events) {
          if (seen.has(event.eventId)) continue;
          seen.add(event.eventId);
          events.push(event);
        }
      }
      const warnings = [
        ...selected.warnings,
        ...mapReaderWarnings('claude', result.warnings),
        ...(unknown > 0 ? [sourceWarning('claude', 'unknown_record')] : []),
        ...(bindingMismatch ? [sourceWarning('claude', 'binding_mismatch')] : []),
        ...(eventLimit ? [sourceWarning('claude', 'event_limit')] : []),
      ];
      const candidateAssessment = assessClaudeCandidate(selected.candidate, effectiveBinding);
      const status = reduceRecordSourceStatus({
        readable: candidateAssessment.readable || recognized > 0,
        incomplete: warnings.length > 0
          || result.status === 'partial'
          || selected.partial
          || unknown > 0
          || bindingMismatch
          || eventLimit
          || candidateAssessment.unknown
          || candidateAssessment.bindingMismatch
          || candidateAssessment.eventLimit,
      });
      return {
        status,
        events,
        nextCursor: encodeAdapterCursor({
          version: 1,
          fileKey: fileKey(selected.candidate.path),
          readerCursor: result.nextCursor,
          seenEventIds: [...seen],
        }),
        hasMore: result.hasMore,
        warnings: [...new Set(warnings)],
      };
    },
  };
}
