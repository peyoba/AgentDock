import path from 'node:path';
import type { AppBuildInfo } from '../shared/agentdockTypes.js';

type BuildInfoFile = Partial<Omit<AppBuildInfo, 'commitShort'>> & {
  commitShort?: string;
};

type ResolveAppBuildInfoOptions = {
  appVersion: string;
  resourcesPath: string;
  now: () => Date;
  readTextFile: (filePath: string) => string;
  readGitCommit: () => string | undefined;
  isGitDirty: () => boolean;
};

export function resolveAppBuildInfo({
  appVersion,
  resourcesPath,
  now,
  readTextFile,
  readGitCommit,
  isGitDirty,
}: ResolveAppBuildInfoOptions): AppBuildInfo {
  const packagedBuildInfoPath = path.join(resourcesPath, 'build-info.json');
  try {
    return normalizeBuildInfo(JSON.parse(readTextFile(packagedBuildInfoPath)) as BuildInfoFile);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw new Error(`构建信息文件不可读: ${packagedBuildInfoPath}`);
    }
  }

  const commit = readGitCommit() ?? 'unknown';
  return {
    version: appVersion,
    buildId: 'dev',
    buildTime: now().toISOString(),
    commit,
    commitShort: shortCommit(commit),
    dirty: isGitDirty(),
  };
}

function normalizeBuildInfo(value: BuildInfoFile): AppBuildInfo {
  const version = requiredString(value.version, 'version');
  const buildId = requiredString(value.buildId, 'buildId');
  const buildTime = requiredString(value.buildTime, 'buildTime');
  const commit = requiredString(value.commit, 'commit');
  const dirty = typeof value.dirty === 'boolean' ? value.dirty : false;

  return {
    version,
    buildId,
    buildTime,
    commit,
    commitShort: value.commitShort || shortCommit(commit),
    dirty,
  };
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`构建信息字段缺失: ${fieldName}`);
  }
  return value;
}

function shortCommit(commit: string): string {
  return commit === 'unknown' ? 'unknown' : commit.slice(0, 7);
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT',
  );
}
