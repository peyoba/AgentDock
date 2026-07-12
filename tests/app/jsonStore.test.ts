import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJsonStore } from '../../src/main/stores/jsonStore';

type TestRecord = {
  id: string;
  writer: number;
  payload: string;
};

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentdock-json-store-'));
  temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((temporaryRoot) =>
      rm(temporaryRoot, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('jsonStore concurrent persistence', () => {
  it('allows independent store instances to replace the same file without shared-temp ENOENT', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const storePath = path.join(temporaryRoot, 'private', 'sessions.json');
    const candidateDocuments = Array.from({ length: 40 }, (_, writer) => [
      {
        id: `session-${writer}`,
        writer,
        payload: `complete-payload-${writer}`,
      },
    ] satisfies TestRecord[]);
    const stores = candidateDocuments.map(() => createJsonStore<TestRecord>(storePath));

    const writeResults = await Promise.allSettled(
      stores.map((store, index) => store.replaceAll(candidateDocuments[index])),
    );

    expect(writeResults).toEqual(
      Array.from({ length: stores.length }, () => expect.objectContaining({ status: 'fulfilled' })),
    );

    const rawDocument = await readFile(storePath, 'utf-8');
    const parsedDocument = JSON.parse(rawDocument) as TestRecord[];
    expect(candidateDocuments).toContainEqual(parsedDocument);
    expect(parsedDocument).toHaveLength(1);
    expect(parsedDocument[0].payload).toBe(`complete-payload-${parsedDocument[0].writer}`);

    const siblingEntries = await readdir(path.dirname(storePath));
    expect(siblingEntries).toEqual(['sessions.json']);
  });

  it('keeps the final document complete during repeated concurrent multi-instance writes', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const storePath = path.join(temporaryRoot, 'private', 'profiles.json');
    const rounds = Array.from({ length: 8 }, (_, round) => round);

    for (const round of rounds) {
      const candidateDocuments = Array.from({ length: 20 }, (_, writer) => [
        {
          id: `round-${round}-writer-${writer}`,
          writer,
          payload: `round-${round}-complete-payload-${writer}`,
        },
      ] satisfies TestRecord[]);
      const writeResults = await Promise.allSettled(
        candidateDocuments.map((document) =>
          createJsonStore<TestRecord>(storePath).replaceAll(document),
        ),
      );

      expect(writeResults.every((result) => result.status === 'fulfilled')).toBe(true);

      const rawDocument = await readFile(storePath, 'utf-8');
      const parsedDocument = JSON.parse(rawDocument) as TestRecord[];
      expect(candidateDocuments).toContainEqual(parsedDocument);
      expect(rawDocument.endsWith('\n')).toBe(true);
    }
  });
});
