import { execFile } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  SessionFileIndexEntry,
  WorkspaceFileStatus,
  WorkspaceFileTreeEntry,
} from '../shared/agentdockTypes.js';

const execFileAsync = promisify(execFile);
const ignoredDirectoryNames = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'release',
  'coverage',
  '.next',
  '.turbo',
]);

export type WorkspaceFileTreeResult = {
  relativePath: string;
  entries: WorkspaceFileTreeEntry[];
};

export type WorkspaceFileTreeService = {
  listDirectory(request: {
    workspacePath: string;
    relativePath: string;
    touchedFiles?: Set<string> | Map<string, SessionFileIndexEntry>;
  }): Promise<WorkspaceFileTreeResult>;
};

type CreateWorkspaceFileTreeServiceOptions = {
  readGitStatus?: (workspacePath: string) => Promise<Map<string, WorkspaceFileStatus>>;
};

function assertInsideWorkspace(workspaceRealPath: string, targetRealPath: string): void {
  if (targetRealPath !== workspaceRealPath && !targetRealPath.startsWith(`${workspaceRealPath}${path.sep}`)) {
    throw new Error('文件路径超出工作区');
  }
}

function normalizeRelativePath(relativePath: string): string {
  if (!relativePath || relativePath === '.') {
    return '.';
  }
  return relativePath.split(path.sep).join('/');
}

function statusFromPorcelain(code: string): WorkspaceFileStatus | undefined {
  if (code.includes('?')) {
    return '?';
  }
  if (code.includes('R')) {
    return 'R';
  }
  if (code.includes('A')) {
    return 'A';
  }
  if (code.includes('D')) {
    return 'D';
  }
  if (code.includes('M')) {
    return 'M';
  }
  return undefined;
}

async function readGitStatus(workspacePath: string): Promise<Map<string, WorkspaceFileStatus>> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workspacePath,
      'status',
      '--porcelain=v1',
      '--untracked-files=normal',
    ]);
    const statuses = new Map<string, WorkspaceFileStatus>();
    for (const line of stdout.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      const status = statusFromPorcelain(line.slice(0, 2));
      const rawPath = line.slice(3).trim();
      const relativePath = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath;
      if (status && relativePath) {
        statuses.set(relativePath, status);
      }
    }
    return statuses;
  } catch {
    return new Map();
  }
}

export function createWorkspaceFileTreeService({
  readGitStatus: readGitStatusOverride = readGitStatus,
}: CreateWorkspaceFileTreeServiceOptions = {}): WorkspaceFileTreeService {
  return {
    async listDirectory({ workspacePath, relativePath, touchedFiles = new Set() }) {
      const workspaceRealPath = await realpath(workspacePath);
      const targetPath = path.resolve(workspacePath, relativePath);
      const targetRealPath = await realpath(targetPath);
      assertInsideWorkspace(workspaceRealPath, targetRealPath);

      const [entries, gitStatus] = await Promise.all([
        readdir(targetRealPath, { withFileTypes: true }),
        readGitStatusOverride(workspacePath),
      ]);

      const visibleEntries: WorkspaceFileTreeEntry[] = [];
      for (const entry of entries) {
        if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
          continue;
        }

        const entryPath = path.join(targetRealPath, entry.name);
        if (entry.isSymbolicLink()) {
          const entryRealPath = await realpath(entryPath);
          assertInsideWorkspace(workspaceRealPath, entryRealPath);
        }

        const entryRelativePath = normalizeRelativePath(path.relative(workspaceRealPath, entryPath));
        const touchedEntry = touchedFiles instanceof Map
          ? touchedFiles.get(entryRelativePath)
          : undefined;
        const touchedInSession = touchedFiles instanceof Map
          ? touchedEntry?.touchedInSession === true
          : touchedFiles.has(entryRelativePath);
        visibleEntries.push({
          name: entry.name,
          relativePath: entryRelativePath,
          type: entry.isDirectory() ? 'directory' : 'file',
          gitStatus: gitStatus.get(entryRelativePath) ?? touchedEntry?.gitStatus,
          touchedInSession: touchedInSession || undefined,
          additions: touchedEntry?.additions,
          deletions: touchedEntry?.deletions,
        });
      }

      return {
        relativePath: normalizeRelativePath(path.relative(workspaceRealPath, targetRealPath)),
        entries: visibleEntries.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        }),
      };
    },
  };
}
