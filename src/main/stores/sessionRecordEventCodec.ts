import { TextDecoder } from 'node:util';
import type { SessionRecordEventDto } from '../../shared/agentdockTypes.js';

export const SESSION_RECORD_EVENT_MAX_BYTES = 128 * 1024;
export const SESSION_RECORD_FILE_MAX_BYTES = 64 * 1024 * 1024;
export const SESSION_RECORD_MAX_EVENTS = 50_000;
export const SESSION_RECORD_BATCH_MAX_EVENTS = 4_096;
export const SESSION_RECORD_BATCH_MAX_BYTES = 8 * 1024 * 1024;
export const SESSION_RECORD_INDEX_MAX_BYTES = 16 * 1024 * 1024;
export const SESSION_RECORD_JSONL_LINE_MAX_BYTES = SESSION_RECORD_EVENT_MAX_BYTES + 1;
export const SESSION_RECORD_EVENTS_READ_MAX_BYTES =
  SESSION_RECORD_FILE_MAX_BYTES + SESSION_RECORD_JSONL_LINE_MAX_BYTES;

export type NativeRecordSource = 'claude' | 'codex' | 'grok';

export type SerializedSessionRecordEvent = {
  event: SessionRecordEventDto;
  eventKey: string;
  line: string;
  lineBytes: number;
};

export type ParsedSessionRecordEvents = {
  entries: SerializedSessionRecordEvent[];
  validByteSize: number;
  tailIncomplete: boolean;
  middleCorruption: boolean;
  needsRewrite: boolean;
};

class SafeSessionRecordStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionRecordStoreError';
    this.stack = undefined;
  }
}

export function safeSessionRecordError(message: string): Error {
  return new SafeSessionRecordStoreError(message);
}

export function publicSessionRecordError(error: unknown): Error {
  return error instanceof SafeSessionRecordStoreError
    ? error
    : safeSessionRecordError('会话记录存储操作失败。');
}

function utf8Prefix(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf-8');
  if (buffer.length <= maxBytes) {
    return value;
  }
  let end = Math.max(0, maxBytes);
  while (end > 0 && (buffer[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return buffer.subarray(0, end).toString('utf-8');
}

function truncatableFields(event: SessionRecordEventDto): Array<{
  value: string;
  minimumValue: string;
  replace(value: string): void;
}> {
  switch (event.kind) {
    case 'user_message':
    case 'assistant_message':
      return [{
        value: event.payload.text,
        minimumValue: '',
        replace: (value) => { event.payload.text = value; },
      }];
    case 'tool_call': {
      const fields: Array<{
        value: string;
        minimumValue: string;
        replace(value: string): void;
      }> = [];
      if (event.payload.argumentsSummary !== undefined) {
        fields.push({
          value: event.payload.argumentsSummary,
          minimumValue: '',
          replace: (value) => { event.payload.argumentsSummary = value; },
        });
      }
      fields.push({
        value: event.payload.toolName,
        minimumValue: firstUtf8Character(event.payload.toolName),
        replace: (value) => { event.payload.toolName = value; },
      });
      return fields;
    }
    case 'tool_result':
    case 'status':
      return event.payload.text === undefined
        ? []
        : [{
          value: event.payload.text,
          minimumValue: '',
          replace: (value) => { event.payload.text = value; },
        }];
  }
}

function firstUtf8Character(value: string): string {
  for (const character of value) {
    return character;
  }
  return '';
}

function serializedBytes(event: SessionRecordEventDto): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf-8');
}

export function serializeSessionRecordEvent(
  event: SessionRecordEventDto,
  allowPayloadTruncation: boolean,
): SerializedSessionRecordEvent {
  let serialized = JSON.stringify(event);
  if (Buffer.byteLength(serialized, 'utf-8') > SESSION_RECORD_EVENT_MAX_BYTES) {
    if (!allowPayloadTruncation) {
      throw safeSessionRecordError('会话记录事件超过大小限制。');
    }
    event.truncated = true;
    let fitted = false;
    for (const field of truncatableFields(event)) {
      const originalValue = field.value;
      field.replace(field.minimumValue);
      if (serializedBytes(event) > SESSION_RECORD_EVENT_MAX_BYTES) {
        continue;
      }

      let low = Buffer.byteLength(field.minimumValue, 'utf-8');
      let high = Buffer.byteLength(originalValue, 'utf-8');
      let bestValue = field.minimumValue;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = utf8Prefix(originalValue, middle);
        field.replace(candidate);
        if (serializedBytes(event) <= SESSION_RECORD_EVENT_MAX_BYTES) {
          bestValue = candidate;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      field.replace(bestValue);
      fitted = true;
      break;
    }
    serialized = JSON.stringify(event);
    if (!fitted || Buffer.byteLength(serialized, 'utf-8') > SESSION_RECORD_EVENT_MAX_BYTES) {
      throw safeSessionRecordError('会话记录事件结构超过大小限制。');
    }
  }

  const line = `${serialized}\n`;
  return {
    event,
    eventKey: `${event.source}:${event.eventId}`,
    line,
    lineBytes: Buffer.byteLength(line, 'utf-8'),
  };
}

export function parseSessionRecordJsonl(
  buffer: Buffer,
  sessionId: string,
  normalizeEvent: (value: unknown) => SessionRecordEventDto,
): ParsedSessionRecordEvents {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: SerializedSessionRecordEvent[] = [];
  const seenKeys = new Set<string>();
  let nativeSource: NativeRecordSource | undefined;
  let offset = 0;
  let middleCorruption = false;
  let needsRewrite = false;

  while (offset < buffer.length) {
    const newlineOffset = buffer.indexOf(0x0a, offset);
    if (newlineOffset === -1) {
      if (buffer.length - offset > SESSION_RECORD_EVENT_MAX_BYTES) {
        middleCorruption = true;
      }
      break;
    }
    if (newlineOffset - offset > SESSION_RECORD_EVENT_MAX_BYTES) {
      middleCorruption = true;
      break;
    }
    const nextOffset = newlineOffset + 1;
    try {
      const originalLine = decoder.decode(buffer.subarray(offset, newlineOffset));
      const event = normalizeEvent(JSON.parse(originalLine));
      if (event.sessionId !== sessionId) {
        throw safeSessionRecordError('会话记录事件与文件不匹配。');
      }
      if (event.source !== 'agentdock') {
        if (nativeSource !== undefined && nativeSource !== event.source) {
          throw safeSessionRecordError('会话记录事件来源冲突。');
        }
        nativeSource = event.source;
      }
      const serializedEvent = serializeSessionRecordEvent(event, false);
      if (`${originalLine}\n` !== serializedEvent.line) {
        needsRewrite = true;
      }
      if (seenKeys.has(serializedEvent.eventKey)) {
        needsRewrite = true;
      } else {
        seenKeys.add(serializedEvent.eventKey);
        entries.push(serializedEvent);
      }
      offset = nextOffset;
    } catch {
      middleCorruption = true;
      break;
    }
  }

  return {
    entries,
    validByteSize: offset,
    tailIncomplete: !middleCorruption && offset < buffer.length,
    middleCorruption,
    needsRewrite,
  };
}

export function nativeSourceFromEntries(
  entries: readonly SerializedSessionRecordEvent[],
): NativeRecordSource | undefined {
  for (const { event } of entries) {
    if (event.source !== 'agentdock') {
      return event.source;
    }
  }
  return undefined;
}

export function retainLatestSessionRecordEvents(
  entries: readonly SerializedSessionRecordEvent[],
): { entries: SerializedSessionRecordEvent[]; byteSize: number; dropped: boolean } {
  const retained: SerializedSessionRecordEvent[] = [];
  let byteSize = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      retained.length >= SESSION_RECORD_MAX_EVENTS
      || byteSize + entry.lineBytes > SESSION_RECORD_FILE_MAX_BYTES
    ) {
      break;
    }
    retained.push(entry);
    byteSize += entry.lineBytes;
  }
  retained.reverse();
  return { entries: retained, byteSize, dropped: retained.length !== entries.length };
}

export function sameEventKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
