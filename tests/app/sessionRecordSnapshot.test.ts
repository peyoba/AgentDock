import { describe, expect, it } from 'vitest';
import type { SessionRecordEventDto } from '../../src/shared/agentdockTypes.js';
import { publicSessionRecordSnapshot } from '../../src/main/sessionRecordSnapshot.js';
import { safeSessionRecordMessage } from '../../src/main/sessionRecordSnapshot.js';
import type { SessionRecordStoreSnapshot } from '../../src/main/stores/sessionRecordEventStore.js';

const occurredAt = '2026-07-25T08:00:00.000Z';

function nativeUserEvent(text: string): Extract<SessionRecordEventDto, { kind: 'user_message' }> {
  return {
    eventId: 'native-user-1',
    sessionId: 'session-1',
    runId: 'run-1',
    sequence: 1,
    occurredAt,
    timeSource: 'native',
    source: 'codex',
    trust: 'native',
    truncated: false,
    kind: 'user_message',
    payload: { text },
  };
}

describe('publicSessionRecordSnapshot', () => {
  it('revalidates private snapshots before exposing them to a renderer boundary', () => {
    const secret = `sk-${'s'.repeat(24)}`;
    const invalidEvent = {
      ...nativeUserEvent('invalid'),
      eventId: 'invalid-event',
      occurredAt: `${occurredAt}\n${secret}`,
      payload: { text: 'invalid', rawPath: '/private/native/log' },
    } as unknown as SessionRecordEventDto;
    const privateSnapshot = {
      events: [nativeUserEvent(`safe ${secret}`), invalidEvent],
      index: {
        schemaVersion: 1,
        source: 'codex',
        seenEventKeys: ['codex:native-user-1', 'codex:invalid-event'],
        status: 'ready',
        lastSyncedAt: `${occurredAt}\n${secret}`,
        message: `读取 /custom/private/native/session.log 失败 ${secret}`,
        truncated: false,
      },
      byteSize: 0,
    } satisfies SessionRecordStoreSnapshot;

    const snapshot = publicSessionRecordSnapshot('session-1', privateSnapshot);

    expect(snapshot.status).toBe('partial');
    expect(snapshot.events).toEqual([
      expect.objectContaining({ payload: { text: 'safe [REDACTED]' } }),
    ]);
    expect(snapshot.eventCount).toBe(1);
    expect(snapshot.lastSyncedAt).toBeUndefined();
    expect(snapshot.message).toContain('[PATH]');
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(JSON.stringify(snapshot)).not.toContain('/custom/private/native/session.log');
    expect(JSON.stringify(snapshot)).not.toContain('rawPath');
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.hasMore).toBe(false);
  });

  it('redacts Windows drive and UNC paths from status messages', () => {
    expect(safeSessionRecordMessage('C:\\Users\\private\\record.json')).toBe('[PATH]');
    expect(safeSessionRecordMessage('\\\\server\\share\\record.json')).toBe('[PATH]');
  });

  it('pages the event tail with beforeEventId and clamps the requested limit', () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      ...nativeUserEvent(`message ${index}`),
      eventId: `event-${String(index).padStart(2, '0')}`,
      sequence: index,
    }));
    const privateSnapshot = {
      events,
      index: {
        schemaVersion: 1,
        source: 'codex',
        seenEventKeys: events.map((event) => `codex:${event.eventId}`),
        status: 'ready',
        truncated: false,
      },
      byteSize: 0,
    } satisfies SessionRecordStoreSnapshot;

    const latest = publicSessionRecordSnapshot('session-1', privateSnapshot, { limit: 5 });
    expect(latest.events.map((event) => event.eventId)).toEqual([
      'event-07', 'event-08', 'event-09', 'event-10', 'event-11',
    ]);
    expect(latest.hasMore).toBe(true);
    expect(latest.eventCount).toBe(12);

    const previous = publicSessionRecordSnapshot('session-1', privateSnapshot, {
      beforeEventId: 'event-07',
      limit: 5,
    });
    expect(previous.events.map((event) => event.eventId)).toEqual([
      'event-02', 'event-03', 'event-04', 'event-05', 'event-06',
    ]);
    expect(previous.hasMore).toBe(true);

    const first = publicSessionRecordSnapshot('session-1', privateSnapshot, {
      beforeEventId: 'event-02',
      limit: 5,
    });
    expect(first.events.map((event) => event.eventId)).toEqual(['event-00', 'event-01']);
    expect(first.hasMore).toBe(false);

    // An unknown anchor falls back to the latest page instead of failing.
    const unknownAnchor = publicSessionRecordSnapshot('session-1', privateSnapshot, {
      beforeEventId: 'never-existed',
      limit: 5,
    });
    expect(unknownAnchor.events.map((event) => event.eventId)).toEqual(
      latest.events.map((event) => event.eventId),
    );

    // Invalid limits collapse to the bounded defaults.
    const invalidLimit = publicSessionRecordSnapshot('session-1', privateSnapshot, {
      limit: Number.POSITIVE_INFINITY,
    });
    expect(invalidLimit.events).toHaveLength(12);
    expect(invalidLimit.hasMore).toBe(false);

    const unwindowed = publicSessionRecordSnapshot('session-1', privateSnapshot);
    expect(unwindowed.events).toHaveLength(12);
    expect(unwindowed.hasMore).toBe(false);
  });
});
