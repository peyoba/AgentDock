import type { SessionRecordEventDto } from '../../shared/agentdockTypes.js';

export type RecordSourceBinding = {
  sessionId: string;
  runId: string;
  source: 'claude' | 'codex' | 'grok';
  nativeSessionId?: string;
  workspacePath: string;
  recordHome: string;
  startedAt: string;
};

/** Availability reported by a native record source. */
export type RecordSourceStatus = 'ready' | 'partial' | 'unavailable' | 'failed';

/** The result of a source capability probe.  This is a main-process-only type. */
export type RecordSourceCapability = {
  status: RecordSourceStatus;
  nativeSessionId?: string;
  reason?: string;
};

/** A bounded batch returned by a native source reader. */
export type RecordSourceBatch = {
  status: RecordSourceStatus;
  events: Exclude<SessionRecordEventDto, { kind: 'status' }>[];
  nextCursor?: string;
  hasMore: boolean;
  warnings: string[];
};

/** Main-process adapter contract; cursor never crosses into shared/Renderer types. */
export type RecordSourceAdapter = {
  source: 'claude' | 'codex' | 'grok';
  probe(binding: RecordSourceBinding): Promise<RecordSourceCapability>;
  readIncremental(
    binding: RecordSourceBinding,
    cursor: string | undefined,
  ): Promise<RecordSourceBatch>;
};
