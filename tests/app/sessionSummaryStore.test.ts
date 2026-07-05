import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSessionSummaryStore,
  redactSummarySecrets,
  validateSummaryMarkdown,
} from '../../src/main/sessionSummaryStore';

const validSummary = [
  '# AgentDock Session Summary',
  '',
  '## Current Goal',
  'Ship context summary.',
  '',
  '## Decisions',
  '- Keep manual first.',
  '',
  '## Files And Areas Touched',
  '- src/main/sessionService.ts',
  '',
  '## Commands And Verification',
  '- npm run typecheck',
  '',
  '## Problems And Risks',
  '- Verify real CLI.',
  '',
  '## Next Steps',
  '- Continue implementation.',
  '',
  '## Source',
  'Transcript: .agentdock/context/sessions/session-1.md',
  '',
].join('\n');

describe('sessionSummaryStore', () => {
  it('redacts API keys and env assignments before summary input is sent', () => {
    const openAiKey = `sk-${'1'.repeat(16)}`;
    const anthropicKey = `sk-ant-${'1'.repeat(16)}`;

    expect(redactSummarySecrets(`OPENAI_API_KEY=${openAiKey} token ${anthropicKey}`)).toBe(
      'OPENAI_API_KEY=[REDACTED] token [REDACTED]',
    );
  });

  it('validates required summary markdown headings', () => {
    expect(validateSummaryMarkdown(validSummary)).toEqual({ ok: true });
    expect(validateSummaryMarkdown('# AgentDock Session Summary\n\n## Current Goal\n')).toEqual({
      ok: false,
      reason: '摘要缺少必要标题: Decisions',
    });
  });

  it('writes summary and handoff files under workspace context paths', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'agentdock-summary-'));
    const store = createSessionSummaryStore();

    const result = await store.writeSummary({
      workspacePath,
      sessionId: 'session-1',
      summaryMarkdown: validSummary,
      handoffMarkdown: validSummary,
    });

    expect(result.summaryFile).toBe(path.join(workspacePath, '.agentdock/context/summaries/session-1.md'));
    expect(result.handoffFile).toBe(path.join(workspacePath, '.agentdock/context/handoffs/session-1.md'));
    await expect(readFile(result.summaryFile, 'utf-8')).resolves.toContain('## Current Goal');
  });
});
