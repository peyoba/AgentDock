import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrokRecordSource } from '../../src/main/recordSources/grokRecordSource.js';
import type { RecordSourceBinding } from '../../src/main/recordSources/types.js';
import { registerKnownSecret } from '../../src/main/secretRedaction.js';

const fixtureRoot = path.join(process.cwd(), 'tests/fixtures/session-records/grok');
const secretMarker = 'fixture-secret-value';
let tempDir: string;
let workspacePath: string;
let recordHome: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-grok-record-'));
  workspacePath = path.join(tempDir, 'workspace');
  recordHome = path.join(tempDir, 'grok-home');
  await mkdir(workspacePath, { recursive: true });
  registerKnownSecret(secretMarker);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function binding(nativeSessionId: string, home = recordHome): RecordSourceBinding {
  return {
    sessionId: 'agent-session-grok',
    runId: 'run-grok-1',
    source: 'grok',
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
  const destination = path.join(home, 'sessions', destinationName);
  const fixture = await readFile(path.join(fixtureRoot, fixtureName), 'utf8');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, fixture.replaceAll('__WORKSPACE__', workspacePath), 'utf8');
  return destination;
}

describe.sequential('Grok native record source', () => {
  it('maps the supported stable schema and derives a repeatable SHA-256 id when native id is absent', async () => {
    const recordFile = await installFixture('session-basic.jsonl', 'grok-session-1.jsonl');
    const adapter = createGrokRecordSource({ approvedRoots: [recordHome] });

    await expect(adapter.probe(binding('grok-session-1'))).resolves.toMatchObject({
      status: 'ready',
      nativeSessionId: 'grok-session-1',
    });
    const first = await adapter.readIncremental(binding('grok-session-1'), undefined);
    const repeated = await adapter.readIncremental(binding('grok-session-1'), undefined);

    expect(first.status).toBe('ready');
    expect(first.events.map((event) => event.kind)).toEqual([
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
    ]);
    expect(first.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(first.events).toEqual(first.events.map(() => expect.objectContaining({
      sessionId: 'agent-session-grok',
      runId: 'run-grok-1',
      source: 'grok',
      trust: 'native',
      timeSource: 'native',
    })));
    const assistant = first.events.find((event) => event.kind === 'assistant_message');
    const repeatedAssistant = repeated.events.find((event) => event.kind === 'assistant_message');
    expect(assistant?.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(repeatedAssistant?.eventId).toBe(assistant?.eventId);
    expect(JSON.stringify(first)).not.toContain(secretMarker);
    expect(first.nextCursor).not.toContain(recordFile);
    expect(first.nextCursor).not.toContain(tempDir);

    await writeFile(recordFile, `${JSON.stringify({
      type: 'message',
      schema_version: 1,
      session_id: 'grok-session-1',
      id: 'grok-assistant-later',
      sequence: 5,
      timestamp: '2026-07-25T08:00:05.000Z',
      role: 'assistant',
      text: '增量 Grok 回复',
    })}\n`, { flag: 'a' });
    const second = await adapter.readIncremental(binding('grok-session-1'), first.nextCursor);
    expect(second.events.map((event) => event.eventId)).toEqual(['grok-assistant-later']);
  });

  it('marks unsupported or continue-only schema partial without guessing roles from terminal text', async () => {
    const recordFile = await installFixture('session-unsupported.jsonl', 'grok-unsupported.jsonl');
    const adapter = createGrokRecordSource({ approvedRoots: [recordHome] });

    await expect(adapter.probe(binding('grok-unsupported'))).resolves.toMatchObject({
      status: 'partial',
      nativeSessionId: 'grok-unsupported',
    });
    const batch = await adapter.readIncremental(binding('grok-unsupported'), undefined);
    expect(batch).toMatchObject({ status: 'partial', events: [] });
    expect(batch.warnings.length).toBeGreaterThan(0);
    const publicBatch = JSON.stringify(batch);
    expect(publicBatch).not.toContain('伪用户');
    expect(publicBatch).not.toContain('伪回复');
    expect(publicBatch).not.toContain('unsupported-schema-must-not-map');
    expect(publicBatch).not.toContain(secretMarker);
    expect(publicBatch).not.toContain(recordFile);
  });

  it('requires approved roots and reports an empty GROK_HOME unavailable', async () => {
    expect(() => createGrokRecordSource({ approvedRoots: [] })).toThrow('允许');
    await mkdir(recordHome, { recursive: true });
    const adapter = createGrokRecordSource({ approvedRoots: [recordHome] });

    await expect(adapter.probe(binding('missing-grok-session'))).resolves.toMatchObject({
      status: 'unavailable',
    });
    await expect(adapter.readIncremental(binding('missing-grok-session'), undefined)).resolves.toMatchObject({
      status: 'unavailable',
      events: [],
    });
  });
});
