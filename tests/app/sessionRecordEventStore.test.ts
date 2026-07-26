import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionRecordEventDto, SessionRecordSnapshot } from '../../src/shared/agentdockTypes.js';
import {
  formatSessionRecordMarkdown,
  formatSessionRecordPlainText,
} from '../../src/shared/sessionRecordFormatting.js';
import {
  SESSION_RECORD_BATCH_MAX_BYTES,
  SESSION_RECORD_BATCH_MAX_EVENTS,
  SESSION_RECORD_EVENT_MAX_BYTES,
  SESSION_RECORD_EVENTS_READ_MAX_BYTES,
  SESSION_RECORD_FILE_MAX_BYTES,
  SESSION_RECORD_INDEX_MAX_BYTES,
  SESSION_RECORD_MAX_EVENTS,
  createSessionRecordEventStore,
  type SessionRecordAppendBatch,
} from '../../src/main/stores/sessionRecordEventStore.js';

const occurredAt = '2026-07-25T08:00:00.000Z';
let tempDir: string;

function nativeUserEvent({
  eventId = 'native-1',
  sessionId = 'session-1',
  runId = 'run-1',
  source = 'claude',
  text = '合成测试消息',
  sequence = 1,
  occurredAt: eventOccurredAt = occurredAt,
}: {
  eventId?: string;
  sessionId?: string;
  runId?: string;
  source?: 'claude' | 'codex' | 'grok';
  text?: string;
  sequence?: number;
  occurredAt?: string;
} = {}): Extract<SessionRecordEventDto, { kind: 'user_message' }> {
  return {
    eventId,
    sessionId,
    runId,
    sequence,
    occurredAt: eventOccurredAt,
    timeSource: 'native',
    source,
    trust: 'native',
    truncated: false,
    kind: 'user_message',
    payload: { text },
  };
}

function statusEvent({
  eventId = 'status-1',
  sessionId = 'session-1',
  runId = 'run-1',
  text = '等待下一步',
}: {
  eventId?: string;
  sessionId?: string;
  runId?: string;
  text?: string;
} = {}): Extract<SessionRecordEventDto, { kind: 'status' }> {
  return {
    eventId,
    sessionId,
    runId,
    occurredAt,
    timeSource: 'read',
    source: 'agentdock',
    trust: 'derived-status',
    truncated: false,
    kind: 'status',
    payload: { code: 'waiting', text },
  };
}

function nativeToolCallEvent({
  eventId = 'tool-1',
  sessionId = 'session-1',
  runId = 'run-1',
  source = 'claude',
  toolName = 'exec_command',
}: {
  eventId?: string;
  sessionId?: string;
  runId?: string;
  source?: 'claude' | 'codex' | 'grok';
  toolName?: string;
} = {}): Extract<SessionRecordEventDto, { kind: 'tool_call' }> {
  return {
    eventId,
    sessionId,
    runId,
    occurredAt,
    timeSource: 'native',
    source,
    trust: 'native',
    truncated: false,
    kind: 'tool_call',
    payload: { toolName },
  };
}

function validBatch(
  overrides: Partial<SessionRecordAppendBatch> = {},
): SessionRecordAppendBatch {
  const sessionId = overrides.sessionId ?? 'session-1';
  const source = overrides.source ?? 'claude';
  const runId = overrides.runId ?? 'run-1';
  return {
    sessionId,
    source,
    runId,
    cursor: 'cursor-1',
    status: 'ready',
    events: overrides.events ?? [nativeUserEvent({ sessionId, source, runId })],
    syncedAt: occurredAt,
    ...overrides,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  return caught as Error;
}

function expectSafeError(error: Error, forbiddenValues: readonly string[]): void {
  for (const forbiddenValue of forbiddenValues) {
    expect(error.message).not.toContain(forbiddenValue);
    expect(String(error)).not.toContain(forbiddenValue);
    expect(error.stack ?? '').not.toContain(forbiddenValue);
  }
}

async function posixMode(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

function recordPaths(sessionId = 'session-1') {
  const directory = path.join(tempDir, 'session-records', sessionId);
  return {
    root: path.join(tempDir, 'session-records'),
    directory,
    events: path.join(directory, 'events.jsonl'),
    index: path.join(directory, 'index.json'),
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-session-record-events-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe.sequential('sessionRecordEventStore', () => {
  it('returns a safe empty snapshot when no record files exist', async () => {
    const store = createSessionRecordEventStore(tempDir);

    await expect(store.readSnapshot('missing-session')).resolves.toEqual({
      events: [],
      index: {
        schemaVersion: 1,
        seenEventKeys: [],
        status: 'pending',
        truncated: false,
      },
      byteSize: 0,
    });
    await expect(readFile(recordPaths('missing-session').events, 'utf-8')).rejects.toThrow();
    await expect(readFile(recordPaths('missing-session').index, 'utf-8')).rejects.toThrow();
    // 纯读不落盘：不允许为没有记录的会话留下以 session id 命名的空私有目录。
    await expect(stat(recordPaths('missing-session').directory)).rejects.toThrow();
    await expect(stat(recordPaths('missing-session').root)).rejects.toThrow();

    // 状态写入（index-only）从零开始也要能建目录成功。
    await store.updateSyncState({ sessionId: 'missing-session', status: 'failed', message: '同步失败。' });
    const written = await store.readSnapshot('missing-session');
    expect(written.index.status).toBe('failed');
    expect((await stat(recordPaths('missing-session').directory)).isDirectory()).toBe(true);
  });

  it('stores one private JSONL stream, deduplicates ids, and appends without replacing events', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const firstEvent = nativeUserEvent();
    await store.appendBatch(validBatch({ events: [firstEvent, firstEvent] }));
    const paths = recordPaths();
    const inodeBeforeAppend = (await stat(paths.events)).ino;

    await store.appendBatch(validBatch({
      cursor: 'cursor-2',
      status: 'partial',
      events: [nativeUserEvent({ eventId: 'native-2', sequence: 2 })],
    }));

    const snapshot = await store.readSnapshot('session-1');
    const rawEvents = await readFile(paths.events, 'utf-8');
    const rawIndex = JSON.parse(await readFile(paths.index, 'utf-8')) as Record<string, unknown>;
    expect(snapshot.events.map(({ eventId }) => eventId)).toEqual(['native-1', 'native-2']);
    expect(snapshot.index).toMatchObject({
      schemaVersion: 1,
      source: 'claude',
      cursor: 'cursor-2',
      status: 'partial',
      seenEventKeys: ['claude:native-1', 'claude:native-2'],
      truncated: false,
    });
    expect(rawEvents.trimEnd().split('\n')).toHaveLength(2);
    expect(snapshot.byteSize).toBe(Buffer.byteLength(rawEvents, 'utf-8'));
    expect(rawIndex).toMatchObject({ source: 'claude', cursor: 'cursor-2', status: 'partial' });
    if (process.platform !== 'win32') {
      expect(await posixMode(paths.root)).toBe(0o700);
      expect(await posixMode(paths.directory)).toBe(0o700);
      expect(await posixMode(paths.events)).toBe(0o600);
      expect(await posixMode(paths.index)).toBe(0o600);
      expect((await stat(paths.events)).ino).toBe(inodeBeforeAppend);
    }
  });

  it('rejects unsafe ids at every public entry without writing an escape path', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const privateBody = 'SYNTHETIC_PRIVATE_BODY_MARKER';
    const unsafeIds = ['../escape', '/absolute', '.leading-dot', 'nested/session', '中文'];

    for (const sessionId of unsafeIds) {
      const operations = [
        store.appendBatch(validBatch({
          sessionId,
          events: [nativeUserEvent({ sessionId, text: privateBody })],
        })),
        store.appendStatus({
          sessionId,
          runId: 'run-1',
          event: statusEvent({ sessionId, text: privateBody }),
        }),
        store.readSnapshot(sessionId),
        store.updateSyncState({ sessionId, status: 'pending' }),
        store.deleteSession(sessionId),
      ];
      for (const operation of operations) {
        const error = await rejectionOf(operation);
        expect(error.message).toContain('会话 ID');
        expectSafeError(error, [tempDir, privateBody, sessionId]);
      }
    }

    await expect(readdir(tempDir)).resolves.toEqual([]);
  });

  it('keeps the complete prior snapshot when trust or identity validation rejects a batch', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch());
    const paths = recordPaths();
    const eventsBefore = await readFile(paths.events, 'utf-8');
    const indexBefore = await readFile(paths.index, 'utf-8');
    const privateBody = 'SYNTHETIC_REJECTED_EVENT_BODY';

    const invalidRoleTrust = {
      ...nativeUserEvent({ eventId: 'invalid-trust', text: privateBody }),
      trust: 'derived-status',
    } as unknown as SessionRecordEventDto;
    const errors = [
      await rejectionOf(store.appendBatch(validBatch({
        events: [nativeUserEvent({ eventId: 'valid-before-invalid' }), invalidRoleTrust],
      }))),
      await rejectionOf(store.appendBatch(validBatch({
        events: [nativeUserEvent({ eventId: 'wrong-session', sessionId: 'session-2', text: privateBody })],
      }))),
      await rejectionOf(store.appendBatch(validBatch({
        events: [nativeUserEvent({ eventId: 'wrong-run', runId: 'run-2', text: privateBody })],
      }))),
      await rejectionOf(store.appendBatch(validBatch({
        events: [nativeUserEvent({ eventId: 'wrong-source', source: 'codex', text: privateBody })],
      }))),
      await rejectionOf(store.appendStatus({
        sessionId: 'session-1',
        runId: 'run-1',
        event: {
          ...statusEvent({ text: privateBody }),
          source: 'claude',
          trust: 'native',
        } as unknown as Extract<SessionRecordEventDto, { kind: 'status' }>,
      })),
    ];

    expect(errors[0].message).toContain('角色事件必须来自原生记录');
    expect(errors[4].message).toContain('状态事件必须来自 AgentDock');
    for (const error of errors) {
      expectSafeError(error, [tempDir, privateBody]);
    }
    await expect(readFile(paths.events, 'utf-8')).resolves.toBe(eventsBefore);
    await expect(readFile(paths.index, 'utf-8')).resolves.toBe(indexBefore);
    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      events: [expect.objectContaining({ eventId: 'native-1' })],
    });
  });

  it('canonicalizes timestamps and redacts text before persistence and formatting', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const secret = `sk-${'a'.repeat(24)}`;
    const offsetTime = '2026-07-25T08:00:00+08:00';
    const binding = {
      sessionId: 'session-1',
      runId: 'run-1',
      source: 'claude' as const,
      nativeSessionId: 'native-session-1',
      workspacePath: path.join(tempDir, 'workspace'),
      recordHome: path.join(tempDir, 'records'),
      startedAt: offsetTime,
    };
    await store.updateSyncState({
      sessionId: 'session-1',
      status: 'syncing',
      binding,
      lastSyncedAt: offsetTime,
      message: `同步 ${secret}`,
    });
    await store.appendBatch(validBatch({
      syncedAt: offsetTime,
      message: `批次 ${secret}`,
      events: [nativeUserEvent({
        occurredAt: offsetTime,
        text: `用户正文 ${secret}`,
      })],
    }));

    const snapshot = await store.readSnapshot('session-1');
    expect(snapshot.events[0].occurredAt).toBe('2026-07-25T00:00:00.000Z');
    expect(snapshot.index.binding?.startedAt).toBe('2026-07-25T00:00:00.000Z');
    expect(snapshot.index.lastSyncedAt).toBe('2026-07-25T00:00:00.000Z');
    expect(snapshot.index.message).toBe('批次 [REDACTED]');
    expect(snapshot.events[0].payload).toEqual({ text: '用户正文 [REDACTED]' });

    const publicSnapshot: SessionRecordSnapshot = {
      sessionId: 'session-1',
      status: snapshot.index.status,
      source: snapshot.index.source,
      eventCount: snapshot.events.length,
      truncated: snapshot.index.truncated,
      hasMore: false,
      lastSyncedAt: snapshot.index.lastSyncedAt,
      message: snapshot.index.message,
      events: snapshot.events,
    };
    const formatted = [
      formatSessionRecordPlainText(publicSnapshot),
      formatSessionRecordMarkdown(publicSnapshot),
      await readFile(recordPaths().events, 'utf-8'),
      await readFile(recordPaths().index, 'utf-8'),
    ].join('\n');
    expect(formatted).not.toContain(secret);
    expect(formatted).toContain('[REDACTED]');
  });

  it('rewrites accepted legacy event and index text to canonical redacted forms', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch());
    const paths = recordPaths();
    const secret = `sk-${'b'.repeat(24)}`;
    const offsetTime = '2026-07-25T08:00:00+08:00';
    const rawEvent = nativeUserEvent({ occurredAt: offsetTime, text: `legacy ${secret}` });
    const rawIndex = JSON.parse(await readFile(paths.index, 'utf8')) as Record<string, unknown>;
    rawIndex.lastSyncedAt = offsetTime;
    rawIndex.message = `legacy ${secret}`;
    await writeFile(paths.events, `${JSON.stringify(rawEvent)}\n`, 'utf8');
    await writeFile(paths.index, JSON.stringify(rawIndex), 'utf8');

    const snapshot = await store.readSnapshot('session-1');
    const persisted = `${await readFile(paths.events, 'utf8')}\n${await readFile(paths.index, 'utf8')}`;
    expect(snapshot.events[0].occurredAt).toBe('2026-07-25T00:00:00.000Z');
    expect(snapshot.events[0].payload).toEqual({ text: 'legacy [REDACTED]' });
    expect(snapshot.index.lastSyncedAt).toBe('2026-07-25T00:00:00.000Z');
    expect(snapshot.index.message).toBe('legacy [REDACTED]');
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain(offsetTime);
  });

  it('rejects noncanonical, commented, controlled, and oversized timestamps safely', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const badTimestamps = [
      'Sat, 25 Jul 2026 08:00:00 GMT (timestamp-secret)',
      '2026-07-25T08:00:00.000Z\nSECRET',
      `2026-07-25T08:00:00.000Z${'x'.repeat(64)}`,
      '2026-02-30T08:00:00.000Z',
    ];
    for (const timestamp of badTimestamps) {
      const error = await rejectionOf(store.appendBatch(validBatch({
        syncedAt: timestamp,
        events: [nativeUserEvent({ occurredAt: timestamp })],
      })));
      expect(error.message).toContain('时间字段无效');
      expectSafeError(error, [timestamp, 'timestamp-secret', 'SECRET']);
    }
    await expect(store.appendBatch(validBatch({
      syncedAt: '2026-07-25T08:00:00+08:00',
      events: [nativeUserEvent({ occurredAt: '2026-07-25T08:00:00+08:00' })],
    }))).resolves.toBeDefined();
  });

  it('enforces private identifier, cursor, message, path, and seen-key boundaries', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const overIdentifier = 'a'.repeat(257);
    const overCursor = 'A'.repeat(48_001);
    const overMessage = 'm'.repeat(241);
    const overPath = `/${'界'.repeat(2_048)}`;
    const binding = {
      sessionId: 'session-1',
      runId: 'run-1',
      source: 'claude' as const,
      nativeSessionId: 'native-session-1',
      workspacePath: path.join(tempDir, 'workspace'),
      recordHome: path.join(tempDir, 'records'),
      startedAt: occurredAt,
    };
    const operations = [
      store.appendBatch(validBatch({
        runId: overIdentifier,
        events: [nativeUserEvent({ runId: overIdentifier })],
      })),
      store.appendBatch(validBatch({
        events: [nativeUserEvent({ eventId: overIdentifier })],
      })),
      store.updateSyncState({ sessionId: 'session-1', status: 'pending', cursor: overCursor }),
      store.updateSyncState({ sessionId: 'session-1', status: 'pending', message: overMessage }),
      store.updateSyncState({
        sessionId: 'session-1',
        status: 'pending',
        binding: { ...binding, nativeSessionId: overIdentifier },
      }),
      store.updateSyncState({
        sessionId: 'session-1',
        status: 'pending',
        binding: { ...binding, workspacePath: overPath },
      }),
      store.updateSyncState({
        sessionId: 'session-1',
        status: 'pending',
        binding: { ...binding, workspacePath: 'relative/path' },
      }),
    ];
    for (const operation of operations) {
      const error = await rejectionOf(operation);
      expectSafeError(error, [overIdentifier, overCursor, overMessage, overPath]);
    }

    await store.appendBatch(validBatch());
    const paths = recordPaths();
    const rawIndex = JSON.parse(await readFile(paths.index, 'utf-8')) as Record<string, unknown>;
    rawIndex.seenEventKeys = [`claude:${'a'.repeat(281)}`];
    await writeFile(paths.index, JSON.stringify(rawIndex), 'utf-8');
    const recovered = await store.readSnapshot('session-1');
    expect(recovered.index.status).toBe('stale');
    expect(await readFile(paths.index, 'utf-8')).not.toContain('a'.repeat(281));
  });

  it('counts raw duplicate events and serialized bytes against batch limits', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const exactEvents = Array.from({ length: SESSION_RECORD_BATCH_MAX_EVENTS }, (_, index) => (
      nativeUserEvent({
        eventId: `batch-${String(index).padStart(4, '0')}`,
        sessionId: 'batch-count',
        sequence: index,
      })
    ));
    await store.appendBatch(validBatch({ sessionId: 'batch-count', events: exactEvents }));
    await expect(store.readSnapshot('batch-count')).resolves.toMatchObject({
      events: expect.arrayContaining([expect.objectContaining({ eventId: 'batch-0000' })]),
    });

    const duplicateEvent = nativeUserEvent({ sessionId: 'duplicate-count' });
    const duplicateError = await rejectionOf(store.appendBatch(validBatch({
      sessionId: 'duplicate-count',
      events: Array.from({ length: SESSION_RECORD_BATCH_MAX_EVENTS + 1 }, () => duplicateEvent),
    })));
    expect(duplicateError.message).toContain('事件数量限制');
    await expect(readFile(recordPaths('duplicate-count').events, 'utf-8')).rejects.toThrow();
    await expect(readFile(recordPaths('duplicate-count').index, 'utf-8')).rejects.toThrow();

    const largeText = 'x'.repeat(120_000);
    const sample = nativeUserEvent({ sessionId: 'batch-bytes', text: largeText, eventId: 'batch-0000' });
    const lineBytes = Buffer.byteLength(`${JSON.stringify(sample)}\n`, 'utf8');
    const fittingCount = Math.floor(SESSION_RECORD_BATCH_MAX_BYTES / lineBytes);
    const fittingEvents = Array.from({ length: fittingCount }, (_, index) => nativeUserEvent({
      sessionId: 'batch-bytes',
      eventId: `batch-${String(index).padStart(4, '0')}`,
      text: largeText,
      sequence: index,
    }));
    await store.appendBatch(validBatch({ sessionId: 'batch-bytes', events: fittingEvents }));
    const byteError = await rejectionOf(store.appendBatch(validBatch({
      sessionId: 'batch-bytes-over',
      events: Array.from({ length: fittingCount + 1 }, (_, index) => nativeUserEvent({
        sessionId: 'batch-bytes-over',
        eventId: `batch-${String(index).padStart(4, '0')}`,
        text: largeText,
        sequence: index,
      })),
    })));
    expect(byteError.message).toContain('字节限制');
    await expect(readFile(recordPaths('batch-bytes-over').events, 'utf-8')).rejects.toThrow();
  });

  it('fails closed before reading oversized index or event files', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch());
    const paths = recordPaths();
    const indexMarker = 'OVERSIZED_INDEX_MARKER';
    await writeFile(
      paths.index,
      Buffer.concat([Buffer.from(indexMarker, 'utf8'), Buffer.alloc(SESSION_RECORD_INDEX_MAX_BYTES, 0x20)]),
    );
    const indexError = await rejectionOf(store.readSnapshot('session-1'));
    expectSafeError(indexError, [indexMarker]);

    await writeFile(paths.index, JSON.stringify({ schemaVersion: 1, seenEventKeys: [], status: 'pending', truncated: false }));
    const eventMarker = 'OVERSIZED_EVENTS_MARKER';
    await writeFile(
      paths.events,
      Buffer.concat([Buffer.from(eventMarker, 'utf8'), Buffer.alloc(SESSION_RECORD_EVENTS_READ_MAX_BYTES, 0x20)]),
    );
    const eventError = await rejectionOf(store.readSnapshot('session-1'));
    expectSafeError(eventError, [eventMarker]);
  });

  it('serializes concurrent appends for one session without losing events', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const eventCount = 80;

    await Promise.all(
      Array.from({ length: eventCount }, (_, index) => store.appendBatch(validBatch({
        cursor: `cursor-${index}`,
        events: [nativeUserEvent({
          eventId: `concurrent-${index}`,
          text: `event-${index}`,
          sequence: index,
        })],
      }))),
    );

    const snapshot = await store.readSnapshot('session-1');
    expect(snapshot.events.map(({ eventId }) => eventId)).toEqual(
      Array.from({ length: eventCount }, (_, index) => `concurrent-${index}`),
    );
    expect(snapshot.index.seenEventKeys).toHaveLength(eventCount);
    expect(snapshot.index.cursor).toBe(`cursor-${eventCount - 1}`);
    expect((await readFile(recordPaths().events, 'utf-8')).trimEnd().split('\n')).toHaveLength(eventCount);
  });

  it('truncates only readable payload text at 128 KiB without breaking UTF-8 or JSON', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const oversizedText = `${'中文🌟'.repeat(40_000)}END_MARKER`;
    const snapshot = await store.appendBatch(validBatch({
      events: [nativeUserEvent({ text: oversizedText })],
    }));
    const rawLine = (await readFile(recordPaths().events, 'utf-8')).trimEnd();
    const persisted = JSON.parse(rawLine) as Extract<SessionRecordEventDto, { kind: 'user_message' }>;

    expect(Buffer.byteLength(rawLine, 'utf-8')).toBeLessThanOrEqual(SESSION_RECORD_EVENT_MAX_BYTES);
    expect(persisted.truncated).toBe(true);
    expect(snapshot.events[0].truncated).toBe(true);
    expect(persisted.payload.text).not.toContain('\uFFFD');
    expect(Buffer.from(persisted.payload.text, 'utf-8').toString('utf-8')).toBe(persisted.payload.text);
    expect(oversizedText.startsWith(persisted.payload.text)).toBe(true);
    expect(persisted.payload.text).not.toContain('END_MARKER');

    const structuralError = await rejectionOf(store.appendBatch(validBatch({
      sessionId: 'structural-limit',
      events: [nativeUserEvent({
        sessionId: 'structural-limit',
        eventId: 'x'.repeat(SESSION_RECORD_EVENT_MAX_BYTES),
        text: 'small readable payload',
      })],
    })));
    expect(structuralError.message).toContain('结构超过大小限制');
    expectSafeError(structuralError, [tempDir, 'small readable payload']);
    await expect(readFile(recordPaths('structural-limit').events, 'utf-8')).rejects.toThrow();
  });

  it('rejects a tool call when only an invalid empty toolName would fit the event limit', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const sessionId = 'tool-name-boundary';
    const emptyNameSkeleton = nativeToolCallEvent({
      eventId: '',
      sessionId,
      toolName: '',
    });
    const structuralBytes = Buffer.byteLength(JSON.stringify({
      ...emptyNameSkeleton,
      truncated: true,
    }), 'utf-8');
    const eventIdLength = SESSION_RECORD_EVENT_MAX_BYTES - structuralBytes;
    expect(eventIdLength).toBeGreaterThan(0);
    const eventId = 'e'.repeat(eventIdLength);
    const emptyNameEvent = { ...emptyNameSkeleton, eventId };
    const oneCharacterNameEvent = {
      ...emptyNameEvent,
      payload: { toolName: 'x' },
    };
    expect(Buffer.byteLength(JSON.stringify({
      ...emptyNameEvent,
      truncated: true,
    }), 'utf-8')).toBe(
      SESSION_RECORD_EVENT_MAX_BYTES,
    );
    expect(Buffer.byteLength(JSON.stringify({
      ...oneCharacterNameEvent,
      truncated: true,
    }), 'utf-8')).toBe(
      SESSION_RECORD_EVENT_MAX_BYTES + 1,
    );

    const error = await rejectionOf(store.appendBatch(validBatch({
      sessionId,
      events: [oneCharacterNameEvent],
    })));
    expect(error.message).toContain('结构超过大小限制');
    expectSafeError(error, [tempDir, eventId.slice(0, 128)]);
    await expect(readFile(recordPaths(sessionId).events, 'utf-8')).rejects.toThrow();
    await expect(readFile(recordPaths(sessionId).index, 'utf-8')).rejects.toThrow();
  });

  it('retains the latest 50,000 complete events through the public append API', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const inputEventCount = SESSION_RECORD_MAX_EVENTS + 1;
    const events = Array.from({ length: inputEventCount }, (_, index) => nativeUserEvent({
      eventId: `event-${index}`,
      text: `payload-${index}`,
      sequence: index,
    }));

    for (let offset = 0; offset < events.length; offset += SESSION_RECORD_BATCH_MAX_EVENTS) {
      await store.appendBatch(validBatch({
        cursor: `cursor-${offset}`,
        events: events.slice(offset, offset + SESSION_RECORD_BATCH_MAX_EVENTS),
      }));
    }
    const snapshot = await store.readSnapshot('session-1');
    const rawEvents = await readFile(recordPaths().events, 'utf-8');

    expect(snapshot.events).toHaveLength(SESSION_RECORD_MAX_EVENTS);
    expect(snapshot.events[0].eventId).toBe('event-1');
    expect(snapshot.events.at(-1)?.eventId).toBe(`event-${SESSION_RECORD_MAX_EVENTS}`);
    expect(snapshot.index.seenEventKeys).toHaveLength(SESSION_RECORD_MAX_EVENTS);
    expect(snapshot.index.truncated).toBe(true);
    expect(rawEvents.trimEnd().split('\n')).toHaveLength(SESSION_RECORD_MAX_EVENTS);
    expect(snapshot.byteSize).toBe(Buffer.byteLength(rawEvents, 'utf-8'));

    const paths = recordPaths();
    await rm(paths.index);
    const missingIndexRecovery = await store.readSnapshot('session-1');
    expect(missingIndexRecovery.events).toHaveLength(SESSION_RECORD_MAX_EVENTS);
    expect(missingIndexRecovery.index).toMatchObject({
      status: 'stale',
      truncated: true,
    });

    await writeFile(paths.index, '{damaged-index', 'utf-8');
    const damagedIndexRecovery = await store.readSnapshot('session-1');
    expect(damagedIndexRecovery.events).toHaveLength(SESSION_RECORD_MAX_EVENTS);
    expect(damagedIndexRecovery.index).toMatchObject({
      status: 'stale',
      truncated: true,
    });
  }, 60_000);

  it('keeps a latest complete suffix within the real 64 MiB file limit', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const payloadText = 'x'.repeat(130_500);
    const sampleLineBytes = Buffer.byteLength(
      `${JSON.stringify(nativeUserEvent({ eventId: 'size-0000', text: payloadText }))}\n`,
      'utf-8',
    );
    expect(sampleLineBytes - 1).toBeLessThanOrEqual(SESSION_RECORD_EVENT_MAX_BYTES);
    const inputEventCount = Math.ceil(SESSION_RECORD_FILE_MAX_BYTES / sampleLineBytes) + 1;
    const events = Array.from({ length: inputEventCount }, (_, index) => nativeUserEvent({
      eventId: `size-${String(index).padStart(4, '0')}`,
      text: payloadText,
      sequence: index,
    }));

    let snapshot = await store.appendBatch(validBatch({
      cursor: 'cursor-size-0',
      events: events.slice(0, 48),
    }));
    for (let offset = 48; offset < events.length; offset += 48) {
      snapshot = await store.appendBatch(validBatch({
        cursor: `cursor-size-${offset}`,
        events: events.slice(offset, offset + 48),
      }));
    }
    const rawEvents = await readFile(recordPaths().events, 'utf-8');
    const fileSize = (await stat(recordPaths().events)).size;
    const withoutFinalNewline = rawEvents.slice(0, -1);
    const firstNewline = withoutFinalNewline.indexOf('\n');
    const lastNewline = withoutFinalNewline.lastIndexOf('\n');
    const firstPersisted = JSON.parse(
      withoutFinalNewline.slice(0, firstNewline),
    ) as SessionRecordEventDto;
    const lastPersisted = JSON.parse(
      withoutFinalNewline.slice(lastNewline + 1),
    ) as SessionRecordEventDto;

    expect(snapshot.index.truncated).toBe(true);
    expect(snapshot.events.length).toBeLessThan(inputEventCount);
    expect(snapshot.events[0].eventId).not.toBe('size-0000');
    expect(snapshot.events.at(-1)?.eventId).toBe(`size-${String(inputEventCount - 1).padStart(4, '0')}`);
    expect(fileSize).toBeLessThanOrEqual(SESSION_RECORD_FILE_MAX_BYTES);
    expect(fileSize).toBeGreaterThan(
      SESSION_RECORD_FILE_MAX_BYTES - SESSION_RECORD_EVENT_MAX_BYTES - 1,
    );
    expect(snapshot.byteSize).toBe(fileSize);
    expect(rawEvents.endsWith('\n')).toBe(true);
    expect((rawEvents.match(/\n/g) ?? [])).toHaveLength(snapshot.events.length);
    expect(firstPersisted.eventId).toBe(snapshot.events[0].eventId);
    expect(lastPersisted.eventId).toBe(snapshot.events.at(-1)?.eventId);

    await rm(recordPaths().index);
    const recovered = await store.readSnapshot('session-1');
    expect(recovered.events[0].eventId).toBe(firstPersisted.eventId);
    expect(recovered.events.at(-1)?.eventId).toBe(lastPersisted.eventId);
    expect(recovered.index).toMatchObject({ status: 'stale', truncated: true });
    expect(recovered.byteSize).toBe(fileSize);
  }, 60_000);

  it('keeps truncation evidence when an old index proves retained events lost known keys', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const binding = {
      sessionId: 'session-1',
      runId: 'run-1',
      source: 'claude' as const,
      nativeSessionId: 'native-retention-window',
      workspacePath: '/synthetic/retention-workspace',
      recordHome: '/synthetic/retention-home',
      startedAt: occurredAt,
    };
    await store.updateSyncState({
      sessionId: 'session-1',
      status: 'syncing',
      source: 'claude',
      binding,
      cursor: 'cursor-before-retention',
    });
    const droppedEvent = nativeUserEvent({
      eventId: 'old-event',
      text: 'dropped-before-index-commit',
      sequence: 1,
    });
    const retainedEvent = nativeUserEvent({
      eventId: 'retained-event',
      text: 'retained-after-replacement',
      sequence: 2,
    });
    await store.appendBatch(validBatch({
      cursor: 'cursor-before-retention',
      events: [droppedEvent, retainedEvent],
    }));
    const appendedBeforeIndex = nativeUserEvent({
      eventId: 'appended-before-index',
      text: 'retained-new-event',
      sequence: 3,
    });
    await writeFile(
      recordPaths().events,
      [retainedEvent, appendedBeforeIndex]
        .map((event) => `${JSON.stringify(event)}\n`)
        .join(''),
      'utf-8',
    );

    const recovered = await store.readSnapshot('session-1');
    expect(recovered.events.map(({ eventId }) => eventId)).toEqual([
      'retained-event',
      'appended-before-index',
    ]);
    expect(recovered.index).toMatchObject({
      source: 'claude',
      binding,
      cursor: 'cursor-before-retention',
      seenEventKeys: ['claude:retained-event', 'claude:appended-before-index'],
      status: 'stale',
      truncated: true,
    });
  });

  it('rebuilds missing and damaged indexes as stale and restores deduplication', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch({
      events: [
        nativeUserEvent({ eventId: 'native-1', sequence: 1 }),
        nativeUserEvent({ eventId: 'native-2', sequence: 2 }),
      ],
    }));
    const paths = recordPaths();
    await rm(paths.index);

    const missingIndexSnapshot = await store.readSnapshot('session-1');
    expect(missingIndexSnapshot.index).toMatchObject({
      status: 'stale',
      source: 'claude',
      seenEventKeys: ['claude:native-1', 'claude:native-2'],
      truncated: false,
    });
    await writeFile(paths.index, '{damaged-index', 'utf-8');
    const damagedIndexSnapshot = await store.readSnapshot('session-1');
    expect(damagedIndexSnapshot.index).toMatchObject({
      status: 'stale',
      truncated: false,
    });
    expect(damagedIndexSnapshot.events).toHaveLength(2);

    await store.appendBatch(validBatch({
      cursor: 'cursor-after-rebuild',
      events: [nativeUserEvent({ eventId: 'native-1' })],
    }));
    const rawEvents = await readFile(paths.events, 'utf-8');
    const rebuiltIndex = JSON.parse(await readFile(paths.index, 'utf-8')) as {
      status: string;
      cursor: string;
      seenEventKeys: string[];
    };
    expect(rawEvents.trimEnd().split('\n')).toHaveLength(2);
    expect(rebuiltIndex).toMatchObject({
      status: 'ready',
      cursor: 'cursor-after-rebuild',
      seenEventKeys: ['claude:native-1', 'claude:native-2'],
    });
    if (process.platform !== 'win32') {
      expect(await posixMode(paths.index)).toBe(0o600);
    }
  });

  it('repairs an incomplete tail, preserves complete events, and marks the index stale', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch({
      events: [
        nativeUserEvent({ eventId: 'native-1', sequence: 1 }),
        nativeUserEvent({ eventId: 'native-2', sequence: 2 }),
      ],
    }));
    const paths = recordPaths();
    const validContents = await readFile(paths.events, 'utf-8');
    await appendFile(paths.events, '{"eventId":"INCOMPLETE_TAIL_MARKER"', 'utf-8');

    const snapshot = await store.readSnapshot('session-1');
    const repairedContents = await readFile(paths.events, 'utf-8');
    expect(snapshot.events.map(({ eventId }) => eventId)).toEqual(['native-1', 'native-2']);
    expect(snapshot.index.status).toBe('stale');
    expect(repairedContents).toBe(validContents);
    expect(repairedContents).not.toContain('INCOMPLETE_TAIL_MARKER');
    expect(snapshot.byteSize).toBe(Buffer.byteLength(repairedContents, 'utf-8'));
  });

  it('stops at a damaged middle line, marks failed, and never trusts later text', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch({
      events: [
        nativeUserEvent({ eventId: 'native-1', text: 'trusted-before', sequence: 1 }),
        nativeUserEvent({ eventId: 'native-2', text: 'UNTRUSTED_AFTER_MARKER', sequence: 2 }),
      ],
    }));
    const paths = recordPaths();
    const [firstLine, secondLine] = (await readFile(paths.events, 'utf-8')).trimEnd().split('\n');
    const validPrefix = `${firstLine}\n`;
    await writeFile(paths.events, `${validPrefix}{"damaged":\n${secondLine}\n`, 'utf-8');

    const snapshot = await store.readSnapshot('session-1');
    const persistedIndex = await readFile(paths.index, 'utf-8');
    expect(snapshot.events.map(({ eventId }) => eventId)).toEqual(['native-1']);
    expect(snapshot.index.status).toBe('failed');
    expect(snapshot.index.seenEventKeys).toEqual(['claude:native-1']);
    expect(snapshot.byteSize).toBe(Buffer.byteLength(validPrefix, 'utf-8'));
    expect(persistedIndex).not.toContain('UNTRUSTED_AFTER_MARKER');
    expect(persistedIndex).not.toContain('damaged');

    const appendError = await rejectionOf(store.appendBatch(validBatch({
      events: [nativeUserEvent({ eventId: 'native-3', text: 'must-not-append' })],
    })));
    expect(appendError.message).toContain('损坏');
    expectSafeError(appendError, [tempDir, 'must-not-append', 'UNTRUSTED_AFTER_MARKER']);
  });

  it('preserves duplicate-corrupted evidence and keeps all write gates closed', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const trustedOne = nativeUserEvent({
      eventId: 'native-1',
      text: 'trusted-one',
      sequence: 1,
    });
    const untrustedTwo = nativeUserEvent({
      eventId: 'native-2',
      text: 'UNTRUSTED_TWO_MARKER',
      sequence: 2,
    });
    await store.appendBatch(validBatch({ events: [trustedOne, untrustedTwo] }));
    const paths = recordPaths();
    const trustedLine = `${JSON.stringify(trustedOne)}\n`;
    const untrustedLine = `${JSON.stringify(untrustedTwo)}\n`;
    const corruptedContents = `${trustedLine}${trustedLine}{"damaged":true}\n${untrustedLine}`;
    await writeFile(paths.events, corruptedContents, 'utf-8');

    const firstSnapshot = await store.readSnapshot('session-1');
    expect(firstSnapshot.events.map(({ eventId }) => eventId)).toEqual(['native-1']);
    expect(firstSnapshot.index).toMatchObject({
      status: 'failed',
      seenEventKeys: ['claude:native-1'],
      truncated: false,
    });
    expect(await readFile(paths.events, 'utf-8')).toBe(corruptedContents);
    const failedIndexContents = await readFile(paths.index, 'utf-8');

    const updateError = await rejectionOf(store.updateSyncState({
      sessionId: 'session-1',
      status: 'ready',
      cursor: 'must-not-write-cursor',
      lastSyncedAt: '2026-07-25T08:02:00.000Z',
      message: 'must-not-write-sync-state',
      truncated: true,
    }));
    expect(await readFile(paths.index, 'utf-8')).toBe(failedIndexContents);
    expect(await readFile(paths.events, 'utf-8')).toBe(corruptedContents);

    const batchError = await rejectionOf(store.appendBatch(validBatch({
      events: [nativeUserEvent({ eventId: 'native-3', text: 'must-not-append-batch' })],
    })));
    const statusError = await rejectionOf(store.appendStatus({
      sessionId: 'session-1',
      runId: 'run-1',
      event: statusEvent({ eventId: 'status-blocked', text: 'must-not-append-status' }),
    }));
    for (const error of [updateError, batchError, statusError]) {
      expect(error.message).toContain('损坏');
      expectSafeError(error, [
        tempDir,
        'trusted-one',
        'UNTRUSTED_TWO_MARKER',
        'must-not-write-cursor',
        'must-not-write-sync-state',
        'must-not-append-batch',
        'must-not-append-status',
        'damaged',
      ]);
    }
    expect(await readFile(paths.index, 'utf-8')).toBe(failedIndexContents);
    expect(await readFile(paths.events, 'utf-8')).toBe(corruptedContents);

    const finalSnapshot = await store.readSnapshot('session-1');
    expect(finalSnapshot.events.map(({ eventId }) => eventId)).toEqual(['native-1']);
    expect(finalSnapshot.index).toMatchObject({
      status: 'failed',
      seenEventKeys: ['claude:native-1'],
      truncated: false,
    });
    expect(await readFile(paths.events, 'utf-8')).toBe(corruptedContents);
  });

  it('persists index-only failure status while middle corruption blocks sync progress', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch({
      events: [
        nativeUserEvent({ eventId: 'native-1', text: 'trusted-before', sequence: 1 }),
        nativeUserEvent({ eventId: 'native-2', text: 'after-damage', sequence: 2 }),
      ],
    }));
    const paths = recordPaths();
    const [firstLine, secondLine] = (await readFile(paths.events, 'utf-8')).trimEnd().split('\n');
    const corruptedContents = `${firstLine}\n{"damaged":\n${secondLine}\n`;
    await writeFile(paths.events, corruptedContents, 'utf-8');
    await store.readSnapshot('session-1');

    // SPEC §8.3：损坏后同步服务仍要能持久化失败/退避状态（只写 index.json）。
    await store.updateSyncState({
      sessionId: 'session-1',
      status: 'failed',
      message: '同步失败，等待重试。',
      lastSyncedAt: '2026-07-25T08:02:00.000Z',
    });
    const snapshot = await store.readSnapshot('session-1');
    expect(snapshot.index.status).toBe('failed');
    expect(snapshot.index.message).toBe('同步失败，等待重试。');
    expect(snapshot.index.lastSyncedAt).toBe('2026-07-25T08:02:00.000Z');
    // 事件文件保持原样：index-only 写入绝不触碰损坏证据。
    expect(await readFile(paths.events, 'utf-8')).toBe(corruptedContents);

    // 推进 cursor 属于同步进度，损坏时仍然拒绝。
    const cursorError = await rejectionOf(store.updateSyncState({
      sessionId: 'session-1',
      status: 'ready',
      cursor: 'must-not-write-cursor',
    }));
    expect(cursorError.message).toContain('损坏');
    expect(await readFile(paths.events, 'utf-8')).toBe(corruptedContents);
  });

  it('allows a healthy failed sync state to recover through updates and appends', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch());

    await store.updateSyncState({
      sessionId: 'session-1',
      status: 'failed',
      message: 'synthetic-retryable-failure',
    });
    await store.updateSyncState({
      sessionId: 'session-1',
      status: 'ready',
      message: undefined,
    });
    expect((await store.readSnapshot('session-1')).index.status).toBe('ready');

    await store.updateSyncState({ sessionId: 'session-1', status: 'failed' });
    const recovered = await store.appendBatch(validBatch({
      events: [nativeUserEvent({ eventId: 'native-2', sequence: 2 })],
    }));
    expect(recovered.events.map(({ eventId }) => eventId)).toEqual(['native-1', 'native-2']);
    expect(recovered.index.status).toBe('ready');
  });

  it('rolls back events and index when a guarded commit expires after writing', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch({ cursor: 'cursor-good' }));
    const paths = recordPaths();
    const eventsBefore = await readFile(paths.events, 'utf-8');
    const indexBefore = await readFile(paths.index, 'utf-8');
    let guardChecks = 0;

    await expect(store.appendBatch(validBatch({
      cursor: 'cursor-late',
      events: [nativeUserEvent({ eventId: 'native-late', sequence: 2 })],
    }), {
      guard: () => {
        guardChecks += 1;
        return guardChecks < 5;
      },
    })).rejects.toThrow('提交已失效');

    expect(guardChecks).toBe(5);
    await expect(readFile(paths.events, 'utf-8')).resolves.toBe(eventsBefore);
    await expect(readFile(paths.index, 'utf-8')).resolves.toBe(indexBefore);
    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      events: [expect.objectContaining({ eventId: 'native-1' })],
      index: expect.objectContaining({ cursor: 'cursor-good' }),
    });
  });

  it('restores a stale committed version only when the expected version still matches', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const base = await store.appendBatch(validBatch({ cursor: 'cursor-base' }));
    const committed = await store.appendBatch(validBatch({
      cursor: 'cursor-committed',
      events: [nativeUserEvent({ eventId: 'native-committed', sequence: 2 })],
    }));

    await expect(store.restoreSnapshotIfCurrent({
      sessionId: 'session-1',
      expected: committed,
      restore: base,
    })).resolves.toBe(true);
    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      events: [expect.objectContaining({ eventId: 'native-1' })],
      index: expect.objectContaining({ cursor: 'cursor-base' }),
    });

    const current = await store.appendBatch(validBatch({
      cursor: 'cursor-newer',
      events: [nativeUserEvent({ eventId: 'native-newer', sequence: 3 })],
    }));
    await expect(store.restoreSnapshotIfCurrent({
      sessionId: 'session-1',
      expected: committed,
      restore: base,
    })).resolves.toBe(false);
    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      events: [
        expect.objectContaining({ eventId: 'native-1' }),
        expect.objectContaining({ eventId: 'native-newer' }),
      ],
      index: expect.objectContaining({ cursor: current.index.cursor }),
    });

    let guardChecks = 0;
    await expect(store.restoreSnapshotIfCurrent({
      sessionId: 'session-1',
      expected: current,
      restore: base,
    }, {
      guard: () => {
        guardChecks += 1;
        return guardChecks < 3;
      },
    })).rejects.toThrow('提交已失效');
    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      events: [
        expect.objectContaining({ eventId: 'native-1' }),
        expect.objectContaining({ eventId: 'native-newer' }),
      ],
      index: expect.objectContaining({ cursor: 'cursor-newer' }),
    });
  });

  it('persists binding only in the private index and supports status and sync updates', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const binding = {
      sessionId: 'session-1',
      runId: 'run-1',
      source: 'codex' as const,
      nativeSessionId: 'native-session-synthetic',
      workspacePath: '/synthetic/workspace/path',
      recordHome: '/synthetic/record/home',
      startedAt: occurredAt,
    };
    await store.updateSyncState({
      sessionId: 'session-1',
      status: 'syncing',
      source: 'codex',
      binding,
      cursor: 'private-cursor-1',
      lastSyncedAt: occurredAt,
      message: '合成同步状态',
    });
    await store.appendBatch(validBatch({
      source: 'codex',
      cursor: 'private-cursor-2',
      events: [nativeUserEvent({ source: 'codex' })],
    }));
    await store.appendStatus({ sessionId: 'session-1', runId: 'run-1', event: statusEvent() });
    await store.appendStatus({ sessionId: 'session-1', runId: 'run-1', event: statusEvent() });
    await store.updateSyncState({
      sessionId: 'session-1',
      status: 'ready',
      lastSyncedAt: '2026-07-25T08:01:00.000Z',
    });

    const snapshot = await store.readSnapshot('session-1');
    const rawEvents = await readFile(recordPaths().events, 'utf-8');
    const rawIndex = await readFile(recordPaths().index, 'utf-8');
    expect(snapshot.events.map(({ kind }) => kind)).toEqual(['user_message', 'status']);
    expect(snapshot.index).toMatchObject({
      source: 'codex',
      binding,
      cursor: 'private-cursor-2',
      status: 'ready',
      lastSyncedAt: '2026-07-25T08:01:00.000Z',
    });
    for (const privateValue of [
      binding.nativeSessionId,
      binding.workspacePath,
      binding.recordHome,
      'private-cursor-2',
    ]) {
      expect(rawEvents).not.toContain(privateValue);
      expect(rawIndex).toContain(privateValue);
    }
  });

  it('keeps the native source and ready status when source is explicitly cleared', async () => {
    const store = createSessionRecordEventStore(tempDir);
    await store.appendBatch(validBatch());

    await store.updateSyncState({
      sessionId: 'session-1',
      status: 'ready',
      source: undefined,
    });

    const rawIndex = JSON.parse(await readFile(recordPaths().index, 'utf-8')) as {
      source?: string;
      status: string;
    };
    expect(rawIndex).toMatchObject({ source: 'claude', status: 'ready' });
    const reread = await store.readSnapshot('session-1');
    expect(reread.index).toMatchObject({ source: 'claude', status: 'ready' });
  });

  it('deletes only the selected record directory and remains idempotent', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const transcriptPath = path.join(tempDir, 'session-transcripts', 'session-1.log');
    const summaryPath = path.join(tempDir, 'session-summaries', 'session-1.md');
    const workspacePath = path.join(tempDir, 'workspace', 'source.ts');
    await mkdir(path.dirname(transcriptPath), { recursive: true });
    await mkdir(path.dirname(summaryPath), { recursive: true });
    await mkdir(path.dirname(workspacePath), { recursive: true });
    await writeFile(transcriptPath, 'synthetic transcript', 'utf-8');
    await writeFile(summaryPath, 'synthetic summary', 'utf-8');
    await writeFile(workspacePath, 'synthetic workspace source', 'utf-8');
    await store.appendBatch(validBatch());
    await store.appendBatch(validBatch({
      sessionId: 'session-2',
      events: [nativeUserEvent({ sessionId: 'session-2' })],
    }));

    const deletedDirectory = recordPaths('session-1').directory;
    const retainedDirectory = recordPaths('session-2').directory;
    await store.deleteSession('session-1');
    await store.deleteSession('session-1');

    await expect(stat(deletedDirectory)).rejects.toThrow();
    await expect(stat(retainedDirectory)).resolves.toBeDefined();
    await expect(store.readSnapshot('session-2')).resolves.toMatchObject({
      events: [expect.objectContaining({ sessionId: 'session-2' })],
    });
    await expect(readFile(transcriptPath, 'utf-8')).resolves.toBe('synthetic transcript');
    await expect(readFile(summaryPath, 'utf-8')).resolves.toBe('synthetic summary');
    await expect(readFile(workspacePath, 'utf-8')).resolves.toBe('synthetic workspace source');
  });

  it.skipIf(process.platform === 'win32')('rejects a symlink session directory without touching its target', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const externalDirectory = path.join(tempDir, 'external-record-target');
    const externalMarker = path.join(externalDirectory, 'marker.txt');
    const paths = recordPaths();
    await mkdir(paths.root, { recursive: true, mode: 0o700 });
    await mkdir(externalDirectory, { mode: 0o755 });
    await writeFile(externalMarker, 'external content stays intact', { mode: 0o644 });
    await symlink(externalDirectory, paths.directory);

    const readError = await rejectionOf(store.readSnapshot('session-1'));
    const deleteError = await rejectionOf(store.deleteSession('session-1'));
    expectSafeError(readError, [tempDir, externalDirectory]);
    expectSafeError(deleteError, [tempDir, externalDirectory]);
    await expect(readFile(externalMarker, 'utf-8')).resolves.toBe('external content stays intact');
  });
});
