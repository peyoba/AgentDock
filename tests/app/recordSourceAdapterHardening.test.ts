import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeRecordSource } from '../../src/main/recordSources/claudeRecordSource.js';
import { createCodexRecordSource } from '../../src/main/recordSources/codexRecordSource.js';
import { createGrokRecordSource } from '../../src/main/recordSources/grokRecordSource.js';
import {
  decodeAdapterCursor,
  encodeAdapterCursor,
  eventTime,
  fileKey,
} from '../../src/main/recordSources/adapterSupport.js';
import type { RecordSourceBinding } from '../../src/main/recordSources/types.js';
import { registerKnownSecret } from '../../src/main/secretRedaction.js';

const secretMarker = 'fixture-secret-value';
let tempDir: string;
let workspacePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-record-hardening-'));
  workspacePath = path.join(tempDir, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  registerKnownSecret(secretMarker);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function binding(
  source: 'claude' | 'codex' | 'grok',
  recordHome: string,
  nativeSessionId?: string,
): RecordSourceBinding {
  return {
    sessionId: `agent-${source}`,
    runId: `run-${source}`,
    source,
    nativeSessionId,
    workspacePath,
    recordHome,
    startedAt: '2026-07-25T08:00:00.000Z',
  };
}

function jsonl(lines: unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

describe.sequential('record source adapter hardening', () => {
  it('canonicalizes native timestamps and never returns parseable raw comments or secrets', () => {
    const result = eventTime(
      `Sat, 25 Jul 2026 08:00:00 GMT (${secretMarker})`,
      `Sat, 25 Jul 2026 08:01:00 GMT (${secretMarker})`,
    );

    expect(result.timeSource).toBe('read');
    expect(result.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result.occurredAt).not.toContain(secretMarker);
    expect(result.occurredAt).not.toContain('(');
    expect(result.occurredAt).not.toContain('\n');
  });

  it('rejects unsafe cursor ids, filters encode input, and resets all state after file rotation', async () => {
    const unsafe = Buffer.from(JSON.stringify({
      version: 1,
      fileKey: 'a'.repeat(64),
      readerCursor: 'opaque-reader-cursor',
      seenEventIds: [secretMarker],
    }), 'utf8').toString('base64url');
    expect(decodeAdapterCursor(unsafe)).toBeUndefined();

    const encoded = encodeAdapterCursor({
      version: 1,
      fileKey: 'a'.repeat(64),
      readerCursor: 'opaque-reader-cursor',
      seenEventIds: [
        'safe-id',
        '../path',
        secretMarker,
        ...Array.from({ length: 200 }, (_, index) => `event-${index}`),
      ],
    });
    const filtered = decodeAdapterCursor(encoded);
    expect(filtered).toBeDefined();
    expect(filtered?.seenEventIds).not.toContain(secretMarker);
    expect(filtered?.seenEventIds).not.toContain('../path');
    expect(filtered?.seenEventIds.length).toBeLessThanOrEqual(128);

    const recordHome = path.join(tempDir, 'claude-home');
    const firstPath = path.join(recordHome, 'projects', 'synthetic', 'first.jsonl');
    const secondPath = path.join(recordHome, 'projects', 'synthetic', 'second.jsonl');
    await mkdir(path.dirname(firstPath), { recursive: true });
    const firstRecord = {
      type: 'user',
      sessionId: 'rotating-claude',
      uuid: 'rotating-event',
      timestamp: '2026-07-25T08:00:01Z',
      cwd: workspacePath,
      message: { role: 'user', content: 'same event after rotation' },
    };
    await writeFile(firstPath, jsonl([firstRecord]), 'utf8');
    const adapter = createClaudeRecordSource({ approvedRoots: [recordHome] });
    const first = await adapter.readIncremental(
      binding('claude', recordHome, 'rotating-claude'),
      undefined,
    );
    expect(first.events).toHaveLength(1);

    await rm(firstPath);
    await writeFile(secondPath, jsonl([firstRecord]), 'utf8');
    const rotated = await adapter.readIncremental(
      binding('claude', recordHome, 'rotating-claude'),
      first.nextCursor,
    );
    expect(rotated.events).toHaveLength(1);
    expect(rotated.events[0]?.eventId).toBe('rotating-event');
    expect(JSON.stringify(rotated)).not.toContain(secretMarker);
    const rotatedCursor = decodeAdapterCursor(rotated.nextCursor);
    expect(rotatedCursor?.fileKey).toBe(fileKey(await realpath(secondPath)));
    expect(rotatedCursor?.seenEventIds).toEqual(['rotating-event']);
  });

  it('gives every Claude text and tool result part a stable unique id', async () => {
    const recordHome = path.join(tempDir, 'claude-multipart-home');
    const recordPath = path.join(recordHome, 'projects', 'synthetic', 'multipart.jsonl');
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(recordPath, jsonl([
      {
        type: 'assistant',
        sessionId: 'multipart-claude',
        uuid: 'assistant-record',
        timestamp: '2026-07-25T08:00:01Z',
        cwd: workspacePath,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'part-one' },
            { type: 'text', text: 'part-two' },
          ],
        },
      },
      {
        type: 'user',
        sessionId: 'multipart-claude',
        uuid: 'result-record',
        timestamp: '2026-07-25T08:00:02Z',
        cwd: workspacePath,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', content: 'result-one', is_error: false },
            { type: 'tool_result', content: 'result-two', is_error: false },
          ],
        },
      },
    ]), 'utf8');
    const adapter = createClaudeRecordSource({ approvedRoots: [recordHome] });
    const currentBinding = binding('claude', recordHome, 'multipart-claude');
    const batch = await adapter.readIncremental(currentBinding, undefined);
    const repeated = await adapter.readIncremental(currentBinding, undefined);

    expect(batch.events).toHaveLength(4);
    expect(new Set(batch.events.map((event) => event.eventId)).size).toBe(4);
    expect(batch.events.map((event) => event.payload)).toEqual(expect.arrayContaining([
      { text: 'part-one' },
      { text: 'part-two' },
      { outcome: 'success', text: 'result-one' },
      { outcome: 'success', text: 'result-two' },
    ]));
    expect(repeated.events.map((event) => event.eventId)).toEqual(
      batch.events.map((event) => event.eventId),
    );
  });

  it('keeps Claude tool calls and correlation-only results as distinct stable events', async () => {
    const recordHome = path.join(tempDir, 'claude-correlation-home');
    const recordPath = path.join(recordHome, 'projects', 'synthetic', 'correlation.jsonl');
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(recordPath, jsonl([
      {
        type: 'assistant',
        sessionId: 'correlation-claude',
        timestamp: '2026-07-25T08:00:01Z',
        cwd: workspacePath,
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'shared-tool-id',
            name: 'exec_command',
            input: { cmd: 'pwd' },
          }],
        },
      },
      {
        type: 'user',
        sessionId: 'correlation-claude',
        timestamp: '2026-07-25T08:00:02Z',
        cwd: workspacePath,
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: 'shared-tool-id',
            content: 'done',
            is_error: false,
          }],
        },
      },
    ]), 'utf8');
    const adapter = createClaudeRecordSource({ approvedRoots: [recordHome] });
    const currentBinding = binding('claude', recordHome, 'correlation-claude');

    const first = await adapter.readIncremental(currentBinding, undefined);
    const repeated = await adapter.readIncremental(currentBinding, undefined);

    expect(first.events.map((event) => event.kind)).toEqual(['tool_call', 'tool_result']);
    expect(first.events[0]?.eventId).toBe('shared-tool-id');
    expect(first.events[1]?.eventId).not.toBe('shared-tool-id');
    expect(new Set(first.events.map((event) => event.eventId)).size).toBe(2);
    expect(repeated.events.map((event) => event.eventId)).toEqual(
      first.events.map((event) => event.eventId),
    );
  });

  it('never reuses Claude tool_use_id for UUID-backed result parts', async () => {
    const recordHome = path.join(tempDir, 'claude-uuid-results-home');
    const recordPath = path.join(recordHome, 'projects', 'synthetic', 'uuid-results.jsonl');
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(recordPath, jsonl([
      {
        type: 'assistant',
        sessionId: 'uuid-results-claude',
        uuid: 'call-record',
        timestamp: '2026-07-25T08:00:01Z',
        cwd: workspacePath,
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'call-one', name: 'exec_command', input: { cmd: 'one' } },
            { type: 'tool_use', id: 'call-two', name: 'exec_command', input: { cmd: 'two' } },
          ],
        },
      },
      {
        type: 'user',
        sessionId: 'uuid-results-claude',
        uuid: 'result-record',
        timestamp: '2026-07-25T08:00:02Z',
        cwd: workspacePath,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call-one', content: 'one done', is_error: false },
            { type: 'tool_result', tool_use_id: 'call-two', content: 'two done', is_error: false },
          ],
        },
      },
    ]), 'utf8');
    const adapter = createClaudeRecordSource({ approvedRoots: [recordHome] });
    const currentBinding = binding('claude', recordHome, 'uuid-results-claude');

    const first = await adapter.readIncremental(currentBinding, undefined);
    const repeated = await adapter.readIncremental(currentBinding, undefined);

    expect(first.events.map((event) => event.kind)).toEqual([
      'tool_call', 'tool_call', 'tool_result', 'tool_result',
    ]);
    expect(first.events).toHaveLength(4);
    expect(new Set(first.events.map((event) => event.eventId)).size).toBe(4);
    expect(first.events.slice(2).map((event) => event.eventId)).not.toEqual(['call-one', 'call-two']);
    expect(repeated.events.map((event) => event.eventId)).toEqual(
      first.events.map((event) => event.eventId),
    );
  });

  it('bounds Claude part expansion before DTO construction', async () => {
    const recordHome = path.join(tempDir, 'claude-event-budget-home');
    const recordPath = path.join(recordHome, 'projects', 'synthetic', 'event-budget-claude.jsonl');
    await mkdir(path.dirname(recordPath), { recursive: true });
    await writeFile(recordPath, jsonl([{
      type: 'assistant',
      sessionId: 'event-budget-claude',
      timestamp: '2026-07-25T08:00:01Z',
      cwd: workspacePath,
      message: {
        role: 'assistant',
        content: Array.from({ length: 9_000 }, () => ({ type: 'text', text: 'x' })),
      },
    }]), 'utf8');
    const adapter = createClaudeRecordSource({ approvedRoots: [recordHome] });

    const batch = await adapter.readIncremental(
      binding('claude', recordHome, 'event-budget-claude'),
      undefined,
    );

    expect(batch.events.length).toBeGreaterThan(0);
    expect(batch.events.length).toBeLessThanOrEqual(256);
    expect(batch.status).toBe('partial');
    expect(batch.warnings).toContain('claude:event_limit');
  });

  it('uses the same partial semantics for supported unknown records and Claude binding mismatches', async () => {
    const supportedHome = path.join(tempDir, 'claude-supported-unknown-home');
    const supportedPath = path.join(supportedHome, 'projects', 'synthetic', 'supported-unknown.jsonl');
    await mkdir(path.dirname(supportedPath), { recursive: true });
    await writeFile(supportedPath, jsonl([
      {
        type: 'user',
        sessionId: 'supported-unknown',
        timestamp: '2026-07-25T08:00:01Z',
        cwd: workspacePath,
        message: { role: 'user', content: 'known' },
      },
      {
        type: 'future_claude_event',
        sessionId: 'supported-unknown',
        timestamp: '2026-07-25T08:00:02Z',
        cwd: workspacePath,
      },
    ]), 'utf8');
    const supported = createClaudeRecordSource({ approvedRoots: [supportedHome] });
    const supportedBinding = binding('claude', supportedHome, 'supported-unknown');
    const supportedProbe = await supported.probe(supportedBinding);
    const supportedRead = await supported.readIncremental(supportedBinding, undefined);

    expect(supportedProbe.status).toBe('partial');
    expect(supportedRead.status).toBe('partial');
    expect(supportedRead.warnings).toContain('claude:unknown_record');

    const mismatchHome = path.join(tempDir, 'claude-binding-mismatch-home');
    const mismatchPath = path.join(mismatchHome, 'projects', 'synthetic', 'expected-session.jsonl');
    await mkdir(path.dirname(mismatchPath), { recursive: true });
    await writeFile(mismatchPath, jsonl([
      {
        type: 'user',
        sessionId: 'expected-session',
        timestamp: '2026-07-25T08:00:01Z',
        cwd: workspacePath,
        message: { role: 'user', content: 'belongs to this session' },
      },
      {
        type: 'user',
        sessionId: 'different-session',
        timestamp: '2026-07-25T08:00:02Z',
        cwd: workspacePath,
        message: { role: 'user', content: 'must not be attributed' },
      },
    ]), 'utf8');
    const mismatch = createClaudeRecordSource({ approvedRoots: [mismatchHome] });
    const mismatchBinding = binding('claude', mismatchHome, 'expected-session');
    const mismatchProbe = await mismatch.probe(mismatchBinding);
    const mismatchRead = await mismatch.readIncremental(mismatchBinding, undefined);

    expect(mismatchProbe).toMatchObject({
      status: 'partial',
      reason: 'claude:binding_mismatch',
    });
    expect(mismatchRead.status).toBe('partial');
    expect(mismatchRead.events.map((event) => event.kind)).toEqual(['user_message']);
    expect(JSON.stringify(mismatchRead.events)).not.toContain('must not be attributed');
    expect(mismatchRead.warnings).toContain('claude:binding_mismatch');
  });

  it('refuses to bind a Claude file that only matches by name', async () => {
    // `.claude/projects` is user-writable: a leftover or planted file named
    // after the target session must not become a trusted native record.
    const foreignHome = path.join(tempDir, 'claude-impersonation-home');
    const foreignPath = path.join(foreignHome, 'projects', 'synthetic', 'target-session.jsonl');
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, jsonl([{
      type: 'user',
      sessionId: 'unrelated-session',
      timestamp: '2026-07-25T08:00:01Z',
      cwd: workspacePath,
      message: { role: 'user', content: 'content from an unrelated transcript' },
    }]), 'utf8');
    const foreign = createClaudeRecordSource({ approvedRoots: [foreignHome] });
    const foreignBinding = binding('claude', foreignHome, 'target-session');
    await expect(foreign.probe(foreignBinding)).resolves.toMatchObject({ status: 'unavailable' });
    const foreignRead = await foreign.readIncremental(foreignBinding, undefined);
    expect(foreignRead.status).toBe('unavailable');
    expect(foreignRead.events).toEqual([]);

    const missingIdHome = path.join(tempDir, 'claude-missing-id-home');
    const missingIdPath = path.join(missingIdHome, 'projects', 'synthetic', 'target-session.jsonl');
    await mkdir(path.dirname(missingIdPath), { recursive: true });
    await writeFile(missingIdPath, jsonl([{
      type: 'user',
      timestamp: '2026-07-25T08:00:01Z',
      cwd: workspacePath,
      message: { role: 'user', content: 'record without any session id' },
    }]), 'utf8');
    const missingId = createClaudeRecordSource({ approvedRoots: [missingIdHome] });
    const missingIdBinding = binding('claude', missingIdHome, 'target-session');
    await expect(missingId.probe(missingIdBinding)).resolves.toMatchObject({ status: 'unavailable' });
    const missingIdRead = await missingId.readIncremental(missingIdBinding, undefined);
    expect(missingIdRead.status).toBe('unavailable');
    expect(missingIdRead.events).toEqual([]);
  });

  it('never reports Codex or Grok metadata-only, malformed, or unknown sources as ready', async () => {
    const codexHome = path.join(tempDir, 'codex-home');
    const codexPath = path.join(codexHome, 'sessions', '2026', '07', '25', 'malformed.jsonl');
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, [
      JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'malformed-codex',
          cwd: workspacePath,
          timestamp: '2026-07-25T08:00:00Z',
          originator: 'codex_cli_rs',
        },
      }),
      `{ malformed ${secretMarker}`,
    ].join('\n') + '\n', 'utf8');
    const codex = createCodexRecordSource({ approvedRoots: [codexHome] });
    const codexBinding = binding('codex', codexHome, 'malformed-codex');
    await expect(codex.probe(codexBinding)).resolves.not.toMatchObject({ status: 'ready' });
    await expect(codex.readIncremental(codexBinding, undefined)).resolves.not.toMatchObject({ status: 'ready' });

    const grokHome = path.join(tempDir, 'grok-home');
    const grokPath = path.join(grokHome, 'sessions', 'malformed.jsonl');
    await mkdir(path.dirname(grokPath), { recursive: true });
    await writeFile(grokPath, [
      JSON.stringify({
        type: 'session_meta',
        schema_version: 1,
        session_id: 'malformed-grok',
        workspace: workspacePath,
        started_at: '2026-07-25T08:00:00Z',
      }),
      `{ malformed ${secretMarker}`,
    ].join('\n') + '\n', 'utf8');
    const grok = createGrokRecordSource({ approvedRoots: [grokHome] });
    const grokBinding = binding('grok', grokHome, 'malformed-grok');
    await expect(grok.probe(grokBinding)).resolves.not.toMatchObject({ status: 'ready' });
    await expect(grok.readIncremental(grokBinding, undefined)).resolves.not.toMatchObject({ status: 'ready' });

    const metadataOnlyHome = path.join(tempDir, 'metadata-only-grok-home');
    const metadataOnlyPath = path.join(metadataOnlyHome, 'sessions', 'metadata-only.jsonl');
    await mkdir(path.dirname(metadataOnlyPath), { recursive: true });
    await writeFile(metadataOnlyPath, jsonl([{
      type: 'session_meta',
      schema_version: 1,
      session_id: 'metadata-only-grok',
      workspace: workspacePath,
      started_at: '2026-07-25T08:00:00Z',
    }]), 'utf8');
    const metadataOnly = createGrokRecordSource({ approvedRoots: [metadataOnlyHome] });
    await expect(metadataOnly.probe(binding('grok', metadataOnlyHome, 'metadata-only-grok')))
      .resolves.not.toMatchObject({ status: 'ready' });
  });

  it('uses stable absolute positions for missing sequences and rejects negative sequences', async () => {
    const grokHome = path.join(tempDir, 'grok-sequence-home');
    const grokPath = path.join(grokHome, 'sessions', 'sequence.jsonl');
    await mkdir(path.dirname(grokPath), { recursive: true });
    const metadata = {
      type: 'session_meta',
      schema_version: 1,
      session_id: 'sequence-grok',
      workspace: workspacePath,
      started_at: '2026-07-25T08:00:00Z',
    };
    const firstMessage = {
      type: 'message',
      schema_version: 1,
      session_id: 'sequence-grok',
      timestamp: '2026-07-25T08:00:01Z',
      role: 'assistant',
      text: 'first without sequence',
    };
    await writeFile(grokPath, jsonl([metadata, firstMessage]), 'utf8');
    const adapter = createGrokRecordSource({ approvedRoots: [grokHome] });
    const currentBinding = binding('grok', grokHome, 'sequence-grok');
    const first = await adapter.readIncremental(currentBinding, undefined);
    await writeFile(grokPath, jsonl([
      metadata,
      firstMessage,
      {
        type: 'message',
        schema_version: 1,
        session_id: 'sequence-grok',
        sequence: -4,
        timestamp: '2026-07-25T08:00:02Z',
        role: 'assistant',
        text: 'second with invalid sequence',
      },
    ]), 'utf8');
    const second = await adapter.readIncremental(currentBinding, first.nextCursor);
    const full = await adapter.readIncremental(currentBinding, undefined);

    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(second.events[0]?.sequence === undefined || (second.events[0]?.sequence ?? 0) >= 0).toBe(true);
    expect(second.events[0]?.eventId).toBe(full.events[1]?.eventId);
    expect(full.events.every((event) => event.sequence === undefined || event.sequence >= 0)).toBe(true);
  });

  it('bounds metadata records per file and exposes a partial status instead of amplifying objects', async () => {
    const codexHome = path.join(tempDir, 'codex-budget-home');
    const codexPath = path.join(codexHome, 'sessions', '2026', '07', '25', 'budget.jsonl');
    await mkdir(path.dirname(codexPath), { recursive: true });
    const metadata = {
      type: 'session_meta',
      payload: {
        id: 'budget-codex',
        cwd: workspacePath,
        timestamp: '2026-07-25T08:00:00Z',
        originator: 'codex_cli_rs',
      },
    };
    const records = [metadata, ...Array.from({ length: 2_000 }, (_, index) => ({
      type: 'event_msg',
      sequence: index + 1,
      payload: { type: 'additional_tools', tools: [] },
    }))];
    await writeFile(codexPath, jsonl(records), 'utf8');
    const adapter = createCodexRecordSource({ approvedRoots: [codexHome] });
    const currentBinding = binding('codex', codexHome, 'budget-codex');
    const capability = await adapter.probe(currentBinding);
    const batch = await adapter.readIncremental(currentBinding, undefined);

    expect(capability.status).not.toBe('ready');
    expect(batch.status).not.toBe('ready');
    expect(batch.warnings).toContain('codex:unknown_record');
  });

  it('redacts unregistered secrets in command text, env assignments, headers, and secret-named keys', async () => {
    // Deliberately NOT registered via registerKnownSecret: this asserts the
    // pattern-based redaction, not the exact-string replacement.
    const unregistered = 'UNREGSECRETVALUE1234';

    const grokHome = path.join(tempDir, 'grok-redaction-home');
    const grokPath = path.join(grokHome, 'sessions', 'redaction.jsonl');
    await mkdir(path.dirname(grokPath), { recursive: true });
    await writeFile(grokPath, jsonl([
      {
        type: 'session_meta',
        schema_version: 1,
        session_id: 'redaction-grok',
        workspace: workspacePath,
        started_at: '2026-07-25T08:00:00Z',
      },
      {
        type: 'tool_result',
        schema_version: 1,
        session_id: 'redaction-grok',
        sequence: 1,
        timestamp: '2026-07-25T08:00:01Z',
        outcome: 'success',
        text: `curl --api-key ${unregistered} && export MY_AUTH_TOKEN=${unregistered}\nAuthorization: Bearer ${unregistered}`,
      },
      {
        type: 'tool_call',
        schema_version: 1,
        session_id: 'redaction-grok',
        sequence: 2,
        timestamp: '2026-07-25T08:00:02Z',
        tool_name: 'http_request',
        arguments: {
          apiKey: unregistered,
          bearer: unregistered,
          cookie: unregistered,
          credential: unregistered,
          token: unregistered,
        },
      },
    ]), 'utf8');
    const grok = createGrokRecordSource({ approvedRoots: [grokHome] });
    const grokBatch = await grok.readIncremental(binding('grok', grokHome, 'redaction-grok'), undefined);
    expect(grokBatch.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(grokBatch)).not.toContain(unregistered);

    const codexHome = path.join(tempDir, 'codex-redaction-home');
    const codexPath = path.join(codexHome, 'sessions', '2026', '07', '25', 'redaction.jsonl');
    await mkdir(path.dirname(codexPath), { recursive: true });
    await writeFile(codexPath, jsonl([
      {
        type: 'session_meta',
        payload: {
          id: 'redaction-codex',
          cwd: workspacePath,
          timestamp: '2026-07-25T08:00:00Z',
          originator: 'codex_cli_rs',
        },
      },
      {
        type: 'response_item',
        sequence: 1,
        timestamp: '2026-07-25T08:00:01Z',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ command: `GITHUB_TOKEN=${unregistered} gh release create` }),
        },
      },
    ]), 'utf8');
    const codex = createCodexRecordSource({ approvedRoots: [codexHome] });
    const codexBatch = await codex.readIncremental(binding('codex', codexHome, 'redaction-codex'), undefined);
    expect(codexBatch.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(codexBatch)).not.toContain(unregistered);
  });

  it('still finds the current session behind a large lexically-earlier history', async () => {
    // Regression: the metadata scan used to spend a global record budget in
    // lexical order, so ~20 history files starved the current session forever.
    const codexHome = path.join(tempDir, 'codex-starvation-home');
    const oldDir = path.join(codexHome, 'sessions', '2026', '01', '01');
    await mkdir(oldDir, { recursive: true });
    for (let index = 0; index < 60; index += 1) {
      const name = `rollout-${String(index).padStart(3, '0')}.jsonl`;
      await writeFile(path.join(oldDir, name), jsonl([
        {
          type: 'session_meta',
          payload: {
            id: `history-${index}`,
            cwd: workspacePath,
            timestamp: '2026-01-01T08:00:00Z',
            originator: 'codex_cli_rs',
          },
        },
        ...Array.from({ length: 200 }, (_, line) => ({
          type: 'response_item',
          sequence: line + 1,
          payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `h${line}` }] },
        })),
      ]), 'utf8');
    }
    const currentDir = path.join(codexHome, 'sessions', '2026', '07', '25');
    await mkdir(currentDir, { recursive: true });
    await writeFile(path.join(currentDir, 'rollout-current.jsonl'), jsonl([
      {
        type: 'session_meta',
        payload: {
          id: 'codex-current',
          cwd: workspacePath,
          timestamp: '2026-07-25T08:00:00Z',
          originator: 'codex_cli_rs',
        },
      },
      {
        type: 'response_item',
        sequence: 1,
        timestamp: '2026-07-25T08:00:01Z',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'current question' }] },
      },
    ]), 'utf8');
    const codex = createCodexRecordSource({ approvedRoots: [codexHome] });
    const codexBinding = binding('codex', codexHome, 'codex-current');
    const capability = await codex.probe(codexBinding);
    const batch = await codex.readIncremental(codexBinding, undefined);

    expect(capability.status).not.toBe('unavailable');
    expect(capability.nativeSessionId).toBe('codex-current');
    expect(batch.events.some((event) => event.kind === 'user_message')).toBe(true);

    const claudeHome = path.join(tempDir, 'claude-starvation-home');
    const claudeDir = path.join(claudeHome, 'projects', 'synthetic');
    await mkdir(claudeDir, { recursive: true });
    for (let index = 0; index < 60; index += 1) {
      await writeFile(path.join(claudeDir, `aaa-history-${String(index).padStart(3, '0')}.jsonl`), jsonl(
        Array.from({ length: 200 }, (_, line) => ({
          type: 'user',
          sessionId: `aaa-history-${String(index).padStart(3, '0')}`,
          timestamp: '2026-01-01T08:00:00Z',
          cwd: workspacePath,
          message: { role: 'user', content: `history line ${line}` },
        })),
      ), 'utf8');
    }
    await writeFile(path.join(claudeDir, 'zzz-current-session.jsonl'), jsonl([{
      type: 'user',
      sessionId: 'zzz-current-session',
      timestamp: '2026-07-25T08:00:01Z',
      cwd: workspacePath,
      message: { role: 'user', content: 'current claude question' },
    }]), 'utf8');
    const claude = createClaudeRecordSource({ approvedRoots: [claudeHome] });
    const claudeBinding = binding('claude', claudeHome, 'zzz-current-session');
    const claudeCapability = await claude.probe(claudeBinding);
    const claudeBatch = await claude.readIncremental(claudeBinding, undefined);

    expect(claudeCapability.status).not.toBe('unavailable');
    expect(claudeBatch.events.some((event) => event.kind === 'user_message'
      && JSON.stringify(event.payload).includes('current claude question'))).toBe(true);
  });

});
