import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DARWIN_SYSTEM_DIRECTORY_ALIASES = new Set(['/tmp', '/var']);

function isFileSystemErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function applyPrivateMode(targetPath: string, mode: number): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }

  await chmod(targetPath, mode);
}

async function applyPrivateFileHandleMode(fileHandle: FileHandle): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }

  await fileHandle.chmod(PRIVATE_FILE_MODE);
}

async function rejectSymbolicLinksInPath(targetPath: string): Promise<void> {
  const absoluteTargetPath = path.resolve(targetPath);
  const parsedPath = path.parse(absoluteTargetPath);
  const relativePath = absoluteTargetPath.slice(parsedPath.root.length);
  const pathSegments = relativePath.split(path.sep).filter(Boolean);
  let inspectedPath = parsedPath.root;

  for (const pathSegment of pathSegments) {
    inspectedPath = path.join(inspectedPath, pathSegment);

    try {
      const pathStats = await lstat(inspectedPath);
      const isAllowedDarwinSystemAlias =
        process.platform === 'darwin' && DARWIN_SYSTEM_DIRECTORY_ALIASES.has(inspectedPath);
      if (pathStats.isSymbolicLink() && !isAllowedDarwinSystemAlias) {
        throw new Error(`Refusing to use symbolic link in private path: ${inspectedPath}`);
      }
    } catch (error) {
      if (isFileSystemErrorWithCode(error, 'ENOENT')) {
        return;
      }
      throw error;
    }
  }
}

async function rejectSymbolicLinkTarget(targetPath: string): Promise<void> {
  try {
    const targetStats = await lstat(targetPath);
    if (targetStats.isSymbolicLink()) {
      throw new Error(`Refusing to use symbolic link as private file: ${targetPath}`);
    }
  } catch (error) {
    if (isFileSystemErrorWithCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
}

export async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  await rejectSymbolicLinksInPath(directoryPath);
  await mkdir(directoryPath, {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });
  await rejectSymbolicLinksInPath(directoryPath);
  await applyPrivateMode(directoryPath, PRIVATE_DIRECTORY_MODE);
}

export async function ensurePrivateFile(filePath: string): Promise<void> {
  await rejectSymbolicLinksInPath(filePath);

  try {
    const fileStats = await lstat(filePath);
    if (fileStats.isSymbolicLink()) {
      throw new Error(`Refusing to use symbolic link as private file: ${filePath}`);
    }
    if (!fileStats.isFile()) {
      throw new Error(`Expected private file at: ${filePath}`);
    }
    await applyPrivateMode(filePath, PRIVATE_FILE_MODE);
  } catch (error) {
    if (isFileSystemErrorWithCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
}

function createPrivateTemporaryPath(filePath: string): string {
  const randomSuffix = randomBytes(16).toString('hex');
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${randomSuffix}`,
  );
}

export async function writePrivateFileAtomically(
  filePath: string,
  contents: string,
): Promise<void> {
  const parentDirectoryPath = path.dirname(filePath);
  await ensurePrivateDirectory(parentDirectoryPath);
  await rejectSymbolicLinkTarget(filePath);

  const temporaryFilePath = createPrivateTemporaryPath(filePath);
  let temporaryFileHandle: FileHandle | undefined;

  try {
    temporaryFileHandle = await open(temporaryFilePath, 'wx', PRIVATE_FILE_MODE);
    await applyPrivateFileHandleMode(temporaryFileHandle);
    await temporaryFileHandle.writeFile(contents, 'utf-8');
    await temporaryFileHandle.close();
    temporaryFileHandle = undefined;

    await rejectSymbolicLinksInPath(filePath);
    await rejectSymbolicLinkTarget(filePath);
    await rename(temporaryFilePath, filePath);
    await ensurePrivateFile(filePath);
  } finally {
    await temporaryFileHandle?.close().catch(() => undefined);
    await rm(temporaryFilePath, { force: true }).catch(() => undefined);
  }
}

export async function appendPrivateFile(filePath: string, contents: string): Promise<void> {
  const parentDirectoryPath = path.dirname(filePath);
  await ensurePrivateDirectory(parentDirectoryPath);
  await ensurePrivateFile(filePath);

  const noFollowFlag = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  const appendFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | noFollowFlag;
  const fileHandle = await open(filePath, appendFlags, PRIVATE_FILE_MODE);

  try {
    const fileStats = await fileHandle.stat();
    if (!fileStats.isFile()) {
      throw new Error(`Expected private file at: ${filePath}`);
    }
    await applyPrivateFileHandleMode(fileHandle);
    await fileHandle.writeFile(contents, 'utf-8');
    await applyPrivateFileHandleMode(fileHandle);
  } finally {
    await fileHandle.close();
  }
}
