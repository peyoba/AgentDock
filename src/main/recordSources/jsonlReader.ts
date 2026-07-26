import { constants } from 'node:fs';
import {
  lstat,
  open,
} from 'node:fs/promises';
import { resolveApprovedRecordFile } from './pathValidation.js';

const MAX_TOTAL_READ_BYTES = 1024 * 1024;
const DEFAULT_READ_BYTES = 64 * 1024;
const DEFAULT_MAX_LINE_BYTES = 256 * 1024;
const MAX_RECORDS_PER_READ = 8_192;

export type JsonlReadWarningCategory =
  | 'malformed_json'
  | 'line_too_long'
  | 'invalid_utf8'
  | 'record_limit'
  | 'file_shrunk'
  | 'file_replaced'
  | 'cursor_invalid';

/** Structured and deliberately path-/content-free warning for adapter mapping. */
export type JsonlReadWarning = {
  line: number;
  category: JsonlReadWarningCategory;
  sourceType: string;
};

export type ReadJsonlIncrementalInput = {
  filePath: string;
  cursor?: string;
  /** Maximum size of one physical read; values above 1 MiB are clamped. */
  maxBytes?: number;
  /** Maximum total bytes read by this call; values above 1 MiB are clamped. */
  maxTotalBytes?: number;
  /** Maximum UTF-8 bytes accepted for one complete JSONL line. */
  maxLineBytes?: number;
  /** Maximum parsed JSON records retained by this call. */
  maxRecords?: number;
  sourceType?: string;
  /** The file must resolve inside one of these approved roots. */
  approvedRoots: readonly string[];
};

export type JsonlIncrementalResult<T = unknown> = {
  records: T[];
  /** Absolute one-based logical line for each entry in `records`. */
  recordLines: number[];
  nextCursor: string;
  hasMore: boolean;
  warnings: JsonlReadWarning[];
  status: 'ready' | 'partial' | 'failed';
  partial: boolean;
  /** Physical bytes actually read by this call. */
  bytesRead: number;
};

/**
 * The cursor intentionally contains no carry bytes.  `replay` means `offset`
 * points at the start of an incomplete line, which is re-read from the source
 * on the next call.  A skipping cursor instead points at the next unread byte,
 * because bytes belonging to an overlong line have already been discarded.
 */
type CursorState = {
  version: 1;
  device: string;
  inode: string;
  offset: number;
  readThrough: number;
  line: number;
  replay: boolean;
  skipping: boolean;
  skipLine: number;
  skipWarned: boolean;
};

type FileIdentity = {
  device: string;
  inode: string;
  size: number;
};

type ByteBuffer = Buffer<ArrayBufferLike>;

function safeReaderError(message: string): Error {
  const error = new Error(message);
  error.stack = '';
  return error;
}

function safeSourceType(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(value)) {
    return 'unknown';
  }
  return value;
}

function warning(
  line: number,
  category: JsonlReadWarningCategory,
  sourceType: string,
): JsonlReadWarning {
  return { line, category, sourceType };
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): CursorState | undefined {
  // A valid cursor is tiny.  Reject oversized input before base64 decoding so
  // an attacker cannot turn a private API into an unbounded allocation.
  if (cursor === undefined || cursor.length === 0 || cursor.length > 8192) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    const allowedKeys = new Set([
      'version', 'device', 'inode', 'offset', 'readThrough', 'line',
      'replay', 'skipping', 'skipLine', 'skipWarned',
    ]);
    if (Reflect.ownKeys(parsed).some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
      return undefined;
    }
    if (
      parsed.version !== 1
      || typeof parsed.device !== 'string'
      || !/^\d{1,32}$/.test(parsed.device)
      || typeof parsed.inode !== 'string'
      || !/^\d{1,32}$/.test(parsed.inode)
      || !Number.isSafeInteger(parsed.offset)
      || (parsed.offset as number) < 0
      || !Number.isSafeInteger(parsed.readThrough)
      || (parsed.readThrough as number) < (parsed.offset as number)
      || !Number.isSafeInteger(parsed.line)
      || (parsed.line as number) < 0
      || typeof parsed.replay !== 'boolean'
      || typeof parsed.skipping !== 'boolean'
      || !Number.isSafeInteger(parsed.skipLine)
      || (parsed.skipLine as number) < 1
      || typeof parsed.skipWarned !== 'boolean'
    ) {
      return undefined;
    }
    if (parsed.replay && parsed.skipping) {
      return undefined;
    }
    return parsed as unknown as CursorState;
  } catch {
    return undefined;
  }
}

export function isValidJsonlReaderCursor(value: unknown): value is string {
  return typeof value === 'string' && decodeCursor(value) !== undefined;
}

function emptyCursor(identity: FileIdentity): CursorState {
  return {
    version: 1,
    device: identity.device,
    inode: identity.inode,
    offset: 0,
    readThrough: 0,
    line: 0,
    replay: false,
    skipping: false,
    skipLine: 1,
    skipWarned: false,
  };
}

function identityFromStats(stats: { dev: number | bigint; ino: number | bigint; size: number }): FileIdentity {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    size: stats.size,
  };
}

function sameIdentity(left: CursorState, right: FileIdentity): boolean {
  // Some Windows file systems expose zero for dev/ino.  In that case the size
  // check below is the only portable replacement/truncation signal available.
  if (left.device === '0' && left.inode === '0') {
    return true;
  }
  return left.device === right.device && left.inode === right.inode;
}

function sameFileNode(left: FileIdentity, right: FileIdentity): boolean {
  if (left.device === '0' && left.inode === '0') return true;
  return left.device === right.device && left.inode === right.inode;
}

async function resolveReaderPath(input: ReadJsonlIncrementalInput): Promise<string> {
  if (typeof input.filePath !== 'string' || input.filePath.length === 0) {
    throw safeReaderError('记录文件路径无效。');
  }
  if (!Array.isArray(input.approvedRoots) || input.approvedRoots.length === 0) {
    throw safeReaderError('允许的记录目录不能为空。');
  }
  return resolveApprovedRecordFile({
    candidatePath: input.filePath,
    approvedRoots: input.approvedRoots,
  });
}

async function readFileIdentity(filePath: string): Promise<FileIdentity> {
  let stats;
  try {
    stats = await lstat(filePath);
  } catch {
    throw safeReaderError('记录文件不存在或不可访问。');
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw safeReaderError('记录文件必须是普通文件。');
  }
  return identityFromStats(stats);
}

function decodeUtf8(lineBytes: ByteBuffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(lineBytes);
  } catch {
    return undefined;
  }
}

function parseLine<T>(
  lineBytes: ByteBuffer,
  line: number,
  maxLineBytes: number,
  maxRecords: number,
  sourceType: string,
  records: T[],
  recordLines: number[],
  warnings: JsonlReadWarning[],
): boolean {
  if (lineBytes.byteLength > maxLineBytes) {
    warnings.push(warning(line, 'line_too_long', sourceType));
    return false;
  }
  if (records.length >= maxRecords) {
    if (!warnings.some((item) => item.category === 'record_limit')) {
      warnings.push(warning(line, 'record_limit', sourceType));
    }
    return true;
  }
  // A CRLF terminator is part of the line delimiter, not JSON content.
  const contentBytes = lineBytes.byteLength > 0 && lineBytes[lineBytes.byteLength - 1] === 0x0d
    ? lineBytes.subarray(0, lineBytes.byteLength - 1)
    : lineBytes;
  if (contentBytes.byteLength === 0) {
    return false;
  }
  const text = decodeUtf8(contentBytes);
  if (text === undefined) {
    warnings.push(warning(line, 'invalid_utf8', sourceType));
    return false;
  }
  try {
    const parsed = JSON.parse(text) as T;
    records.push(parsed);
    recordLines.push(line);
  } catch {
    warnings.push(warning(line, 'malformed_json', sourceType));
  }
  return false;
}

/** Read complete JSONL records with a bounded total physical-read budget. */
export async function readJsonlIncremental<T = unknown>(
  input: ReadJsonlIncrementalInput,
): Promise<JsonlIncrementalResult<T>> {
  if (input === null || typeof input !== 'object') {
    throw safeReaderError('记录读取参数无效。');
  }
  const sourceType = safeSourceType(input.sourceType);
  const totalReadBudget = Math.min(
    MAX_TOTAL_READ_BYTES,
    Math.max(2, Number.isSafeInteger(input.maxTotalBytes)
      ? input.maxTotalBytes as number
      : MAX_TOTAL_READ_BYTES),
  );
  const chunkBytes = Math.min(
    totalReadBudget,
    Math.max(1, Number.isSafeInteger(input.maxBytes) ? input.maxBytes as number : DEFAULT_READ_BYTES),
  );
  const maxLineBytes = Math.min(
    totalReadBudget - 1,
    Math.max(1, Number.isSafeInteger(input.maxLineBytes)
      ? input.maxLineBytes as number
      : DEFAULT_MAX_LINE_BYTES),
  );
  const maxRecords = Math.min(
    MAX_RECORDS_PER_READ,
    Math.max(1, Number.isSafeInteger(input.maxRecords)
      ? input.maxRecords as number
      : MAX_RECORDS_PER_READ),
  );
  const filePath = await resolveReaderPath(input);
  const identity = await readFileIdentity(filePath);
  const decodedCursor = decodeCursor(input.cursor);
  const warnings: JsonlReadWarning[] = [];
  let state = decodedCursor ?? emptyCursor(identity);
  let wasReset = false;

  if (input.cursor !== undefined && decodedCursor === undefined) {
    warnings.push(warning(0, 'cursor_invalid', sourceType));
    state = emptyCursor(identity);
    wasReset = true;
  } else if (
    decodedCursor !== undefined
    && (!sameIdentity(decodedCursor, identity) || identity.size < decodedCursor.readThrough)
  ) {
    warnings.push(warning(0, identity.size < decodedCursor.readThrough ? 'file_shrunk' : 'file_replaced', sourceType));
    state = emptyCursor(identity);
    wasReset = true;
  }
  state.device = identity.device;
  state.inode = identity.inode;

  const records: T[] = [];
  const recordLines: number[] = [];
  let buffer: ByteBuffer = Buffer.alloc(0);
  let bufferStartOffset = state.offset;
  let physicalOffset = state.offset;
  let line = state.line;
  let skipping = state.skipping;
  let skipLine = state.skipLine;
  let skipWarned = state.skipWarned;
  let totalRead = 0;
  let sawCompleteLine = false;
  let recordLimitReached = false;
  let fileHandle;

  const noFollow = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
  try {
    fileHandle = await open(filePath, constants.O_RDONLY | noFollow);
    const openedStats = await fileHandle.stat();
    if (!openedStats.isFile()) {
      throw safeReaderError('记录文件必须是普通文件。');
    }
    const openedIdentity = identityFromStats(openedStats);
    if (!sameFileNode(identity, openedIdentity)) {
      throw safeReaderError('记录文件身份验证失败。');
    }
    const recheckedPath = await resolveApprovedRecordFile({
      candidatePath: input.filePath,
      approvedRoots: input.approvedRoots,
    });
    const recheckedIdentity = await readFileIdentity(recheckedPath);
    if (recheckedPath !== filePath || !sameFileNode(openedIdentity, recheckedIdentity)) {
      throw safeReaderError('记录文件身份验证失败。');
    }
    identity.size = openedIdentity.size;
    if (identity.size < state.readThrough) {
      warnings.push(warning(0, 'file_shrunk', sourceType));
      state = emptyCursor(identity);
      wasReset = true;
      buffer = Buffer.alloc(0);
      bufferStartOffset = 0;
      physicalOffset = 0;
      line = 0;
      skipping = false;
      skipLine = 1;
      skipWarned = false;
    }

    while (totalRead < totalReadBudget) {
      // Consume any complete lines already in the bounded carry buffer.
      if (skipping) {
        const newlineIndex = buffer.indexOf(0x0a);
        if (newlineIndex >= 0) {
          buffer = buffer.subarray(newlineIndex + 1);
          bufferStartOffset += newlineIndex + 1;
          line += 1;
          skipping = false;
          skipWarned = false;
          sawCompleteLine = true;
        } else {
          // Bytes in an overlong line are intentionally discarded; never carry
          // them into a cursor or let them grow beyond this call's budget.
          buffer = Buffer.alloc(0);
          bufferStartOffset = physicalOffset;
        }
      }

      if (!skipping) {
        let newlineIndex = buffer.indexOf(0x0a);
        while (newlineIndex >= 0) {
          if (records.length >= maxRecords) {
            recordLimitReached = true;
            if (!warnings.some((item) => item.category === 'record_limit')) {
              warnings.push(warning(line + 1, 'record_limit', sourceType));
            }
            break;
          }
          const lineBytes = buffer.subarray(0, newlineIndex);
          buffer = buffer.subarray(newlineIndex + 1);
          bufferStartOffset += newlineIndex + 1;
          line += 1;
          sawCompleteLine = true;
          recordLimitReached = parseLine(
            lineBytes,
            line,
            maxLineBytes,
            maxRecords,
            sourceType,
            records,
            recordLines,
            warnings,
          ) || recordLimitReached;
          newlineIndex = buffer.indexOf(0x0a);
        }

        if (!recordLimitReached && buffer.byteLength > maxLineBytes) {
          // The line has exceeded the limit without a terminator.  Isolate it
          // now, preserve only skip metadata, and continue while budget remains.
          skipping = true;
          skipLine = line + 1;
          if (!skipWarned) {
            warnings.push(warning(skipLine, 'line_too_long', sourceType));
            skipWarned = true;
          }
          buffer = Buffer.alloc(0);
          bufferStartOffset = physicalOffset;
        }
      }

      // A complete line obtained after a physical read ends this batch. Any
      // trailing partial line is represented by replaying from its start.
      if (sawCompleteLine && buffer.byteLength > 0 && !skipping) {
        break;
      }
      if (sawCompleteLine && buffer.byteLength === 0 && !skipping && totalRead > 0) {
        break;
      }

      const readLength = Math.min(chunkBytes, totalReadBudget - totalRead);
      const readBuffer = Buffer.allocUnsafe(readLength);
      const readResult = await fileHandle.read(
        readBuffer,
        0,
        readLength,
        physicalOffset,
      );
      if (readResult.bytesRead === 0) {
        break;
      }
      const chunk = readBuffer.subarray(0, readResult.bytesRead);
      if (buffer.byteLength === 0) {
        bufferStartOffset = physicalOffset;
        buffer = chunk;
      } else {
        buffer = Buffer.concat([buffer, chunk]);
      }
      physicalOffset += readResult.bytesRead;
      totalRead += readResult.bytesRead;
    }

    // Consume a final complete line after the last read, but do not read again
    // when the total budget is exhausted.
    if (skipping) {
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex >= 0) {
        buffer = buffer.subarray(newlineIndex + 1);
        bufferStartOffset += newlineIndex + 1;
        line += 1;
        skipping = false;
        skipWarned = false;
      }
    }
    if (!skipping) {
      let newlineIndex = buffer.indexOf(0x0a);
      while (newlineIndex >= 0) {
        if (records.length >= maxRecords) {
          recordLimitReached = true;
          if (!warnings.some((item) => item.category === 'record_limit')) {
            warnings.push(warning(line + 1, 'record_limit', sourceType));
          }
          break;
        }
        const lineBytes = buffer.subarray(0, newlineIndex);
        buffer = buffer.subarray(newlineIndex + 1);
        bufferStartOffset += newlineIndex + 1;
        line += 1;
        sawCompleteLine = true;
        recordLimitReached = parseLine(
          lineBytes,
          line,
          maxLineBytes,
          maxRecords,
          sourceType,
          records,
          recordLines,
          warnings,
        ) || recordLimitReached;
        newlineIndex = buffer.indexOf(0x0a);
      }
      if (!recordLimitReached && buffer.byteLength > maxLineBytes) {
        skipping = true;
        skipLine = line + 1;
        if (!skipWarned) {
          warnings.push(warning(skipLine, 'line_too_long', sourceType));
          skipWarned = true;
        }
        buffer = Buffer.alloc(0);
        bufferStartOffset = physicalOffset;
      }
    }
  } catch (error) {
    if (error instanceof Error && (
      error.message === '记录文件必须是普通文件。'
      || error.message === '记录路径包含不允许的符号链接。'
    )) {
      throw error;
    }
    throw safeReaderError('记录文件读取失败。');
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }

  const hasIncompleteLine = !skipping && buffer.byteLength > 0;
  const nextState: CursorState = {
    version: 1,
    device: identity.device,
    inode: identity.inode,
    offset: hasIncompleteLine ? bufferStartOffset : physicalOffset,
    readThrough: physicalOffset,
    line,
    replay: hasIncompleteLine,
    skipping,
    skipLine,
    skipWarned,
  };
  const hasMore = recordLimitReached || skipping || hasIncompleteLine || physicalOffset < identity.size;
  const partial = wasReset || hasMore || warnings.length > 0;
  return {
    records,
    recordLines,
    nextCursor: encodeCursor(nextState),
    hasMore,
    warnings,
    status: partial ? 'partial' : 'ready',
    partial,
    bytesRead: totalRead,
  };
}

export const JSONL_MAX_READ_BYTES = MAX_TOTAL_READ_BYTES;
export const JSONL_DEFAULT_MAX_LINE_BYTES = DEFAULT_MAX_LINE_BYTES;
