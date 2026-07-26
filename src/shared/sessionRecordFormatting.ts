import type {
  SessionRecordEventDto,
  SessionRecordEventKind,
  SessionRecordSnapshot,
  SessionRecordSyncStatus,
} from './agentdockTypes';

const syncStatusLabels: Record<SessionRecordSyncStatus, string> = {
  pending: '待同步',
  syncing: '正在同步',
  ready: '已就绪',
  partial: '部分可用',
  stale: '可能滞后',
  failed: '同步失败',
  unavailable: '暂不可用',
};

const eventLabels: Record<SessionRecordEventKind, string> = {
  user_message: '用户',
  assistant_message: 'Agent 回复',
  tool_call: '工具调用',
  tool_result: '工具结果',
  status: '状态',
};

const sourceLabels: Record<NonNullable<SessionRecordSnapshot['source']>, string> = {
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
};

const toolResultOutcomeLabels: Record<
  Extract<SessionRecordEventDto, { kind: 'tool_result' }>['payload']['outcome'],
  string
> = { success: '成功', failure: '失败', partial: '部分完成' };

const statusCodeLabels: Record<
  Extract<SessionRecordEventDto, { kind: 'status' }>['payload']['code'],
  string
> = {
  started: '已启动',
  restored: '记忆已恢复',
  completed: '已完成',
  failed: '失败',
  waiting: '等待输入',
};

type HeaderField = { label: string; value: string; multiline?: boolean };

export function sessionRecordSyncStatusLabel(status: SessionRecordSyncStatus): string {
  return syncStatusLabels[status];
}

export function sessionRecordEventLabel(kind: SessionRecordEventKind): string {
  return eventLabels[kind];
}

function compareOccurredAt(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime - rightTime;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

function sortedEvents(events: readonly SessionRecordEventDto[]): SessionRecordEventDto[] {
  return events
    .map((event, inputIndex) => ({ event, inputIndex }))
    .sort((left, right) => {
      const timeDifference = compareOccurredAt(left.event.occurredAt, right.event.occurredAt);
      if (timeDifference !== 0) {
        return timeDifference;
      }
      const leftSequence = left.event.sequence ?? Number.POSITIVE_INFINITY;
      const rightSequence = right.event.sequence ?? Number.POSITIVE_INFINITY;
      return leftSequence === rightSequence
        ? left.inputIndex - right.inputIndex
        : leftSequence - rightSequence;
    })
    .map(({ event }) => event);
}

function withOptionalDetail(summary: string, detail: string | undefined): string {
  return detail === undefined || detail === '' ? summary : `${summary} · ${detail}`;
}

function eventBody(event: SessionRecordEventDto): string {
  switch (event.kind) {
    case 'user_message':
    case 'assistant_message':
      return event.payload.text;
    case 'tool_call':
      return withOptionalDetail(event.payload.toolName, event.payload.argumentsSummary);
    case 'tool_result':
      return withOptionalDetail(
        toolResultOutcomeLabels[event.payload.outcome],
        event.payload.text,
      );
    case 'status':
      return withOptionalDetail(statusCodeLabels[event.payload.code], event.payload.text);
  }
}

function snapshotHeaderFields(snapshot: SessionRecordSnapshot): HeaderField[] {
  const fields: HeaderField[] = [
    { label: '会话', value: snapshot.sessionId },
    { label: '状态', value: sessionRecordSyncStatusLabel(snapshot.status) },
    { label: '事件总数', value: String(snapshot.eventCount) },
  ];
  if (snapshot.source) {
    fields.push({ label: '来源', value: sourceLabels[snapshot.source] });
  }
  if (snapshot.lastSyncedAt) {
    fields.push({ label: '最后同步', value: snapshot.lastSyncedAt });
  }
  if (snapshot.message !== undefined) {
    fields.push({ label: '说明', value: snapshot.message, multiline: true });
  }
  if (snapshot.truncated) {
    fields.push({ label: '记录范围', value: '已截断' });
  }
  if (snapshot.hasMore) {
    fields.push({ label: '更早记录', value: '仍有未加载内容' });
  }
  return fields;
}

function plainEventLine(event: SessionRecordEventDto): string {
  // SPEC §6.2：无法确认原生时间时使用读取时间，并且必须标记时间来源，
  // 否则导出记录会把读取时间伪装成原生事件时间。
  const timestamp = event.timeSource === 'read'
    ? `${event.occurredAt} · 读取时间`
    : event.occurredAt;
  const line = `[${timestamp}] ${sessionRecordEventLabel(event.kind)}：${eventBody(event)}`;
  return event.truncated ? `${line}\n（内容已截断）` : line;
}

export function formatSessionRecordPlainText(snapshot: SessionRecordSnapshot): string {
  const header = ['清晰记录', ...snapshotHeaderFields(snapshot).map(({ label, value }) => `${label}：${value}`)];
  const events = sortedEvents(snapshot.events);
  const body = events.length
    ? events.map((event) => plainEventLine(event)).join('\n\n')
    : '暂无清晰记录事件。';
  return `${header.join('\n')}\n\n${body}`;
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/([\\`*_[\]{}<>()#+\-.!|])/g, '\\$1');
}

function markdownTextBlock(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function markdownEventSection(event: SessionRecordEventDto): string {
  const lines = [
    `## ${sessionRecordEventLabel(event.kind)}`,
    '',
    `**时间：** ${escapeMarkdownInline(event.occurredAt)}`,
  ];
  if (event.timeSource === 'read') {
    // SPEC §6.2：读取时间必须与原生时间戳可区分。
    lines.push('', '**时间来源：** 读取时间');
  }
  lines.push('', `**内容：**\n\n${markdownTextBlock(eventBody(event))}`);
  if (event.truncated) {
    lines.push('', '**内容状态：** 已截断');
  }
  return lines.join('\n');
}

export function formatSessionRecordMarkdown(snapshot: SessionRecordSnapshot): string {
  const header = ['# 清晰记录'];
  for (const field of snapshotHeaderFields(snapshot)) {
    const value = field.multiline
      ? `\n\n${markdownTextBlock(field.value)}`
      : ` ${escapeMarkdownInline(field.value)}`;
    header.push('', `**${field.label}：**${value}`);
  }
  const events = sortedEvents(snapshot.events);
  const body = events.length
    ? events.map((event) => markdownEventSection(event)).join('\n\n')
    : '> 暂无清晰记录事件。';
  return `${header.join('\n')}\n\n${body}`;
}
