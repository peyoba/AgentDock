import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  formatSessionRecordMarkdown,
  formatSessionRecordPlainText,
  sessionRecordEventLabel,
  sessionRecordSyncStatusLabel,
} from '../../src/shared/sessionRecordFormatting';
import type {
  SessionRecordEventDto,
  SessionRecordSnapshot,
  SessionRecordSyncStatus,
} from '../../src/shared/agentdockTypes';

type KeysOfUnion<T> = T extends unknown ? keyof T : never;

const occurredAt = '2026-07-25T08:00:00.000Z';
const statuses: Array<[SessionRecordSyncStatus, string]> = [
  ['pending', '待同步'],
  ['syncing', '正在同步'],
  ['ready', '已就绪'],
  ['partial', '部分可用'],
  ['stale', '可能滞后'],
  ['failed', '同步失败'],
  ['unavailable', '暂不可用'],
];

function snapshotWith(events: SessionRecordEventDto[]): SessionRecordSnapshot {
  return {
    sessionId: 'session-1',
    status: 'ready',
    source: 'codex',
    eventCount: events.length,
    truncated: false,
    hasMore: false,
    lastSyncedAt: occurredAt,
    events,
  };
}

function nativeFields(eventId: string, sequence: number, at = occurredAt) {
  return {
    eventId,
    sessionId: 'session-1',
    runId: 'run-1',
    sequence,
    occurredAt: at,
    timeSource: 'native' as const,
    source: 'codex' as const,
    trust: 'native' as const,
    truncated: false,
  };
}

function userEvent(
  eventId: string,
  text: string,
  overrides: Partial<Extract<SessionRecordEventDto, { kind: 'user_message' }>> = {},
): Extract<SessionRecordEventDto, { kind: 'user_message' }> {
  return { ...nativeFields(eventId, 1), kind: 'user_message', payload: { text }, ...overrides };
}

describe('session record formatting', () => {
  it('formats every supported event from clear record DTO fields', () => {
    const snapshot = snapshotWith([
      userEvent('user-1', '检查构建', { occurredAt: '2026-07-25T07:59:00.000Z' }),
      {
        ...nativeFields('tool-1', 2, '2026-07-25T07:59:10.000Z'),
        kind: 'tool_call',
        payload: { toolName: 'exec_command', argumentsSummary: 'npm run build' },
      },
      {
        ...nativeFields('result-1', 3, '2026-07-25T07:59:20.000Z'),
        kind: 'tool_result',
        payload: { outcome: 'success', text: 'build passed' },
      },
      {
        ...nativeFields('assistant-1', 4),
        kind: 'assistant_message',
        payload: { text: '构建已通过' },
      },
      {
        ...nativeFields('status-1', 5, '2026-07-25T08:00:10.000Z'),
        kind: 'status',
        source: 'agentdock',
        trust: 'derived-status',
        timeSource: 'read',
        payload: { code: 'waiting', text: '等待你的下一步指令' },
      },
    ]);

    const plainText = formatSessionRecordPlainText(snapshot);
    const markdown = formatSessionRecordMarkdown(snapshot);
    expect(plainText).toContain('用户：检查构建');
    expect(plainText).toContain('工具调用：exec_command · npm run build');
    expect(plainText).toContain('工具结果：成功 · build passed');
    expect(plainText).toContain('Agent 回复：构建已通过');
    expect(plainText).toContain('状态：等待输入 · 等待你的下一步指令');
    expect(markdown).toContain('## 用户');
    expect(markdown).toContain('## Agent 回复');
    expect(markdown).toContain('**状态：** 已就绪');
  });

  it('maps every synchronization state and event kind to fixed Chinese labels', () => {
    for (const [status, label] of statuses) {
      expect(sessionRecordSyncStatusLabel(status)).toBe(label);
      expect(formatSessionRecordPlainText({ ...snapshotWith([]), status })).toContain(`状态：${label}`);
      expect(formatSessionRecordMarkdown({ ...snapshotWith([]), status })).toContain(`**状态：** ${label}`);
    }
    expect(sessionRecordEventLabel('user_message')).toBe('用户');
    expect(sessionRecordEventLabel('assistant_message')).toBe('Agent 回复');
    expect(sessionRecordEventLabel('tool_call')).toBe('工具调用');
    expect(sessionRecordEventLabel('tool_result')).toBe('工具结果');
    expect(sessionRecordEventLabel('status')).toBe('状态');
  });

  it('sorts multiple events by occurredAt without mutating the DTO', () => {
    const later = userEvent('later', '较晚消息', { occurredAt: '2026-07-25T08:02:00.000Z' });
    const earlier = userEvent('earlier', '较早消息', { occurredAt: '2026-07-25T08:01:00.000Z' });
    const snapshot = snapshotWith([later, earlier]);
    const plainText = formatSessionRecordPlainText(snapshot);
    expect(plainText.indexOf('较早消息')).toBeLessThan(plainText.indexOf('较晚消息'));
    expect(snapshot.events.map((event) => event.eventId)).toEqual(['later', 'earlier']);
  });

  it('uses sequence and then input order when timestamps are equal', () => {
    const snapshot = snapshotWith([
      userEvent('sequence-2', '序号二', { sequence: 2 }),
      userEvent('sequence-1-a', '序号一甲', { sequence: 1 }),
      userEvent('sequence-1-b', '序号一乙', { sequence: 1 }),
      userEvent('no-sequence', '无序号', { sequence: undefined }),
    ]);
    const plainText = formatSessionRecordPlainText(snapshot);
    expect(plainText.indexOf('序号一甲')).toBeLessThan(plainText.indexOf('序号一乙'));
    expect(plainText.indexOf('序号一乙')).toBeLessThan(plainText.indexOf('序号二'));
    expect(plainText.indexOf('序号二')).toBeLessThan(plainText.indexOf('无序号'));
  });

  it('marks read-derived timestamps so they never impersonate native times', () => {
    const snapshot = snapshotWith([
      userEvent('native-time', '原生时间消息', { occurredAt: '2026-07-25T08:01:00.000Z' }),
      userEvent('read-time', '读取时间消息', {
        occurredAt: '2026-07-25T08:02:00.000Z',
        timeSource: 'read',
        sequence: 2,
      }),
    ]);
    const plainText = formatSessionRecordPlainText(snapshot);
    const markdown = formatSessionRecordMarkdown(snapshot);
    // SPEC §6.2：读取时间必须带来源标记，原生时间不带。
    expect(plainText).toContain('[2026-07-25T08:02:00.000Z · 读取时间] 用户：读取时间消息');
    expect(plainText).toContain('[2026-07-25T08:01:00.000Z] 用户：原生时间消息');
    expect(plainText).not.toContain('2026-07-25T08:01:00.000Z · 读取时间');
    expect(markdown).toContain('**时间来源：** 读取时间');
    expect(markdown.match(/\*\*时间来源：\*\*/g)).toHaveLength(1);
  });

  it('renders empty events and preserves special multiline content', () => {
    expect(formatSessionRecordPlainText(snapshotWith([]))).toContain('暂无清晰记录事件。');
    expect(formatSessionRecordMarkdown(snapshotWith([]))).toContain('> 暂无清晰记录事件。');
    const content = ['第一行 *星号*', '# 不是标题', '路径样例 C:\\work\\file', '```代码围栏```'].join('\n');
    const snapshot = snapshotWith([userEvent('special', content)]);
    const markdown = formatSessionRecordMarkdown(snapshot);
    expect(formatSessionRecordPlainText(snapshot)).toContain(content);
    expect(markdown).toContain('    第一行 *星号*');
    expect(markdown).toContain('    # 不是标题');
    expect(markdown).toContain('    ```代码围栏```');
    expect(markdown.match(/^## 用户$/gm)).toHaveLength(1);
  });

  it('omits the detail separator when an optional detail is empty', () => {
    const event: SessionRecordEventDto = {
      ...nativeFields('empty-detail', 1),
      kind: 'tool_call',
      payload: { toolName: 'exec_command', argumentsSummary: '' },
    };
    const output = formatSessionRecordPlainText(snapshotWith([event]));
    expect(output).toContain('工具调用：exec_command');
    expect(output).not.toContain('exec_command · ');
  });

  it('does not emit sensitive internal fields that are outside the shared DTO', () => {
    const sentinels = [
      '/private/native/session.jsonl',
      'PRIVATE_CURSOR_INTERNAL_ONLY',
      'RAW_PAYLOAD_INTERNAL_ONLY',
      'SENSITIVE_ENV_VALUE_INTERNAL_ONLY',
      'RECOVERY_MATERIAL_INTERNAL_ONLY',
    ];
    const event = {
      ...userEvent('safe-event', '允许公开的合成消息'),
      sourcePath: sentinels[0],
      rawPayload: sentinels[2],
      secret: sentinels[3],
    } as SessionRecordEventDto;
    const snapshot = {
      ...snapshotWith([event]),
      cursor: sentinels[1],
      env: { OPENAI_API_KEY: sentinels[3] },
      recoveryMaterial: sentinels[4],
    } as SessionRecordSnapshot;
    const output = [formatSessionRecordPlainText(snapshot), formatSessionRecordMarkdown(snapshot)].join('\n');
    expect(output).toContain('允许公开的合成消息');
    for (const sentinel of sentinels) {
      expect(output).not.toContain(sentinel);
    }
    type ForbiddenKey = 'sourcePath' | 'filePath' | 'cursor' | 'rawPayload' | 'env' | 'secret' | 'recoveryMaterial';
    expectTypeOf<Extract<keyof SessionRecordSnapshot, ForbiddenKey>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<KeysOfUnion<SessionRecordEventDto>, ForbiddenKey>>().toEqualTypeOf<never>();
  });

  it('restricts role events to native trust and status events to derived status', () => {
    expectTypeOf<Extract<SessionRecordEventDto, { kind: 'user_message' }>['trust']>().toEqualTypeOf<'native'>();
    expectTypeOf<Extract<SessionRecordEventDto, { kind: 'assistant_message' }>['trust']>().toEqualTypeOf<'native'>();
    expectTypeOf<Extract<SessionRecordEventDto, { kind: 'tool_call' }>['trust']>().toEqualTypeOf<'native'>();
    expectTypeOf<Extract<SessionRecordEventDto, { kind: 'tool_result' }>['trust']>().toEqualTypeOf<'native'>();
    expectTypeOf<Extract<SessionRecordEventDto, { kind: 'status' }>['trust']>().toEqualTypeOf<'derived-status'>();
    expectTypeOf<Extract<SessionRecordEventDto, { kind: 'status' }>['source']>().toEqualTypeOf<'agentdock'>();
  });
});
