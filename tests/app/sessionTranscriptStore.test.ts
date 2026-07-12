import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionTranscriptStore } from '../../src/main/stores/sessionTranscriptStore';

let tempDir: string;

async function readPosixMode(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-transcript-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('sessionTranscriptStore', () => {
  it('creates private paths and heals legacy permissions without changing transcript contents', async () => {
    const store = createSessionTranscriptStore(tempDir);
    const transcriptDirectoryPath = path.join(tempDir, 'session-transcripts');
    const transcriptFilePath = path.join(transcriptDirectoryPath, 'session-1.log');

    await store.appendOutput('session-1', 'permission-contract-output');

    const newDirectoryMode = await readPosixMode(transcriptDirectoryPath);
    const newFileMode = await readPosixMode(transcriptFilePath);
    const contentsBeforeHealing = await readFile(transcriptFilePath, 'utf-8');

    await chmod(transcriptDirectoryPath, 0o755);
    await chmod(transcriptFilePath, 0o644);
    const tail = await store.readTail('session-1');

    expect({
      newDirectoryMode,
      newFileMode,
      healedDirectoryMode: await readPosixMode(transcriptDirectoryPath),
      healedFileMode: await readPosixMode(transcriptFilePath),
      contentsPreserved: (await readFile(transcriptFilePath, 'utf-8')) === contentsBeforeHealing,
      tailContent: tail.content,
    }).toEqual({
      newDirectoryMode: 0o700,
      newFileMode: 0o600,
      healedDirectoryMode: 0o700,
      healedFileMode: 0o600,
      contentsPreserved: true,
      tailContent: 'permission-contract-output',
    });
  });

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
