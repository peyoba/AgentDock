import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodexRecordSource } from '../../src/main/recordSources/codexRecordSource.js';
import type { RecordSourceBinding } from '../../src/main/recordSources/types.js';
import { registerKnownSecret } from '../../src/main/secretRedaction.js';

const fixtureRoot = path.join(process.cwd(), 'tests/fixtures/session-records/codex');
const secretMarker = 'fixture-secret-value';
let tempDir: string;
let workspacePath: string;
let recordHome: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-codex-record-'));
  workspacePath = path.join(tempDir, 'workspace');
  recordHome = path.join(tempDir, 'codex-home');
  await mkdir(workspacePath, { recursive: true });
  registerKnownSecret(secretMarker);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function binding(nativeSessionId?: string, home = recordHome): RecordSourceBinding {
  return {
    sessionId: 'agent-session-codex',
    runId: 'run-codex-1',
    source: 'codex',
    nativeSessionId,
    workspacePath,
    recordHome: home,
    startedAt: '2026-07-25T08:00:00.000Z',
  };
}

async function installFixture(
  fixtureName: string,
  destinationName: string,
  home = recordHome,
): Promise<string> {
  const destination = path.join(home, 'sessions', '2026', '07', '25', destinationName);
  const fixture = await readFile(path.join(fixtureRoot, fixtureName), 'utf8');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, fixture.replaceAll('__WORKSPACE__', workspacePath), 'utf8');
  return destination;
}

describe.sequential('Codex native record source', () => {
  it('binds the exact thread id, maps supported items, deduplicates native ids, and preserves source sequence', async () => {
    const recordFile = await installFixture('session-basic.jsonl', 'rollout-basic.jsonl');
    const adapter = createCodexRecordSource({ approvedRoots: [recordHome] });

    await expect(adapter.probe(binding('codex-thread-1'))).resolves.toMatchObject({
      // The fixture includes an unknown additional_tools record; probe and
      // read now share the conservative partial status for that source.
      status: 'partial',
      nativeSessionId: 'codex-thread-1',
    });
    const first = await adapter.readIncremental(binding('codex-thread-1'), undefined);

    expect(first.events.map((event) => event.kind)).toEqual([
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
    ]);
    expect(first.events.map((event) => event.eventId)).toEqual([
      'codex-user-1',
      'codex-assistant-1',
      'codex-call-1',
      'codex-result-1',
    ]);
    expect(first.events.map((event) => event.sequence)).toEqual([4, 2, 3, 5]);
    expect(new Set(first.events.map((event) => event.eventId)).size).toBe(4);
    expect(first.events).toEqual(first.events.map(() => expect.objectContaining({
      sessionId: 'agent-session-codex',
      runId: 'run-codex-1',
      source: 'codex',
      trust: 'native',
      timeSource: 'native',
    })));
    expect(first.status).toBe('partial');
    expect(first.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(first)).not.toContain(secretMarker);
    expect(JSON.stringify(first)).not.toContain('additional_tools');
    expect(JSON.stringify(first.warnings)).not.toContain(recordFile);

    await writeFile(recordFile, `${JSON.stringify({
      timestamp: '2026-07-25T08:00:07.000Z',
      sequence: 7,
      id: 'codex-assistant-later',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '增量回复' }],
      },
    })}\n`, { flag: 'a' });
    const second = await adapter.readIncremental(binding('codex-thread-1'), first.nextCursor);
    expect(second.events.map((event) => event.eventId)).toEqual(['codex-assistant-later']);
    expect(second.nextCursor).not.toContain(recordFile);
    expect(second.nextCursor).not.toContain(tempDir);
  });

  it('returns partial for equally credible candidates and unavailable for a missing exact id', async () => {
    const firstFile = await installFixture('session-basic.jsonl', 'rollout-old.jsonl');
    const secondFile = await installFixture('session-ambiguous.jsonl', 'rollout-new.jsonl');
    await utimes(firstFile, new Date('2026-07-25T08:00:00.000Z'), new Date('2026-07-25T08:00:00.000Z'));
    await utimes(secondFile, new Date('2026-07-25T09:00:00.000Z'), new Date('2026-07-25T09:00:00.000Z'));
    const adapter = createCodexRecordSource({ approvedRoots: [recordHome] });

    await expect(adapter.probe(binding())).resolves.toMatchObject({ status: 'partial' });
    const ambiguous = await adapter.readIncremental(binding(), undefined);
    expect(ambiguous).toMatchObject({ status: 'partial', events: [] });
    expect(ambiguous.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(ambiguous)).not.toContain('另一个并发会话');

    await expect(adapter.probe(binding('codex-thread-missing'))).resolves.toMatchObject({
      status: 'unavailable',
    });
    await expect(adapter.readIncremental(binding('codex-thread-missing'), undefined)).resolves.toMatchObject({
      status: 'unavailable',
      events: [],
    });
  });

  it('searches only an approved CODEX_HOME sessions tree', async () => {
    const approvedRoot = path.join(tempDir, 'approved-codex');
    const outsideHome = path.join(tempDir, 'outside-codex');
    await mkdir(approvedRoot, { recursive: true });
    await installFixture('session-basic.jsonl', 'outside.jsonl', outsideHome);
    const adapter = createCodexRecordSource({ approvedRoots: [approvedRoot] });

    const batch = await adapter.readIncremental(binding('codex-thread-1', outsideHome), undefined);
    expect(batch).toMatchObject({ status: 'unavailable', events: [] });
    expect(JSON.stringify(batch)).not.toContain(secretMarker);
    expect(JSON.stringify(batch)).not.toContain(outsideHome);
  });
});
