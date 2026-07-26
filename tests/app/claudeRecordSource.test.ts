import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeRecordSource } from '../../src/main/recordSources/claudeRecordSource.js';
import type { RecordSourceBinding } from '../../src/main/recordSources/types.js';
import { registerKnownSecret } from '../../src/main/secretRedaction.js';

const fixtureRoot = path.join(process.cwd(), 'tests/fixtures/session-records/claude');
const secretMarker = 'fixture-secret-value';
let tempDir: string;
let workspacePath: string;
let recordHome: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-claude-record-'));
  workspacePath = path.join(tempDir, 'workspace');
  recordHome = path.join(tempDir, '.claude');
  await mkdir(workspacePath, { recursive: true });
  registerKnownSecret(secretMarker);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function binding(nativeSessionId: string, home = recordHome): RecordSourceBinding {
  return {
    sessionId: 'agent-session-claude',
    runId: 'run-claude-1',
    source: 'claude',
    nativeSessionId,
    workspacePath,
    recordHome: home,
    startedAt: '2026-07-25T08:00:00.000Z',
  };
}

async function installFixture(
  fixtureName: string,
  nativeSessionId: string,
  home = recordHome,
): Promise<string> {
  const destination = path.join(home, 'projects', 'synthetic-project', `${nativeSessionId}.jsonl`);
  const fixture = await readFile(path.join(fixtureRoot, fixtureName), 'utf8');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, fixture.replaceAll('__WORKSPACE__', workspacePath), 'utf8');
  return destination;
}

describe.sequential('Claude native record source', () => {
  it('maps only trusted native roles and tools with stable metadata, redaction, bounds, and cursor reads', async () => {
    const recordFile = await installFixture('session-basic.jsonl', 'claude-session-1');
    const adapter = createClaudeRecordSource({ approvedRoots: [recordHome] });

    await expect(adapter.probe(binding('claude-session-1'))).resolves.toMatchObject({
      // Unknown progress/future records make the same static source partial
      // for both probe and read; role events remain available below.
      status: 'partial',
      nativeSessionId: 'claude-session-1',
    });
    const first = await adapter.readIncremental(binding('claude-session-1'), undefined);

    expect(first.events.map((event) => event.kind)).toEqual([
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
    ]);
    expect(first.events.map((event) => event.eventId)).toEqual([
      'claude-user-1',
      'claude-assistant-1',
      'claude-tool-1',
      'claude-tool-result-1',
    ]);
    expect(first.events.map((event) => event.sequence)).toEqual([10, 11, 11, 12]);
    expect(first.events).toEqual(first.events.map((event) => expect.objectContaining({
      sessionId: 'agent-session-claude',
      runId: 'run-claude-1',
      source: 'claude',
      trust: 'native',
      timeSource: 'native',
      truncated: false,
    })));
    expect(first.status).toBe('partial');
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.warnings.length).toBeGreaterThan(0);
    const publicBatch = JSON.stringify(first);
    expect(publicBatch).not.toContain(secretMarker);
    expect(publicBatch).not.toContain('Working');
    expect(publicBatch).not.toContain('future_claude_event');
    expect(publicBatch).not.toContain(recordFile);

    const longText = `长回复 ${'文'.repeat(20_000)} ${secretMarker}`;
    const longArguments = { cmd: `printf ${'x'.repeat(20_000)}`, token: secretMarker };
    await writeFile(recordFile, `${JSON.stringify({
      type: 'assistant',
      sessionId: 'claude-session-1',
      uuid: 'claude-long-assistant',
      sequence: 15,
      timestamp: '2026-07-25T08:00:15.000Z',
      cwd: workspacePath,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: longText },
          { type: 'tool_use', id: 'claude-long-tool', name: 'exec_command', input: longArguments },
        ],
      },
    })}\n`, { flag: 'a' });

    const second = await adapter.readIncremental(binding('claude-session-1'), first.nextCursor);
    expect(second.events.map((event) => event.eventId)).toEqual([
      'claude-long-assistant',
      'claude-long-tool',
    ]);
    const assistant = second.events.find((event) => event.kind === 'assistant_message');
    const toolCall = second.events.find((event) => event.kind === 'tool_call');
    expect(assistant?.payload.text.length).toBeLessThanOrEqual(8_000);
    expect(assistant?.truncated).toBe(true);
    expect(toolCall?.payload.argumentsSummary?.length).toBeLessThanOrEqual(2_000);
    expect(toolCall?.truncated).toBe(true);
    expect(JSON.stringify(second)).not.toContain(secretMarker);
    expect(second.nextCursor).not.toContain(recordFile);
    expect(second.nextCursor).not.toContain(tempDir);
  });

  it('keeps user text parts from array content instead of silently dropping them', async () => {
    const recordPath = path.join(recordHome, 'projects', 'synthetic-project', 'claude-array-user.jsonl');
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(recordPath, [
      JSON.stringify({
        type: 'user',
        sessionId: 'claude-array-user',
        uuid: 'array-text-only',
        sequence: 1,
        timestamp: '2026-07-25T08:00:01.000Z',
        cwd: workspacePath,
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'please run the build' }],
        },
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 'claude-array-user',
        uuid: 'array-mixed',
        sequence: 2,
        timestamp: '2026-07-25T08:00:02.000Z',
        cwd: workspacePath,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call-1', content: 'build ok', is_error: false },
            { type: 'text', text: 'AND HERE IS MY FOLLOW-UP QUESTION' },
          ],
        },
      }),
    ].join('\n') + '\n', 'utf8');
    const adapter = createClaudeRecordSource({ approvedRoots: [recordHome] });
    const batch = await adapter.readIncremental(binding('claude-array-user'), undefined);

    expect(batch.events.map((event) => event.kind)).toEqual([
      'user_message',
      'tool_result',
      'user_message',
    ]);
    const texts = batch.events
      .filter((event) => event.kind === 'user_message')
      .map((event) => (event.payload as { text: string }).text);
    expect(texts).toEqual(['please run the build', 'AND HERE IS MY FOLLOW-UP QUESTION']);
    expect(new Set(batch.events.map((event) => event.eventId)).size).toBe(3);
  });

  it('isolates malformed and unknown lines without leaking their body or inventing events', async () => {
    const recordFile = await installFixture('session-malformed.jsonl', 'claude-malformed');
    const adapter = createClaudeRecordSource({ approvedRoots: [recordHome] });
    const batch = await adapter.readIncremental(binding('claude-malformed'), undefined);

    expect(batch.status).toBe('partial');
    expect(batch.events.map((event) => event.eventId)).toEqual(['claude-malformed-user']);
    expect(batch.warnings.length).toBeGreaterThan(0);
    const publicWarnings = JSON.stringify(batch.warnings);
    expect(publicWarnings).not.toContain(secretMarker);
    expect(publicWarnings).not.toContain(recordFile);
    expect(JSON.stringify(batch.events)).not.toContain('Working');
  });

  it('requires non-empty approved roots and does not follow a parent symlink outside them', async () => {
    expect(() => createClaudeRecordSource({ approvedRoots: [] })).toThrow('允许');

    const approvedRoot = path.join(tempDir, 'approved');
    const outsideHome = path.join(tempDir, 'outside-home');
    const linkedHome = path.join(approvedRoot, 'linked-home');
    await mkdir(approvedRoot, { recursive: true });
    await installFixture('session-basic.jsonl', 'claude-session-1', outsideHome);
    await symlink(outsideHome, linkedHome, process.platform === 'win32' ? 'junction' : 'dir');
    const adapter = createClaudeRecordSource({ approvedRoots: [approvedRoot] });

    const batch = await adapter.readIncremental(binding('claude-session-1', linkedHome), undefined);
    expect(batch).toMatchObject({ status: 'unavailable', events: [] });
    expect(JSON.stringify(batch)).not.toContain(secretMarker);
    expect(JSON.stringify(batch)).not.toContain(outsideHome);
  });
});
