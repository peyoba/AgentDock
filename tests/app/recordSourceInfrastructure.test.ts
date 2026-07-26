import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverJsonlFiles,
  resolveApprovedRecordFile,
} from '../../src/main/recordSources/pathValidation.js';
import {
  readJsonlIncremental,
  type JsonlReadWarning,
} from '../../src/main/recordSources/jsonlReader.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-record-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function warningCategories(warnings: readonly JsonlReadWarning[]): string[] {
  return warnings.map((warning) => warning.category);
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe.sequential('record source path validation', () => {
  it('requires non-empty approved roots for discovery and reading', async () => {
    const root = path.join(tempDir, 'approved-required');
    const recordFile = path.join(root, 'session.jsonl');
    await mkdir(root, { recursive: true });
    await writeFile(recordFile, '{}\n', 'utf8');

    await expect(readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [],
    })).rejects.toThrow('允许');
    await expect(discoverJsonlFiles({
      rootPath: root,
      approvedRoots: [],
    })).resolves.toMatchObject({ status: 'unavailable', files: [] });
  });

  it('accepts a regular record file inside an approved home and rejects escapes', async () => {
    const approvedRoot = path.join(tempDir, 'codex-home');
    const recordFile = path.join(approvedRoot, 'sessions/2026/07/25/session.jsonl');
    await mkdir(path.dirname(recordFile), { recursive: true });
    await writeFile(recordFile, '{"type":"event"}\n', 'utf8');

    await expect(resolveApprovedRecordFile({
      candidatePath: recordFile,
      approvedRoots: [approvedRoot],
    })).resolves.toBe(await import('node:fs/promises').then(({ realpath }) => realpath(recordFile)));

    await expect(resolveApprovedRecordFile({
      candidatePath: path.join(tempDir, '../outside.jsonl'),
      approvedRoots: [approvedRoot],
    })).rejects.toThrow('允许的记录目录');
  });

  it('rejects symlink files and symlinked path components', async () => {
    const approvedRoot = path.join(tempDir, 'approved');
    const outsideRoot = path.join(tempDir, 'outside');
    const outsideFile = path.join(outsideRoot, 'session.jsonl');
    await mkdir(outsideRoot, { recursive: true });
    await mkdir(approvedRoot, { recursive: true });
    await writeFile(outsideFile, '{}\n', 'utf8');
    const linkFile = path.join(approvedRoot, 'link.jsonl');
    await symlink(outsideFile, linkFile);
    await expect(resolveApprovedRecordFile({
      candidatePath: linkFile,
      approvedRoots: [approvedRoot],
    })).rejects.toThrow();

    const linkDirectory = path.join(approvedRoot, 'linked');
    await symlink(outsideRoot, linkDirectory);
    await expect(resolveApprovedRecordFile({
      candidatePath: path.join(linkDirectory, 'session.jsonl'),
      approvedRoots: [approvedRoot],
    })).rejects.toThrow();
  });

  it('discovers JSONL files without following links and reports depth and file caps', async () => {
    const root = path.join(tempDir, 'records');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'one.jsonl'), '{}\n', 'utf8');
    await writeFile(path.join(root, 'ignore.txt'), '{}\n', 'utf8');
    const outside = path.join(tempDir, 'outside.jsonl');
    await writeFile(outside, '{}\n', 'utf8');
    await symlink(outside, path.join(root, 'link.jsonl'));
    const deep = path.join(root, 'a/b/c/d/e/f/g/h/i');
    await mkdir(deep, { recursive: true });
    await writeFile(path.join(deep, 'deep.jsonl'), '{}\n', 'utf8');

    const result = await discoverJsonlFiles({ rootPath: root, approvedRoots: [root], maxDepth: 8 });
    expect(result.files).toContain(await realpath(path.join(root, 'one.jsonl')));
    expect(result.files).not.toContain(path.join(root, 'link.jsonl'));
    expect(result.files).not.toContain(path.join(deep, 'deep.jsonl'));
    expect(result.status).toBe('partial');
    expect(result.hasMore).toBe(true);

    const cappedRoot = path.join(tempDir, 'capped');
    await mkdir(cappedRoot, { recursive: true });
    await Promise.all(
      Array.from({ length: 3 }, (_, index) => writeFile(
        path.join(cappedRoot, `record-${index}.jsonl`),
        '{}\n',
        'utf8',
      )),
    );
    const capped = await discoverJsonlFiles({ rootPath: cappedRoot, approvedRoots: [cappedRoot], maxFiles: 2 });
    expect(capped.files).toHaveLength(2);
    expect(capped.status).toBe('partial');
    expect(capped.hasMore).toBe(true);
  });

  it('marks an exact JSONL candidate cap partial and counts rejected links toward the cap', async () => {
    const exactRoot = path.join(tempDir, 'exact-cap');
    await mkdir(exactRoot, { recursive: true });
    await writeFile(path.join(exactRoot, 'one.jsonl'), '{}\n', 'utf8');
    await writeFile(path.join(exactRoot, 'two.jsonl'), '{}\n', 'utf8');

    const exact = await discoverJsonlFiles({ rootPath: exactRoot, approvedRoots: [exactRoot], maxFiles: 2 });
    expect(exact.files).toHaveLength(2);
    expect(exact.status).toBe('partial');
    expect(exact.hasMore).toBe(false);
    expect(exact.warnings.map(({ category }) => category)).toContain('file_limit');

    const mixedRoot = path.join(tempDir, 'mixed-cap');
    const outside = path.join(tempDir, 'outside-cap.jsonl');
    await mkdir(mixedRoot, { recursive: true });
    await writeFile(outside, '{}\n', 'utf8');
    await symlink(outside, path.join(mixedRoot, '00-link.jsonl'));
    await symlink(outside, path.join(mixedRoot, '01-link.jsonl'));
    await writeFile(path.join(mixedRoot, '02-unchecked.jsonl'), '{}\n', 'utf8');

    const mixed = await discoverJsonlFiles({ rootPath: mixedRoot, approvedRoots: [mixedRoot], maxFiles: 2 });
    expect(mixed.files).toEqual([]);
    expect(mixed.status).toBe('partial');
    expect(mixed.hasMore).toBe(true);
    expect(mixed.warnings.filter(({ category }) => category === 'symlink_skipped')).toHaveLength(2);
  });
});

describe.sequential('incremental JSONL reader', () => {
  it('preserves all records when a record-limited batch retains more than one max-line buffer', async () => {
    const recordFile = path.join(tempDir, 'large-record-limit.jsonl');
    const totalRecords = 20_000;
    await writeFile(recordFile, Array.from(
      { length: totalRecords },
      (_, index) => JSON.stringify({ id: index + 1, payload: 'x'.repeat(40) }),
    ).join('\n') + '\n', 'utf8');

    const ids: number[] = [];
    const lines: number[] = [];
    const categories: string[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    for (let batchIndex = 0; batchIndex < 250 && hasMore; batchIndex += 1) {
      const batch = await readJsonlIncremental<{ id: number }>({
        filePath: recordFile,
        approvedRoots: [tempDir],
        cursor,
        maxBytes: 64 * 1024,
        maxTotalBytes: 64 * 1024,
        maxLineBytes: 128,
        maxRecords: 100,
        sourceType: 'hardening',
      });
      ids.push(...batch.records.map((record) => record.id));
      lines.push(...batch.recordLines);
      categories.push(...warningCategories(batch.warnings));
      cursor = batch.nextCursor;
      hasMore = batch.hasMore;
    }

    expect(hasMore).toBe(false);
    expect(ids).toEqual(Array.from({ length: totalRecords }, (_, index) => index + 1));
    expect(lines).toEqual(Array.from({ length: totalRecords }, (_, index) => index + 1));
    expect(categories).not.toContain('line_too_long');
  });

  it('keeps the cursor on the first unprocessed line when maxRecords is reached', async () => {
    const recordFile = path.join(tempDir, 'record-limit.jsonl');
    await writeFile(recordFile, Array.from(
      { length: 5 },
      (_, index) => JSON.stringify({ id: index + 1 }),
    ).join('\n') + '\n', 'utf8');

    const first = await readJsonlIncremental<{ id: number }>({
      filePath: recordFile,
      approvedRoots: [tempDir],
      maxBytes: 1024,
      maxRecords: 2,
      sourceType: 'hardening',
    });
    const second = await readJsonlIncremental<{ id: number }>({
      filePath: recordFile,
      approvedRoots: [tempDir],
      cursor: first.nextCursor,
      maxBytes: 1024,
      maxRecords: 2,
      sourceType: 'hardening',
    });
    const third = await readJsonlIncremental<{ id: number }>({
      filePath: recordFile,
      approvedRoots: [tempDir],
      cursor: second.nextCursor,
      maxBytes: 1024,
      maxRecords: 2,
      sourceType: 'hardening',
    });

    expect(first.records.map((record) => record.id)).toEqual([1, 2]);
    expect(first.recordLines).toEqual([1, 2]);
    expect(warningCategories(first.warnings)).toContain('record_limit');
    expect(second.records.map((record) => record.id)).toEqual([3, 4]);
    expect(second.recordLines).toEqual([3, 4]);
    expect(third.records.map((record) => record.id)).toEqual([5]);
    expect(third.recordLines).toEqual([5]);
  });

  it('reads complete UTF-8 JSONL records and advances an opaque byte cursor', async () => {
    const recordFile = path.join(tempDir, 'session.jsonl');
    await writeFile(recordFile, '{"id":"1","text":"中文"}\n{"id":"2","text":"next"}\n', 'utf8');

    const first = await readJsonlIncremental({ filePath: recordFile, approvedRoots: [tempDir], maxBytes: 24 });
    expect(first.records).toEqual([{ id: '1', text: '中文' }]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      cursor: first.nextCursor,
      maxBytes: 1024,
    });
    expect(second.records).toEqual([{ id: '2', text: 'next' }]);
    expect(second.nextCursor).not.toContain(recordFile);
  });

  it('keeps a half line until a later append completes it', async () => {
    const recordFile = path.join(tempDir, 'partial.jsonl');
    const secretMarker = 'SYNTHETIC_HALF_LINE_SECRET';
    const halfLine = `{"id":"1","text":"${secretMarker}`;
    await writeFile(recordFile, halfLine, 'utf8');
    const first = await readJsonlIncremental({ filePath: recordFile, approvedRoots: [tempDir], maxBytes: 64 });
    expect(first.records).toEqual([]);
    expect(first.partial).toBe(true);
    const decoded = decodeCursor(first.nextCursor);
    expect(JSON.stringify(decoded)).not.toContain(secretMarker);
    expect(JSON.stringify(decoded)).not.toContain(halfLine);
    expect(decoded).not.toHaveProperty('pending');
    await writeFile(recordFile, '"}\n{"id":"2"}\n', { flag: 'a' });
    const second = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      cursor: first.nextCursor,
    });
    expect(second.records).toEqual([{ id: '1', text: secretMarker }, { id: '2' }]);
  });

  it('limits each call to 1 MiB while incrementally isolating a multi-megabyte line', async () => {
    const recordFile = path.join(tempDir, 'large-line.jsonl');
    const oneMiB = 1024 * 1024;
    await writeFile(
      recordFile,
      `${'x'.repeat(oneMiB * 2 + 64)}\n{"after":true}\n`,
      'utf8',
    );

    let cursor: string | undefined;
    let previousReadThrough = 0;
    let afterRecordSeen = false;
    for (let attempt = 0; attempt < 5 && !afterRecordSeen; attempt += 1) {
      const batch = await readJsonlIncremental({
        filePath: recordFile,
        approvedRoots: [tempDir],
        cursor,
        maxBytes: oneMiB,
        maxLineBytes: 256 * 1024,
        sourceType: 'claude',
      });
      const decoded = decodeCursor(batch.nextCursor);
      const readThrough = decoded.readThrough as number;
      expect(readThrough - previousReadThrough).toBeLessThanOrEqual(oneMiB);
      if (attempt === 0) {
        expect(batch.records).toEqual([]);
      }
      afterRecordSeen = batch.records.some((record) => (
        typeof record === 'object'
        && record !== null
        && (record as { after?: boolean }).after === true
      ));
      previousReadThrough = readThrough;
      cursor = batch.nextCursor;
    }
    expect(afterRecordSeen).toBe(true);
  });

  it('does not replay forever when the configured line limit reaches the 1 MiB budget', async () => {
    const recordFile = path.join(tempDir, 'line-limit-boundary.jsonl');
    const oneMiB = 1024 * 1024;
    await writeFile(recordFile, `${'y'.repeat(oneMiB)}\n{"tail":true}\n`, 'utf8');

    const first = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      maxBytes: oneMiB,
      maxLineBytes: oneMiB,
    });
    expect(first.records).toEqual([]);
    const firstCursor = decodeCursor(first.nextCursor);
    expect(firstCursor.skipping).toBe(true);

    const second = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      cursor: first.nextCursor,
      maxBytes: oneMiB,
      maxLineBytes: oneMiB,
    });
    expect(second.records).toEqual([{ tail: true }]);
  });

  it('isolates an overlong line and reports malformed JSON without exposing its body', async () => {
    const recordFile = path.join(tempDir, 'warnings.jsonl');
    const secretMarker = 'SYNTHETIC_SECRET_MARKER';
    await writeFile(recordFile, [
      JSON.stringify({ ok: true }),
      'not-json-' + secretMarker,
      JSON.stringify({ too: 'x'.repeat(80) }),
      JSON.stringify({ after: true }),
    ].join('\n') + '\n', 'utf8');
    const result = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      maxBytes: 1024,
      maxLineBytes: 32,
      sourceType: 'codex',
    });
    expect(result.records).toEqual([{ ok: true }, { after: true }]);
    expect(warningCategories(result.warnings)).toEqual([
      'malformed_json',
      'line_too_long',
    ]);
    expect(JSON.stringify(result.warnings)).not.toContain(secretMarker);
    expect(JSON.stringify(result.warnings)).not.toContain(recordFile);
    expect(result.partial).toBe(true);
  });

  it('resets safely when the file shrinks and marks the batch partial', async () => {
    const recordFile = path.join(tempDir, 'shrink.jsonl');
    await writeFile(recordFile, '{"id":"1"}\n{"id":"2"}\n', 'utf8');
    const first = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      maxBytes: 1024,
    });
    expect(first.records).toHaveLength(2);
    await writeFile(recordFile, '{"id":"new"}\n', 'utf8');
    const second = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      cursor: first.nextCursor,
      maxBytes: 1024,
    });
    expect(second.records).toEqual([{ id: 'new' }]);
    expect(second.partial).toBe(true);
    expect(warningCategories(second.warnings)).toContain('file_shrunk');
  });

  it('detects shrink after a replay cursor even when the new file stays beyond the line start', async () => {
    const recordFile = path.join(tempDir, 'partial-shrink.jsonl');
    await writeFile(recordFile, `{"id":"old"}\n{"partial":"${'x'.repeat(128)}`, 'utf8');
    const first = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      maxBytes: 1024,
    });
    const firstCursor = decodeCursor(first.nextCursor);
    expect(firstCursor.readThrough).toBeGreaterThan(firstCursor.offset as number);

    await writeFile(recordFile, '{"id":"new-record"}\n', 'utf8');
    const second = await readJsonlIncremental({
      filePath: recordFile,
      approvedRoots: [tempDir],
      cursor: first.nextCursor,
      maxBytes: 1024,
    });
    expect(second.records).toEqual([{ id: 'new-record' }]);
    expect(warningCategories(second.warnings)).toContain('file_shrunk');
    expect(second.partial).toBe(true);
  });
});
