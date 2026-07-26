import {
  lstat,
  opendir,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

const DARWIN_SYSTEM_DIRECTORY_ALIASES = new Set(['/tmp', '/var']);
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_FILES = 5_000;
const MAX_APPROVED_ROOTS = 16;
const MAX_DIRECTORY_ENTRIES = 4_096;
const MAX_TOTAL_ENTRIES = 50_000;
const MAX_TOTAL_DIRECTORIES = 4_096;
const MAX_PENDING_DIRECTORIES = 1_024;

export type ResolveApprovedRecordFileInput = {
  candidatePath: string;
  approvedRoots: readonly string[];
};

export type JsonlDiscoveryInput = {
  rootPath: string;
  approvedRoots: readonly string[];
  maxDepth?: number;
  maxFiles?: number;
};

export type PathValidationWarning = {
  category:
    | 'directory_unavailable'
    | 'symlink_skipped'
    | 'path_rejected'
    | 'depth_limit'
    | 'file_limit'
    | 'entry_limit'
    | 'directory_limit'
    | 'inspection_limit';
  sourceType: 'path';
};

export type JsonlDiscoveryResult = {
  files: string[];
  status: 'ready' | 'partial' | 'unavailable' | 'failed';
  hasMore: boolean;
  warnings: PathValidationWarning[];
};

function safePathError(message: string): Error {
  // Deliberately do not include candidate/root paths or an fs stack in public errors.
  const error = new Error(message);
  error.stack = '';
  return error;
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isWithinDirectory(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

function isAllowedDarwinAlias(targetPath: string): boolean {
  return process.platform === 'darwin' && DARWIN_SYSTEM_DIRECTORY_ALIASES.has(targetPath);
}

async function rejectDisallowedSymlinks(targetPath: string): Promise<void> {
  const absolutePath = path.resolve(targetPath);
  const parsed = path.parse(absolutePath);
  const relative = absolutePath.slice(parsed.root.length);
  const segments = relative.split(path.sep).filter(Boolean);
  let inspected = parsed.root;

  for (const segment of segments) {
    inspected = path.join(inspected, segment);
    let stats;
    try {
      stats = await lstat(inspected);
    } catch (error) {
      if (isFileSystemError(error) && error.code === 'ENOENT') {
        throw safePathError('记录路径不存在或不可访问。');
      }
      throw safePathError('记录路径不可访问。');
    }
    if (stats.isSymbolicLink() && !isAllowedDarwinAlias(inspected)) {
      throw safePathError('记录路径包含不允许的符号链接。');
    }
  }
}

async function prepareApprovedRoot(rootPath: string): Promise<{
  absolutePath: string;
  resolvedPath: string;
}> {
  if (typeof rootPath !== 'string' || rootPath.length === 0) {
    throw safePathError('允许的记录目录无效。');
  }
  const absolutePath = path.resolve(rootPath);
  await rejectDisallowedSymlinks(absolutePath);
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch {
    throw safePathError('允许的记录目录不可用。');
  }
  if (!stats.isDirectory() && !(
    stats.isSymbolicLink() && isAllowedDarwinAlias(absolutePath)
  )) {
    throw safePathError('允许的记录目录无效。');
  }
  if (stats.isSymbolicLink() && isAllowedDarwinAlias(absolutePath)) {
    try {
      const followedStats = await stat(absolutePath);
      if (!followedStats.isDirectory()) {
        throw safePathError('允许的记录目录无效。');
      }
    } catch (error) {
      if (error instanceof Error && error.message === '允许的记录目录无效。') {
        throw error;
      }
      throw safePathError('允许的记录目录不可用。');
    }
  }
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(absolutePath);
  } catch {
    throw safePathError('允许的记录目录不可用。');
  }
  return { absolutePath, resolvedPath };
}

async function prepareApprovedRoots(approvedRoots: readonly string[]): Promise<Array<{
  absolutePath: string;
  resolvedPath: string;
}>> {
  if (
    !Array.isArray(approvedRoots)
    || approvedRoots.length === 0
    || approvedRoots.length > MAX_APPROVED_ROOTS
  ) {
    throw safePathError('允许的记录目录无效。');
  }
  return Promise.all(approvedRoots.map((root) => prepareApprovedRoot(root)));
}

/**
 * Resolve a candidate native record file only when it is contained by an
 * approved root both lexically and after realpath resolution.
 */
export async function resolveApprovedRecordFile(
  input: ResolveApprovedRecordFileInput,
): Promise<string> {
  if (
    input === null
    || typeof input !== 'object'
    || typeof input.candidatePath !== 'string'
    || input.candidatePath.length === 0
    || !Array.isArray(input.approvedRoots)
    || input.approvedRoots.length === 0
  ) {
    throw safePathError('记录文件路径或允许的记录目录无效。');
  }

  const candidateAbsolute = path.resolve(input.candidatePath);
  const roots = await prepareApprovedRoots(input.approvedRoots);
  const lexicalRoot = roots.find(({ absolutePath, resolvedPath }) => (
    isWithinDirectory(absolutePath, candidateAbsolute)
    || isWithinDirectory(resolvedPath, candidateAbsolute)
  ));
  if (lexicalRoot === undefined) {
    throw safePathError('记录文件不在允许的记录目录内。');
  }

  // Check every existing component before realpath so a malicious symlink cannot
  // be used to make the later containment check appear safe.
  await rejectDisallowedSymlinks(candidateAbsolute);

  let candidateResolved: string;
  try {
    candidateResolved = await realpath(candidateAbsolute);
  } catch {
    throw safePathError('记录文件不可用。');
  }
  const resolvedRoot = roots.find(({ resolvedPath }) => (
    isWithinDirectory(resolvedPath, candidateResolved)
  ));
  if (resolvedRoot === undefined) {
    throw safePathError('记录文件不在允许的记录目录内。');
  }

  let candidateStats;
  try {
    candidateStats = await lstat(candidateAbsolute);
  } catch {
    throw safePathError('记录文件不可用。');
  }
  if (candidateStats.isSymbolicLink()) {
    throw safePathError('记录文件不能是符号链接。');
  }
  if (!candidateStats.isFile()) {
    throw safePathError('记录文件必须是普通文件。');
  }

  // Recheck the final path after the file-type test to narrow the TOCTOU window.
  await rejectDisallowedSymlinks(candidateAbsolute);
  return candidateResolved;
}

function warning(category: PathValidationWarning['category']): PathValidationWarning {
  return { category, sourceType: 'path' };
}

/** Discover regular `.jsonl` files below a bounded, approved directory. */
export async function discoverJsonlFiles(
  input: JsonlDiscoveryInput,
): Promise<JsonlDiscoveryResult> {
  if (input === null || typeof input !== 'object') {
    throw safePathError('记录目录发现参数无效。');
  }
  const maxDepth = Math.min(
    DEFAULT_MAX_DEPTH,
    Math.max(0, Number.isSafeInteger(input.maxDepth) ? input.maxDepth as number : DEFAULT_MAX_DEPTH),
  );
  const maxFiles = Math.min(
    DEFAULT_MAX_FILES,
    Math.max(0, Number.isSafeInteger(input.maxFiles) ? input.maxFiles as number : DEFAULT_MAX_FILES),
  );
  const warnings: PathValidationWarning[] = [];
  const files: string[] = [];
  let hasMore = false;
  let checkedJsonlCandidates = 0;
  let candidateLimitReached = false;
  let totalEntries = 0;
  let totalDirectories = 0;

  let root: { absolutePath: string; resolvedPath: string };
  try {
    root = await prepareApprovedRoot(input.rootPath);
    const approvedRoots = await prepareApprovedRoots(input.approvedRoots);
    const lexicalAllowed = approvedRoots.some(({ absolutePath, resolvedPath }) => (
      isWithinDirectory(absolutePath, root.absolutePath)
      || isWithinDirectory(resolvedPath, root.absolutePath)
    ));
    const realAllowed = approvedRoots.some(({ resolvedPath }) => (
      isWithinDirectory(resolvedPath, root.resolvedPath)
    ));
    if (!lexicalAllowed || !realAllowed) {
      return {
        files: [],
        status: 'unavailable',
        hasMore: false,
        warnings: [warning('path_rejected')],
      };
    }
  } catch {
    return {
      files: [],
      status: 'unavailable',
      hasMore: false,
      warnings: [warning('directory_unavailable')],
    };
  }

  if (maxFiles === 0) {
    return {
      files,
      status: 'partial',
      hasMore: true,
      warnings: [warning('file_limit')],
    };
  }

  type PendingDirectory = { absolutePath: string; depth: number };
  const pending: PendingDirectory[] = [{ absolutePath: root.absolutePath, depth: 0 }];
  while (pending.length > 0 && !candidateLimitReached && totalEntries < MAX_TOTAL_ENTRIES) {
    const current = pending.pop() as PendingDirectory;
    totalDirectories += 1;
    if (totalDirectories > MAX_TOTAL_DIRECTORIES) {
      hasMore = true;
      warnings.push(warning('directory_limit'));
      break;
    }
    let directory;
    try {
      directory = await opendir(current.absolutePath);
    } catch {
      warnings.push(warning('directory_unavailable'));
      continue;
    }
    let directoryEntries = 0;
    let remainingRelevantEntry = false;
    try {
      const entries = [];
      for await (const entry of directory) {
        totalEntries += 1;
        directoryEntries += 1;
        if (totalEntries > MAX_TOTAL_ENTRIES || directoryEntries > MAX_DIRECTORY_ENTRIES) {
          hasMore = true;
          warnings.push(warning('entry_limit'));
          break;
        }
        entries.push(entry);
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
      const entryPath = path.join(current.absolutePath, entry.name);
      const isJsonlCandidate = entry.name.toLowerCase().endsWith('.jsonl')
        && !entry.isDirectory();

        if (candidateLimitReached) {
          remainingRelevantEntry ||= entry.isDirectory() || isJsonlCandidate;
          continue;
        }
      if (isJsonlCandidate) {
        checkedJsonlCandidates += 1;
      }
      if (entry.isSymbolicLink()) {
        warnings.push(warning('symlink_skipped'));
      } else if (entry.isDirectory()) {
        if (current.depth >= maxDepth) {
          hasMore = true;
          warnings.push(warning('depth_limit'));
        } else if (pending.length >= MAX_PENDING_DIRECTORIES) {
          hasMore = true;
          warnings.push(warning('directory_limit'));
        } else {
          pending.push({ absolutePath: entryPath, depth: current.depth + 1 });
        }
      } else if (entry.isFile() && isJsonlCandidate) {
        try {
          const resolved = await resolveApprovedRecordFile({
            candidatePath: entryPath,
            approvedRoots: [root.absolutePath],
          });
          files.push(resolved);
        } catch {
          warnings.push(warning('path_rejected'));
        }
      } else if (isJsonlCandidate) {
        warnings.push(warning('path_rejected'));
      }

      if (isJsonlCandidate && checkedJsonlCandidates >= maxFiles) {
        candidateLimitReached = true;
        warnings.push(warning('file_limit'));
      }
      }
    } catch {
      warnings.push(warning('directory_unavailable'));
    } finally {
      await directory.close().catch(() => undefined);
    }
    hasMore ||= remainingRelevantEntry;
  }
  if (pending.length > 0) {
    hasMore = true;
  }
  files.sort((left, right) => left.localeCompare(right));
  return {
    files,
    status: candidateLimitReached || hasMore || warnings.length > 0 ? 'partial' : 'ready',
    hasMore,
    warnings,
  };
}

export const RECORD_SOURCE_MAX_DEPTH = DEFAULT_MAX_DEPTH;
export const RECORD_SOURCE_MAX_FILES = DEFAULT_MAX_FILES;
