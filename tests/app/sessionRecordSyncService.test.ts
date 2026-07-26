import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecordEventDto } from '../../src/shared/agentdockTypes.js';
import {
  createSessionRecordSyncService,
  type SessionRecordSyncScheduler,
} from '../../src/main/sessionRecordSyncService.js';
import type {
  RecordSourceAdapter,
  RecordSourceBatch,
  RecordSourceBinding,
  RecordSourceCapability,
} from '../../src/main/recordSources/types.js';
import { createSessionRecordEventStore } from '../../src/main/stores/sessionRecordEventStore.js';

const occurredAt = '2026-07-25T08:00:00.000Z';
let tempDir: string;

type FakeClock = {
  now(): Date;
  advance(ms: number): void;
};

function fakeClock(): FakeClock {
  let time = Date.parse(occurredAt);
  return {
    now: () => new Date(time),
    advance: (ms) => { time += ms; },
  };
}

function fakeScheduler(clock: FakeClock): SessionRecordSyncScheduler & {
  advance(ms: number): Promise<void>;
  flush(): Promise<void>;
  pending(): number;
} {
  type Timer = { at: number; callback: () => void; canceled: boolean };
  const timers: Timer[] = [];
  const scheduler: SessionRecordSyncScheduler & {
    advance(ms: number): Promise<void>;
    flush(): Promise<void>;
    pending(): number;
  } = {
    set(callback, delayMs) {
      const timer = { at: clock.now().getTime() + delayMs, callback, canceled: false };
      timers.push(timer);
      return timer;
    },
    clear(handle) {
      if (typeof handle === 'object' && handle !== null && 'canceled' in handle) {
        (handle as Timer).canceled = true;
      }
    },
    async advance(ms) {
      clock.advance(ms);
      await scheduler.flush();
    },
    async flush() {
      let ran = true;
      while (ran) {
        ran = false;
        for (const timer of [...timers]) {
          if (!timer.canceled && timer.at <= clock.now().getTime()) {
            timer.canceled = true;
            ran = true;
            timer.callback();
          }
        }
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      }
    },
    pending: () => timers.filter((timer) => !timer.canceled).length,
  };
  return scheduler;
}

function binding(overrides: Partial<RecordSourceBinding> = {}): RecordSourceBinding {
  return {
    sessionId: 'session-1',
    runId: 'run-1',
    source: 'codex',
    workspacePath: path.join(tempDir, 'workspace'),
    recordHome: path.join(tempDir, 'codex-home'),
    startedAt: occurredAt,
    ...overrides,
  };
}

function userEvent(overrides: Partial<Extract<SessionRecordEventDto, { kind: 'user_message' }>> = {}) {
  return {
    eventId: 'native-user-1',
    sessionId: 'session-1',
    runId: 'run-1',
    sequence: 1,
    occurredAt,
    timeSource: 'native' as const,
    source: 'codex' as const,
    trust: 'native' as const,
    truncated: false,
    kind: 'user_message' as const,
    payload: { text: '合成用户消息' },
    ...overrides,
  };
}

function assistantEvent(overrides: Partial<Extract<SessionRecordEventDto, { kind: 'assistant_message' }>> = {}) {
  return {
    eventId: 'native-assistant-1',
    sessionId: 'session-1',
    runId: 'run-1',
    sequence: 2,
    occurredAt: '2026-07-25T08:00:01.000Z',
    timeSource: 'native' as const,
    source: 'codex' as const,
    trust: 'native' as const,
    truncated: false,
    kind: 'assistant_message' as const,
    payload: { text: '合成 Agent 回复' },
    ...overrides,
  };
}

function batch(overrides: Partial<RecordSourceBatch> = {}): RecordSourceBatch {
  return {
    status: 'ready',
    events: [userEvent()],
    nextCursor: 'cursor-1',
    hasMore: false,
    warnings: [],
    ...overrides,
  };
}

function adapter(
  batches: RecordSourceBatch[] = [batch()],
  capability: RecordSourceCapability = { status: 'ready' },
): RecordSourceAdapter & {
  probe: ReturnType<typeof vi.fn>;
  readIncremental: ReturnType<typeof vi.fn>;
} {
  let index = 0;
  return {
    source: 'codex',
    probe: vi.fn(async () => capability),
    readIncremental: vi.fn(async () => batches[Math.min(index++, batches.length - 1)]),
  } as RecordSourceAdapter & {
    probe: ReturnType<typeof vi.fn>;
    readIncremental: ReturnType<typeof vi.fn>;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-record-sync-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe.sequential('sessionRecordSyncService', () => {
  it('serializes concurrent sync requests and persists each native event once', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const pending = deferred<RecordSourceBatch>();
    const source = adapter();
    source.readIncremental.mockReturnValueOnce(pending.promise);
    const service = createSessionRecordSyncService({
      adapters: [source],
      store,
      clock,
      scheduler,
      retryDelaysMs: [],
    });

    await service.bind(binding());
    const first = service.syncNow('session-1', 'opened');
    await Promise.resolve();
    const second = service.syncNow('session-1', 'manual');
    pending.resolve(batch());
    await Promise.all([first, second]);

    const snapshot = await service.getSnapshot('session-1');
    expect(snapshot.events).toHaveLength(1);
    expect(source.readIncremental).toHaveBeenCalledTimes(1);
  });

  it('loads a private binding and cursor after a service restart', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const firstSource = adapter([batch({ nextCursor: 'cursor-1' })]);
    const first = createSessionRecordSyncService({
      adapters: [firstSource], store, clock, scheduler, retryDelaysMs: [],
    });
    await first.bind(binding());
    await first.syncNow('session-1', 'launch');

    const secondSource = adapter([batch({ events: [assistantEvent()], nextCursor: 'cursor-2' })]);
    const second = createSessionRecordSyncService({
      adapters: [secondSource], store, clock, scheduler, retryDelaysMs: [],
    });
    await second.syncNow('session-1', 'manual');

    expect(secondSource.readIncremental).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
      'cursor-1',
    );
    expect((await second.getSnapshot('session-1')).events).toHaveLength(2);
  });

  it('marks an old session unavailable without inventing role events', async () => {
    const source = adapter();
    const store = createSessionRecordEventStore(tempDir);
    const service = createSessionRecordSyncService({ adapters: [source], store });

    const snapshot = await service.syncNow('session-1', 'opened');

    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.events).toEqual([]);
    expect(source.probe).not.toHaveBeenCalled();
    expect(source.readIncremental).not.toHaveBeenCalled();
  });

  it('upgrades a missing native session id and fails closed on a conflicting id', async () => {
    const clock = fakeClock();
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch()], { status: 'ready', nativeSessionId: 'native-1' });
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, retryDelaysMs: [],
    });
    await service.bind(binding());
    await service.syncNow('session-1', 'launch');
    expect((await store.readSnapshot('session-1')).index.binding?.nativeSessionId).toBe('native-1');

    const conflicting = adapter([batch()], { status: 'ready', nativeSessionId: 'native-2' });
    const second = createSessionRecordSyncService({
      adapters: [conflicting], store, clock, retryDelaysMs: [],
    });
    const result = await second.syncNow('session-1', 'manual');
    expect(result.status).toBe('failed');
    expect(conflicting.readIncremental).not.toHaveBeenCalled();
  });

  it('keeps the persisted binding when a rebind write fails', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch()]);
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    const originalBinding = binding({ nativeSessionId: 'native-1' });
    await service.bind(originalBinding);
    const originalUpdate = store.updateSyncState.bind(store);
    store.updateSyncState = vi.fn(async () => { throw new Error('synthetic bind failure'); });
    await expect(service.bind(binding({ runId: 'run-2', nativeSessionId: 'native-2' }))).rejects.toThrow();
    store.updateSyncState = originalUpdate;
    await service.syncNow('session-1', 'manual');
    expect(source.readIncremental).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', nativeSessionId: 'native-1' }),
      undefined,
    );
    expect((await store.readSnapshot('session-1')).index.binding).toMatchObject({
      runId: 'run-1', nativeSessionId: 'native-1',
    });
  });

  it('debounces PTY notifications and retries failures with bounded delays', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch()]);
    source.readIncremental
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockResolvedValueOnce(batch());
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [250],
    });
    await service.bind(binding());
    service.schedule('session-1', 'pty-output');
    service.schedule('session-1', 'pty-output');
    service.schedule('session-1', 'opened');
    expect(source.readIncremental).not.toHaveBeenCalled();
    await scheduler.advance(250);
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(1));
    await scheduler.advance(250);
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(2));
    expect((await service.getSnapshot('session-1')).status).toBe('ready');
  });

  it('re-probes partial and unavailable sources on a later manual sync', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch({ status: 'partial' }), batch()]);
    source.probe
      .mockResolvedValueOnce({ status: 'partial', reason: 'codex:incomplete' })
      .mockResolvedValueOnce({ status: 'ready' });
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());
    expect((await service.syncNow('session-1', 'launch')).status).toBe('partial');
    expect((await service.syncNow('session-1', 'manual')).status).toBe('ready');
    expect(source.probe).toHaveBeenCalledTimes(2);
  });

  it('uses the bounded 250ms, 1s, and 3s retry sequence', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter();
    source.readIncremental.mockRejectedValue(new Error('synthetic failure'));
    const service = createSessionRecordSyncService({ adapters: [source], store, clock, scheduler });
    await service.bind(binding());
    await service.syncNow('session-1', 'launch');
    expect(source.readIncremental).toHaveBeenCalledTimes(1);
    await scheduler.advance(250);
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(2));
    await scheduler.advance(1_000);
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(3));
    await scheduler.advance(3_000);
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(4));
    await scheduler.advance(10_000);
    expect(source.readIncremental).toHaveBeenCalledTimes(4);
  });

  it('does not advance a cursor when the store rejects the batch', async () => {
    const clock = fakeClock();
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch({ nextCursor: 'cursor-good' })]);
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, retryDelaysMs: [],
    });
    await service.bind(binding());
    await service.syncNow('session-1', 'launch');

    const originalAppend = store.appendBatch;
    store.appendBatch = vi.fn(async () => { throw new Error('synthetic store failure'); });
    source.readIncremental.mockResolvedValueOnce(batch({
      events: [assistantEvent({ eventId: 'native-assistant-2' })],
      nextCursor: 'cursor-bad',
    }));
    await service.syncNow('session-1', 'manual');
    expect((await store.readSnapshot('session-1')).index.cursor).toBe('cursor-good');
    store.appendBatch = originalAppend;
  });

  it('finalSync drains a progressing backlog and keeps public hasMore private', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([
      batch({ nextCursor: 'cursor-1', hasMore: true }),
      batch({ events: [assistantEvent()], nextCursor: 'cursor-2', hasMore: false }),
    ]);
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [],
    });
    await service.bind(binding());
    const snapshot = await service.finalSync('session-1', 'exit');
    expect(source.readIncremental).toHaveBeenCalledTimes(2);
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.hasMore).toBe(false);
  });

  it('marks stale on final timeout and ignores a late adapter result', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const pending = deferred<RecordSourceBatch>();
    const source = adapter();
    source.readIncremental.mockReturnValue(pending.promise);
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [], finalSyncTimeoutMs: 100,
    });
    await service.bind(binding());
    const final = service.finalSync('session-1', 'exit');
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(1));
    await scheduler.advance(100);
    const timedOut = await final;
    expect(timedOut.status).toBe('failed');
    expect((await store.readSnapshot('session-1')).index.status).toBe('failed');
    pending.resolve(batch());
    await new Promise((resolve) => setImmediate(resolve));
    expect((await store.readSnapshot('session-1')).events).toEqual([]);
    const restarted = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [], finalSyncTimeoutMs: 100,
    });
    expect((await restarted.getSnapshot('session-1')).status).toBe('failed');
  });

  it('deletes within the final deadline after invalidating a stuck adapter read', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const pending = deferred<RecordSourceBatch>();
    const source = adapter();
    source.readIncremental.mockReturnValue(pending.promise);
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [], finalSyncTimeoutMs: 100,
    });
    await service.bind(binding());
    const final = service.finalSync('session-1', 'exit');
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(1));
    await scheduler.advance(100);
    await final;

    const deleting = service.deleteSession('session-1');
    try {
      const outcome = await Promise.race([
        deleting.then(() => 'deleted' as const),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
      ]);
      expect(outcome).toBe('deleted');
      await expect(stat(path.join(tempDir, 'session-records', 'session-1'))).rejects.toThrow();
    } finally {
      pending.resolve(batch({ events: [assistantEvent({ eventId: 'late-after-delete' })] }));
      await deleting;
    }

    await new Promise((resolve) => setImmediate(resolve));
    await expect(stat(path.join(tempDir, 'session-records', 'session-1'))).rejects.toThrow();
  });

  it('does not commit a deferred append after the final deadline', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch({ nextCursor: 'cursor-late' })]);
    const originalAppend = store.appendBatch.bind(store);
    const appendGate = deferred<void>();
    store.appendBatch = vi.fn(async (input, options) => {
      await appendGate.promise;
      if (options?.guard !== undefined && !options.guard()) {
        throw new Error('commit guard rejected');
      }
      return originalAppend(input, options);
    });
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [], finalSyncTimeoutMs: 100,
    });
    await service.bind(binding());
    const final = service.finalSync('session-1', 'exit');
    await vi.waitFor(() => expect(store.appendBatch).toHaveBeenCalledTimes(1));
    await scheduler.advance(100);
    const timedOut = await final;
    expect(timedOut.status).toBe('failed');
    appendGate.resolve();
    await vi.waitFor(async () => expect((await store.readSnapshot('session-1')).index.cursor).toBeUndefined());
    await service.getSnapshot('session-1');
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('rolls back a store commit that settles outside the final deadline', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch({ nextCursor: 'cursor-late' })]);
    const originalAppend = store.appendBatch.bind(store);
    const outerGate = deferred<void>();
    const rollback = vi.spyOn(store, 'restoreSnapshotIfCurrent');
    store.appendBatch = vi.fn(async (input, options) => {
      const committed = await originalAppend(input, options);
      await outerGate.promise;
      return committed;
    });
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [], finalSyncTimeoutMs: 100,
    });
    await service.bind(binding());
    const final = service.finalSync('session-1', 'exit');
    await vi.waitFor(() => expect(store.appendBatch).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => {
      expect((await store.readSnapshot('session-1')).index.cursor).toBe('cursor-late');
    });

    await scheduler.advance(100);
    await expect(final).resolves.toMatchObject({ status: 'failed' });
    expect((await store.readSnapshot('session-1')).index.cursor).toBe('cursor-late');

    const disposing = service.dispose();
    await disposing;
    expect((await store.readSnapshot('session-1')).index.cursor).toBeUndefined();

    outerGate.resolve();
    await vi.waitFor(async () => {
      expect(rollback).toHaveBeenCalled();
      const snapshot = await store.readSnapshot('session-1');
      expect(snapshot.index.cursor).toBeUndefined();
      expect(snapshot.events).toEqual([]);
      expect(snapshot.index.status).toBe('failed');
    });
    await Promise.all(rollback.mock.results.map((result) => result.value));
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('returns stale and preserves the previous cursor when final sync times out after prior events', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const pending = deferred<RecordSourceBatch>();
    const source = adapter([batch({ nextCursor: 'cursor-good' })]);
    source.readIncremental
      .mockResolvedValueOnce(batch({ nextCursor: 'cursor-good' }))
      .mockReturnValueOnce(pending.promise);
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [], finalSyncTimeoutMs: 100,
    });
    await service.bind(binding());
    await service.syncNow('session-1', 'launch');
    const final = service.finalSync('session-1', 'exit');
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(2));
    await scheduler.advance(100);
    const stale = await final;
    expect(stale.status).toBe('stale');
    expect((await store.readSnapshot('session-1')).index.cursor).toBe('cursor-good');
    pending.resolve(batch({ events: [assistantEvent()], nextCursor: 'cursor-late' }));
    await new Promise((resolve) => setImmediate(resolve));
    expect((await store.readSnapshot('session-1')).index.cursor).toBe('cursor-good');
  });

  it('runs another read when output arrives during an in-flight batch', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch({ nextCursor: 'cursor-1' }), batch({
      events: [assistantEvent()], nextCursor: 'cursor-2',
    })]);
    const firstRead = deferred<RecordSourceBatch>();
    source.readIncremental
      .mockReturnValueOnce(firstRead.promise)
      .mockResolvedValueOnce(batch({
        events: [assistantEvent()], nextCursor: 'cursor-2',
      }));
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());
    const running = service.syncNow('session-1', 'launch');
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(1));
    service.schedule('session-1', 'pty-output');
    firstRead.resolve(batch({ nextCursor: 'cursor-1' }));
    await running;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => {
      expect((await service.getSnapshot('session-1')).events).toHaveLength(2);
    });
  });

  it('coalesces concurrent finalSync calls', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const pending = deferred<RecordSourceBatch>();
    const source = adapter();
    source.readIncremental.mockReturnValueOnce(pending.promise);
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());
    const first = service.finalSync('session-1', 'exit');
    const second = service.finalSync('session-1', 'dispose');
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(1));
    pending.resolve(batch());
    await Promise.all([first, second]);
    expect(source.readIncremental).toHaveBeenCalledTimes(1);
  });

  it('preserves the old cursor and schedules a retry for a failed batch', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([
      batch({ nextCursor: 'cursor-good' }),
      batch({ status: 'failed', nextCursor: 'cursor-bad', events: [] }),
    ]);
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [250],
    });
    await service.bind(binding());
    await service.syncNow('session-1', 'launch');
    const failed = await service.syncNow('session-1', 'manual');
    expect(failed.status).toBe('failed');
    expect((await store.readSnapshot('session-1')).index.cursor).toBe('cursor-good');
    expect(scheduler.pending()).toBeGreaterThan(0);
  });

  it('waits for an in-flight operation before deleting a session', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const pending = deferred<RecordSourceBatch>();
    const source = adapter();
    source.readIncremental.mockReturnValue(pending.promise);
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());
    const running = service.syncNow('session-1', 'launch');
    await Promise.resolve();
    const deleting = service.deleteSession('session-1');
    let deleted = false;
    void deleting.then(() => { deleted = true; });
    await Promise.resolve();
    expect(deleted).toBe(false);
    pending.resolve(batch());
    await running;
    await deleting;
    await expect(stat(path.join(tempDir, 'session-records', 'session-1'))).rejects.toThrow();
  });

  it('does not recreate a deleted record from late sync, status, or schedule calls', async () => {
    const clock = fakeClock();
    const scheduler = fakeScheduler(clock);
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter();
    const service = createSessionRecordSyncService({
      adapters: [source], store, clock, scheduler, retryDelaysMs: [],
    });
    await service.bind(binding());
    await service.deleteSession('session-1');
    await service.syncNow('session-1', 'manual');
    await service.appendStatus({
      sessionId: 'session-1', runId: 'run-1', code: 'completed', occurredAt,
    });
    service.schedule('session-1', 'pty-output');
    await scheduler.advance(250);
    await expect(stat(path.join(tempDir, 'session-records', 'session-1'))).rejects.toThrow();
  });

  it('builds bounded restore material from native roles and excludes tools', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch({ events: [userEvent(), assistantEvent()], nextCursor: 'cursor-1' })]);
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());
    await service.syncNow('session-1', 'launch');
    await service.appendStatus({
      sessionId: 'session-1',
      runId: 'run-1',
      code: 'waiting',
      text: '等待下一步',
      occurredAt: '2026-07-25T08:00:02.000Z',
    });
    const material = await service.buildRestoreMaterial('session-1');
    expect(material).toContain('用户：合成用户消息');
    expect(material).toContain('Agent：合成 Agent 回复');
    expect(material).toContain('等待输入');
    expect(material).not.toContain('cursor-1');
    expect(material).not.toContain('工具');
    expect(material?.length).toBeLessThanOrEqual(20_000);
  });

  it('does not return restore material when only derived status exists', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const service = createSessionRecordSyncService({ adapters: [], store });
    await service.bind(binding());
    await service.appendStatus({
      sessionId: 'session-1',
      runId: 'run-1',
      code: 'started',
      occurredAt,
    });
    await expect(service.buildRestoreMaterial('session-1')).resolves.toBeUndefined();
  });

  it('canonicalizes caller status timestamps before stable deduplication', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const service = createSessionRecordSyncService({ adapters: [], store });
    await service.bind(binding());
    await service.appendStatus({
      sessionId: 'session-1',
      runId: 'run-1',
      code: 'restored',
      occurredAt: '2026-07-25T16:00:00+08:00',
    });
    await service.appendStatus({
      sessionId: 'session-1',
      runId: 'run-1',
      code: 'restored',
      occurredAt: occurredAt,
    });

    const statusEvents = (await service.getSnapshot('session-1')).events.filter(
      (event) => event.kind === 'status',
    );
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].occurredAt).toBe(occurredAt);
  });

  it('redacts internal paths from the public status message', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch({ warnings: ['/Users/private/record-home'] })]);
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());
    const snapshot = await service.syncNow('session-1', 'launch');
    expect(snapshot.message).not.toContain('/Users/private/record-home');
    expect(snapshot.message).toContain('[PATH]');
  });

  it('rejects writes after dispose and finalizes multiple sessions in parallel', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const source = adapter([batch()]);
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());
    await service.appendStatus({ sessionId: 'session-1', runId: 'run-1', code: 'started', occurredAt });
    const beforeDispose = (await store.readSnapshot('session-1')).events.length;
    await service.dispose();
    await service.appendStatus({ sessionId: 'session-1', runId: 'run-1', code: 'completed', occurredAt });
    const afterDispose = await store.readSnapshot('session-1');
    expect(afterDispose.events.length).toBe(beforeDispose + 1);
    expect(afterDispose.events.some((event) => event.kind === 'status' && event.payload.code === 'completed')).toBe(false);
    await expect(service.bind(binding({ runId: 'run-2' }))).rejects.toThrow('已释放');
  });

  it('starts final synchronization for multiple sessions in parallel during dispose', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const firstRead = deferred<RecordSourceBatch>();
    const secondRead = deferred<RecordSourceBatch>();
    const source = adapter();
    source.readIncremental
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise);
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());
    await service.bind(binding({
      sessionId: 'session-2',
      runId: 'run-2',
      workspacePath: path.join(tempDir, 'workspace-2'),
      recordHome: path.join(tempDir, 'codex-home-2'),
    }));
    const disposing = service.dispose();
    await vi.waitFor(() => expect(source.readIncremental).toHaveBeenCalledTimes(2));
    firstRead.resolve(batch({ events: [], nextCursor: undefined }));
    secondRead.resolve(batch({ events: [], nextCursor: undefined }));
    await disposing;
  });

  it('coalesces concurrent dispose calls and ignores later deletion writes', async () => {
    const store = createSessionRecordEventStore(tempDir);
    const pending = deferred<RecordSourceBatch>();
    const source = adapter();
    source.readIncremental.mockReturnValueOnce(pending.promise);
    const service = createSessionRecordSyncService({ adapters: [source], store, retryDelaysMs: [] });
    await service.bind(binding());

    const first = service.dispose();
    const second = service.dispose();
    expect(second).toBe(first);
    pending.resolve(batch());
    await Promise.all([first, second]);
    await service.deleteSession('session-1');

    await expect(store.readSnapshot('session-1')).resolves.toMatchObject({
      events: [expect.objectContaining({ eventId: 'native-user-1' })],
    });
  });
});
