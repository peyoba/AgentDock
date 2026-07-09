import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionTranscriptStore } from '../../src/main/stores/sessionTranscriptStore';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-transcript-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('sessionTranscriptStore', () => {
  it('appends output and reads a bounded UTF-8 tail', async () => {
    const store = createSessionTranscriptStore(tempDir, { tailBytes: 12 });

    await store.appendOutput('session-1', 'hello-');
    await store.appendOutput('session-1', '中文-output');

    const tail = await store.readTail('session-1');

    expect(tail.content).toContain('output');
    expect(tail.content).not.toContain('\uFFFD');
    expect(tail.truncated).toBe(true);
    expect(tail.byteSize).toBe(Buffer.byteLength('hello-中文-output', 'utf-8'));
    expect(tail.filePath).toBe(path.join(tempDir, 'session-transcripts', 'session-1.log'));
  });

  it('serializes concurrent appends without losing output', async () => {
    const store = createSessionTranscriptStore(tempDir);

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.appendOutput('session-1', `${index},`)),
    );

    const tail = await store.readTail('session-1');

    expect(tail.content).toBe(Array.from({ length: 20 }, (_, index) => `${index},`).join(''));
    expect(tail.truncated).toBe(false);
  });

  it('rolls the transcript to a bounded tail when maxFileBytes is exceeded', async () => {
    const store = createSessionTranscriptStore(tempDir, { maxFileBytes: 100 });

    for (let index = 0; index < 12; index += 1) {
      await store.appendOutput('session-1', `chunk-${String(index).padStart(2, '0')};`);
    }

    const tail = await store.readTail('session-1');
    expect(tail.byteSize).toBeLessThanOrEqual(100);
    expect(tail.content.endsWith('chunk-11;')).toBe(true);
    expect(tail.content).not.toContain('chunk-00');
    await expect(store.statSize('session-1')).resolves.toBe(tail.byteSize);
  });

  it('recovers the append queue after a filesystem append failure', async () => {
    const store = createSessionTranscriptStore(tempDir);
    const transcriptDirPath = path.join(tempDir, 'session-transcripts');
    await writeFile(transcriptDirPath, 'not a directory', 'utf-8');

    await expect(store.appendOutput('session-1', 'first')).rejects.toThrow();

    await rm(transcriptDirPath, { force: true });
    await expect(store.appendOutput('session-1', 'second')).resolves.toEqual({
      byteSize: Buffer.byteLength('second', 'utf-8'),
      rolled: false,
    });

    const tail = await store.readTail('session-1');
    expect(tail.content).toBe('second');
  });
});
