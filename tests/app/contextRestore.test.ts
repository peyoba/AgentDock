import { describe, expect, it } from 'vitest';
import { buildContextRestorePrompt } from '../../src/main/contextRestore';
import type { AgentSession } from '../../src/shared/agentdockTypes';

const session: AgentSession = {
  id: 'session-1',
  title: 'Claude A · AgentDock',
  profileId: 'profile-a',
  workspaceId: 'workspace-a',
  command: 'claude',
  status: 'interrupted',
  startedAt: '2026-07-06T00:00:00.000Z',
};

describe('contextRestore', () => {
  it('builds a redacted restore prompt from summary and transcript tail', () => {
    const fakeOpenAiKey = ['sk', 'test-restore-redaction-token'].join('-');
    const prompt = buildContextRestorePrompt({
      session,
      summaryMarkdown: [
        '# AgentDock Session Summary',
        '',
        '## Current Goal',
        'Continue transcript migration.',
      ].join('\n'),
      transcriptTail: `OPENAI_API_KEY=${fakeOpenAiKey}\nrecent command output`,
    });

    expect(prompt).toContain('Continue transcript migration.');
    expect(prompt).toContain('recent command output');
    expect(prompt).toContain('profile-a');
    expect(prompt).not.toContain(fakeOpenAiKey);
    expect(prompt).toContain('[REDACTED]');
  });

  it('uses a transcript-tail fallback when no summary exists', () => {
    const prompt = buildContextRestorePrompt({
      session,
      transcriptTail: 'latest user decision: remove the 5MB warning',
    });

    expect(prompt).toContain('No AgentDock summary is available');
    expect(prompt).toContain('latest user decision: remove the 5MB warning');
  });

  it('turns raw TUI redraw output into readable context before injection', () => {
    const prompt = buildContextRestorePrompt({
      session,
      transcriptTail: [
        '\u001b[?1049h\u001b[?1006h\u001b[2J\u001b[H',
        'Working(9s • esc to interrupt)\r\u001b[2K',
        '\u001b[38;5;244m> 你好\u001b[0m\r\n',
        '\u001b[39m\u001b[49m用户确认：重启前的最近对话必须带给新 Agent。\u001b[0m',
      ].join(''),
    });

    expect(prompt).toContain('用户确认：重启前的最近对话必须带给新 Agent。');
    expect(prompt).toContain('> 你好');
    expect(prompt).not.toContain('\u001b');
    expect(prompt).not.toContain('[38;5;244m');
    expect(prompt).not.toContain('Working(9s');
  });
});
