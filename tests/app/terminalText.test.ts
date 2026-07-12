import { describe, expect, it } from 'vitest';
import { readableSessionHistory } from '../../src/shared/terminalText';

describe('readableSessionHistory', () => {
  it('removes CLI startup and AgentDock restore noise while preserving the conversation', () => {
    const terminalHistory = [
      '\u001b[33m⚠ `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.\u001b[0m',
      '┌────────────────────────────────────────────────────────────┐',
      '>_ OpenAI Codex (v0.144.1)',
      'model:       doubao-seed-evolving-latest-version   /model to change',
      'directory:   ~/Desktop/web/AgentDock',
      'permissions: YOLO mode',
      '└────────────────────────────────────────────────────────────┘',
      '',
      'Tip: Our most capable model yet. GPT-5.6 Sol can tackle complex code changes, dig into research, produce',
      'polished documents, and take on your most ambitious work.',
      '',
      '› Read the AgentDock restore context file and use it as background memory. Reply with one short memory-restored',
      "sentence, then wait for the user's next instruction. Do not continue previous tasks unless the user explicitly",
      'asks. /Users/example/AgentDock/.agentdock/context/restores/session-w1-22.md',
      '',
      '⚠ Model metadata for `doubao-seed-evolving-latest-version` not found. Defaulting to fallback metadata; this can',
      '  degrade performance and cause issues.',
      '',
      '• Explored',
      '  └ Read session-w1-22.md',
      '',
      '› 请继续完成历史记录清理。',
      '',
      '我会保留用户和 Agent 的实际交流内容。',
      '',
      '```ts',
      'const retainedValue = 78;',
      '```',
      '[AgentDock] 进程已退出（exit code 0），会话已结束，可关闭此标签页。',
      '(B',
    ].join('\n');

    const readableHistory = readableSessionHistory(terminalHistory);

    expect(readableHistory).toContain('› 请继续完成历史记录清理。');
    expect(readableHistory).toContain('我会保留用户和 Agent 的实际交流内容。');
    expect(readableHistory).toContain('const retainedValue = 78;');
    expect(readableHistory).not.toContain('OpenAI Codex');
    expect(readableHistory).not.toContain('dangerously-bypass-hook-trust');
    expect(readableHistory).not.toContain('AgentDock restore context file');
    expect(readableHistory).not.toContain('fallback metadata');
    expect(readableHistory).not.toContain('Read session-w1-22.md');
    expect(readableHistory).not.toContain('[AgentDock] 进程已退出');
    expect(readableHistory).not.toContain('(B');
  });

  it('keeps ordinary warnings, tool summaries, numbers, and conversation text', () => {
    const terminalHistory = [
      '› 为什么结果是 78？',
      '结果是 78，因为输入包含 6 × 13。',
      'Warning: 这是项目自身需要保留的业务警告。',
      '• Explored src/main/sessionService.ts',
    ].join('\n');

    expect(readableSessionHistory(terminalHistory)).toBe(terminalHistory);
  });
});
