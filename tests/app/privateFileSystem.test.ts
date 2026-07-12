import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendPrivateFile,
  ensurePrivateDirectory,
  ensurePrivateFile,
  writePrivateFileAtomically,
} from '../../src/main/privateFileSystem';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentdock-private-fs-'));
  temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
}

async function readMode(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

async function listUnexpectedSiblingEntries(
  directoryPath: string,
  targetBasename: string,
): Promise<string[]> {
  const entries = await readdir(directoryPath);
  return entries.filter((entry) => entry !== targetBasename);
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

describe.skipIf(process.platform === 'win32').sequential('privateFileSystem', () => {
  it('creates private directories and files with explicit modes under umask 022', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const privateDirectoryPath = path.join(temporaryRoot, 'private', 'nested');
    const privateFilePath = path.join(privateDirectoryPath, 'metadata.json');
    const previousUmask = process.umask(0o022);

    try {
      await ensurePrivateDirectory(privateDirectoryPath);
      await writePrivateFileAtomically(privateFilePath, '{"private":true}\n');

      expect(await readMode(path.join(temporaryRoot, 'private'))).toBe(PRIVATE_DIRECTORY_MODE);
      expect(await readMode(privateDirectoryPath)).toBe(PRIVATE_DIRECTORY_MODE);
      expect(await readMode(privateFilePath)).toBe(PRIVATE_FILE_MODE);
    } finally {
      process.umask(previousUmask);
    }
  });

  it('repairs legacy directory and file modes without changing file contents', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const privateDirectoryPath = path.join(temporaryRoot, 'legacy-private');
    const privateFilePath = path.join(privateDirectoryPath, 'legacy.json');
    const originalContents = '{"preserve":"exact contents"}\n';

    await mkdir(privateDirectoryPath, { mode: 0o755 });
    await writeFile(privateFilePath, originalContents, { mode: 0o644 });
    await chmod(privateDirectoryPath, 0o755);
    await chmod(privateFilePath, 0o644);

    await ensurePrivateDirectory(privateDirectoryPath);
    await ensurePrivateFile(privateFilePath);

    expect(await readMode(privateDirectoryPath)).toBe(PRIVATE_DIRECTORY_MODE);
    expect(await readMode(privateFilePath)).toBe(PRIVATE_FILE_MODE);
    await expect(readFile(privateFilePath, 'utf-8')).resolves.toBe(originalContents);
  });

  it('preserves the old target and leaves no temp file when an atomic write fails', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const privateDirectoryPath = path.join(temporaryRoot, 'private');
    const privateFilePath = path.join(privateDirectoryPath, 'metadata.json');
    const oldTargetMarkerPath = path.join(privateFilePath, 'old-target-marker.txt');
    const originalContents = 'old target remains complete\n';

    await mkdir(privateDirectoryPath, { mode: PRIVATE_DIRECTORY_MODE });
    await mkdir(privateFilePath, { mode: PRIVATE_DIRECTORY_MODE });
    await writeFile(oldTargetMarkerPath, originalContents, { mode: PRIVATE_FILE_MODE });

    await expect(
      writePrivateFileAtomically(privateFilePath, '{"version":"replacement"}\n'),
    ).rejects.toBeDefined();
    await expect(readFile(oldTargetMarkerPath, 'utf-8')).resolves.toBe(originalContents);
    expect((await stat(privateFilePath)).isDirectory()).toBe(true);
    await expect(
      listUnexpectedSiblingEntries(privateDirectoryPath, path.basename(privateFilePath)),
    ).resolves.toEqual([]);
  });

  it('appends content while creating and repairing the destination as mode 0600', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const privateFilePath = path.join(temporaryRoot, 'transcripts', 'session.log');

    await appendPrivateFile(privateFilePath, 'first line\n');
    await chmod(privateFilePath, 0o644);
    await appendPrivateFile(privateFilePath, 'second line\n');

    await expect(readFile(privateFilePath, 'utf-8')).resolves.toBe('first line\nsecond line\n');
    expect(await readMode(path.dirname(privateFilePath))).toBe(PRIVATE_DIRECTORY_MODE);
    expect(await readMode(privateFilePath)).toBe(PRIVATE_FILE_MODE);
  });

  it('rejects a symlink target without changing the external file', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const privateDirectoryPath = path.join(temporaryRoot, 'private');
    const externalFilePath = path.join(temporaryRoot, 'external.json');
    const privateFilePath = path.join(privateDirectoryPath, 'metadata.json');
    const externalContents = '{"external":"must remain unchanged"}\n';

    await mkdir(privateDirectoryPath, { mode: PRIVATE_DIRECTORY_MODE });
    await writeFile(externalFilePath, externalContents, { mode: 0o644 });
    await symlink(externalFilePath, privateFilePath);

    await expect(ensurePrivateFile(privateFilePath)).rejects.toBeDefined();
    await expect(writePrivateFileAtomically(privateFilePath, '{"unsafe":true}\n')).rejects.toBeDefined();
    await expect(appendPrivateFile(privateFilePath, 'unsafe append\n')).rejects.toBeDefined();

    await expect(readFile(externalFilePath, 'utf-8')).resolves.toBe(externalContents);
    expect(await readMode(externalFilePath)).toBe(0o644);
    expect((await lstat(privateFilePath)).isSymbolicLink()).toBe(true);
  });

  it('rejects a symlink parent without creating or changing external content', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const externalDirectoryPath = path.join(temporaryRoot, 'external');
    const externalFilePath = path.join(externalDirectoryPath, 'metadata.json');
    const linkedPrivateDirectoryPath = path.join(temporaryRoot, 'private-link');
    const linkedPrivateFilePath = path.join(linkedPrivateDirectoryPath, 'metadata.json');
    const externalContents = '{"external":"must remain unchanged"}\n';

    await mkdir(externalDirectoryPath, { mode: 0o755 });
    await writeFile(externalFilePath, externalContents, { mode: 0o644 });
    await symlink(externalDirectoryPath, linkedPrivateDirectoryPath);

    await expect(ensurePrivateDirectory(linkedPrivateDirectoryPath)).rejects.toBeDefined();
    await expect(
      writePrivateFileAtomically(linkedPrivateFilePath, '{"unsafe":true}\n'),
    ).rejects.toBeDefined();
    await expect(appendPrivateFile(linkedPrivateFilePath, 'unsafe append\n')).rejects.toBeDefined();

    await expect(readFile(externalFilePath, 'utf-8')).resolves.toBe(externalContents);
    expect(await readMode(externalDirectoryPath)).toBe(0o755);
    expect(await readMode(externalFilePath)).toBe(0o644);
  });

  it('uses independent random temp files for concurrent atomic writes', async () => {
    const temporaryRoot = await createTemporaryRoot();
    const privateDirectoryPath = path.join(temporaryRoot, 'private');
    const privateFilePath = path.join(privateDirectoryPath, 'metadata.json');
    const candidateContents = Array.from(
      { length: 40 },
      (_, index) => `${JSON.stringify({ writer: index, payload: `complete-${index}` })}\n`,
    );

    const writeResults = await Promise.allSettled(
      candidateContents.map((contents) => writePrivateFileAtomically(privateFilePath, contents)),
    );

    expect(writeResults.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(candidateContents).toContain(await readFile(privateFilePath, 'utf-8'));
    expect(await readMode(privateFilePath)).toBe(PRIVATE_FILE_MODE);
    await expect(
      listUnexpectedSiblingEntries(privateDirectoryPath, path.basename(privateFilePath)),
    ).resolves.toEqual([]);
  });
});
