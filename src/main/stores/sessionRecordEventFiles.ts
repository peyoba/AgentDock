import { constants } from 'node:fs';
import { lstat, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import {
  appendPrivateFile,
  ensurePrivateDirectory,
  ensurePrivateFile,
  writePrivateFileAtomically,
} from '../privateFileSystem.js';
import {
  SESSION_RECORD_EVENT_MAX_BYTES,
  SESSION_RECORD_EVENTS_READ_MAX_BYTES,
  SESSION_RECORD_FILE_MAX_BYTES,
  SESSION_RECORD_INDEX_MAX_BYTES,
  SESSION_RECORD_MAX_EVENTS,
  nativeSourceFromEntries,
  parseSessionRecordJsonl,
  retainLatestSessionRecordEvents,
  safeSessionRecordError,
  sameEventKeys,
  type SerializedSessionRecordEvent,
} from './sessionRecordEventCodec.js';
import {
  defaultSessionRecordIndex,
  normalizeSessionRecordEvent,
  normalizeSessionRecordIndex,
} from './sessionRecordEventSchema.js';
import type { SessionRecordIndex } from './sessionRecordEventStore.js';

export type LoadedSessionRecordFiles = {
  entries: SerializedSessionRecordEvent[];
  index: SessionRecordIndex;
  byteSize: number;
  middleCorruption: boolean;
};

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function isFileSystemErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function recordPaths(rootDir: string, sessionId: string) {
  const recordsRoot = path.join(rootDir, 'session-records');
  const sessionDirectory = path.join(recordsRoot, sessionId);
  return {
    recordsRoot,
    sessionDirectory,
    events: path.join(sessionDirectory, 'events.jsonl'),
    index: path.join(sessionDirectory, 'index.json'),
  };
}

async function ensureRecordDirectories(rootDir: string, sessionId: string): Promise<void> {
  const paths = recordPaths(rootDir, sessionId);
  await ensurePrivateDirectory(paths.recordsRoot);
  await ensurePrivateDirectory(paths.sessionDirectory);
}

async function readPrivateBuffer(filePath: string, maxBytes: number): Promise<Buffer | undefined> {
  await ensurePrivateFile(filePath);
  const noFollowFlag = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  let fileHandle;
  try {
    fileHandle = await open(filePath, constants.O_RDONLY | noFollowFlag);
  } catch (error) {
    if (isFileSystemErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
  try {
    const fileStats = await fileHandle.stat();
    if (!fileStats.isFile()) {
      throw safeSessionRecordError('会话记录私有文件无效。');
    }
    if (fileStats.size > maxBytes) {
      throw safeSessionRecordError('会话记录私有文件超过大小限制。');
    }
    const contents = await fileHandle.readFile();
    if (contents.byteLength > maxBytes) {
      throw safeSessionRecordError('会话记录私有文件超过大小限制。');
    }
    return contents;
  } finally {
    await fileHandle.close();
  }
}

function recoveredIndex(
  baseIndex: SessionRecordIndex | undefined,
  entries: readonly SerializedSessionRecordEvent[],
  status: 'stale' | 'failed',
  truncated: boolean,
): SessionRecordIndex {
  const inferredSource = nativeSourceFromEntries(entries);
  const source = inferredSource ?? baseIndex?.source;
  const binding = baseIndex?.binding !== undefined
    && (source === undefined || baseIndex.binding.source === source)
    ? baseIndex.binding
    : undefined;
  return {
    schemaVersion: 1,
    ...(source === undefined ? {} : { source }),
    ...(binding === undefined ? {} : { binding }),
    ...(baseIndex?.cursor === undefined ? {} : { cursor: baseIndex.cursor }),
    seenEventKeys: entries.map(({ eventKey }) => eventKey),
    status,
    ...(baseIndex?.lastSyncedAt === undefined
      ? {}
      : { lastSyncedAt: baseIndex.lastSyncedAt }),
    ...(baseIndex?.message === undefined ? {} : { message: baseIndex.message }),
    truncated: (baseIndex?.truncated ?? false) || truncated,
  };
}

export async function writeSessionRecordIndex(
  rootDir: string,
  sessionId: string,
  index: SessionRecordIndex,
): Promise<void> {
  const normalized = normalizeSessionRecordIndex(index, sessionId);
  const contents = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(contents, 'utf8') > SESSION_RECORD_INDEX_MAX_BYTES) {
    throw safeSessionRecordError('会话记录索引超过大小限制。');
  }
  // 目录只在写路径创建：纯读不落盘，避免为每个被打开的会话留下空私有目录。
  await ensureRecordDirectories(rootDir, sessionId);
  await writePrivateFileAtomically(
    recordPaths(rootDir, sessionId).index,
    contents,
  );
}

export async function replaceSessionRecordEvents(
  rootDir: string,
  sessionId: string,
  entries: readonly SerializedSessionRecordEvent[],
): Promise<number> {
  const contents = entries.map(({ line }) => line).join('');
  if (Buffer.byteLength(contents, 'utf8') > SESSION_RECORD_FILE_MAX_BYTES) {
    throw safeSessionRecordError('会话记录事件文件超过大小限制。');
  }
  await ensureRecordDirectories(rootDir, sessionId);
  await writePrivateFileAtomically(recordPaths(rootDir, sessionId).events, contents);
  return Buffer.byteLength(contents, 'utf-8');
}

export async function appendSessionRecordEvents(
  rootDir: string,
  sessionId: string,
  entries: readonly SerializedSessionRecordEvent[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const contents = entries.map(({ line }) => line).join('');
  const eventsPath = recordPaths(rootDir, sessionId).events;
  let existingBytes = 0;
  try {
    const stats = await lstat(eventsPath);
    if (!stats.isFile()) {
      throw safeSessionRecordError('会话记录私有文件无效。');
    }
    existingBytes = stats.size;
  } catch (error) {
    if (!isFileSystemErrorWithCode(error, 'ENOENT')) throw error;
  }
  if (
    existingBytes > SESSION_RECORD_FILE_MAX_BYTES
    || existingBytes + Buffer.byteLength(contents, 'utf8') > SESSION_RECORD_FILE_MAX_BYTES
  ) {
    throw safeSessionRecordError('会话记录事件文件超过大小限制。');
  }
  await ensureRecordDirectories(rootDir, sessionId);
  await appendPrivateFile(
    eventsPath,
    contents,
  );
}

export async function loadSessionRecordFiles(
  rootDir: string,
  sessionId: string,
): Promise<LoadedSessionRecordFiles> {
  const paths = recordPaths(rootDir, sessionId);
  // 纯读路径不创建目录：没有记录的会话直接返回空快照。否则每次打开旧会话
  // 都会留下一个永不回收、以完整 session id 命名的空私有目录。
  try {
    await lstat(paths.sessionDirectory);
  } catch (error) {
    if (isFileSystemErrorWithCode(error, 'ENOENT')) {
      return {
        entries: [],
        index: defaultSessionRecordIndex(),
        byteSize: 0,
        middleCorruption: false,
      };
    }
    throw error;
  }
  await ensureRecordDirectories(rootDir, sessionId);
  const [eventBuffer, indexBuffer] = await Promise.all([
    readPrivateBuffer(paths.events, SESSION_RECORD_EVENTS_READ_MAX_BYTES),
    readPrivateBuffer(paths.index, SESSION_RECORD_INDEX_MAX_BYTES),
  ]);
  if (eventBuffer === undefined && indexBuffer === undefined) {
    return {
      entries: [],
      index: defaultSessionRecordIndex(),
      byteSize: 0,
      middleCorruption: false,
    };
  }

  const parsed = eventBuffer === undefined
    ? {
      entries: [],
      validByteSize: 0,
      tailIncomplete: false,
      middleCorruption: false,
      needsRewrite: false,
    }
    : parseSessionRecordJsonl(eventBuffer, sessionId, normalizeSessionRecordEvent);
  let entries = parsed.entries;
  let byteSize = parsed.validByteSize;
  let retentionDropped = false;
  let rewriteEvents = parsed.tailIncomplete || parsed.needsRewrite;
  if (entries.length > SESSION_RECORD_MAX_EVENTS || byteSize > SESSION_RECORD_FILE_MAX_BYTES) {
    const retained = retainLatestSessionRecordEvents(entries);
    entries = retained.entries;
    byteSize = retained.byteSize;
    retentionDropped = retained.dropped;
    rewriteEvents = true;
  }
  if (rewriteEvents && !parsed.middleCorruption) {
    byteSize = await replaceSessionRecordEvents(rootDir, sessionId, entries);
  }

  let parsedIndex: SessionRecordIndex | undefined;
  let rewriteNormalizedIndex = false;
  if (indexBuffer !== undefined) {
    try {
      parsedIndex = normalizeSessionRecordIndex(
        JSON.parse(utf8Decoder.decode(indexBuffer)),
        sessionId,
      );
      rewriteNormalizedIndex = !indexBuffer.equals(Buffer.from(
        `${JSON.stringify(parsedIndex, null, 2)}\n`,
        'utf8',
      ));
    } catch {
      parsedIndex = undefined;
    }
  }

  const eventKeys = entries.map(({ eventKey }) => eventKey);
  const inferredSource = nativeSourceFromEntries(entries);
  const indexEventKeysMatch = parsedIndex !== undefined
    && sameEventKeys(parsedIndex.seenEventKeys, eventKeys);
  const indexMismatch = parsedIndex !== undefined && (
    !indexEventKeysMatch
    || (inferredSource !== undefined && parsedIndex.source !== inferredSource)
  );
  const hasCompleteEventsWindow = !parsed.middleCorruption && !parsed.tailIncomplete;
  const eventKeySet = new Set(eventKeys);
  const eventsMissingKnownIndexKeys = hasCompleteEventsWindow
    && (parsedIndex?.seenEventKeys.some((eventKey) => !eventKeySet.has(eventKey)) ?? false);
  const atRetentionBoundary = entries.length === SESSION_RECORD_MAX_EVENTS
    || byteSize > SESSION_RECORD_FILE_MAX_BYTES - (SESSION_RECORD_EVENT_MAX_BYTES + 1);
  const unreadableIndexAtRetentionBoundary = hasCompleteEventsWindow
    && parsedIndex === undefined
    && atRetentionBoundary;
  const recoveredTruncated = retentionDropped
    || eventsMissingKnownIndexKeys
    || unreadableIndexAtRetentionBoundary;
  const needsRecoveredIndex = parsedIndex === undefined
    || parsed.middleCorruption
    || parsed.tailIncomplete
    || parsed.needsRewrite
    || retentionDropped
    || indexMismatch;
  let index: SessionRecordIndex;
  if (needsRecoveredIndex) {
    index = recoveredIndex(
      parsedIndex,
      entries,
      parsed.middleCorruption ? 'failed' : 'stale',
      recoveredTruncated,
    );
  } else if (parsedIndex !== undefined) {
    index = parsedIndex;
  } else {
    throw safeSessionRecordError('会话记录索引恢复失败。');
  }
  if (
    (needsRecoveredIndex || rewriteNormalizedIndex)
    && (eventBuffer !== undefined || indexBuffer !== undefined)
  ) {
    await writeSessionRecordIndex(rootDir, sessionId, index);
  }

  return { entries, index, byteSize, middleCorruption: parsed.middleCorruption };
}

export async function deleteSessionRecordFiles(
  rootDir: string,
  sessionId: string,
): Promise<void> {
  const paths = recordPaths(rootDir, sessionId);
  await ensurePrivateDirectory(paths.recordsRoot);
  try {
    const targetStats = await lstat(paths.sessionDirectory);
    if (targetStats.isSymbolicLink() || !targetStats.isDirectory()) {
      throw safeSessionRecordError('会话记录目录无效。');
    }
  } catch (error) {
    if (isFileSystemErrorWithCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
  await rm(paths.sessionDirectory, { recursive: true, force: true });
}
