import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSessionSummaryStore,
  redactSummarySecrets,
  validateSummaryMarkdown,
} from '../../src/main/sessionSummaryStore';

async function readPosixMode(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

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
  it('creates private summary and handoff paths and heals legacy permissions without content changes', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'agentdock-summary-permissions-'));
    const store = createSessionSummaryStore();

    try {
      const result = await store.writeSummary({
        workspacePath,
        sessionId: 'session-permissions',
        summaryMarkdown: validSummary,
        handoffMarkdown: validSummary,
      });
      const privateDirectoryPaths = [
        path.join(workspacePath, '.agentdock'),
        path.join(workspacePath, '.agentdock/context'),
        path.join(workspacePath, '.agentdock/context/summaries'),
        path.join(workspacePath, '.agentdock/context/handoffs'),
      ];
      const privateFilePaths = [result.summaryFile, result.handoffFile];
      const newDirectoryModes = await Promise.all(privateDirectoryPaths.map(readPosixMode));
      const newFileModes = await Promise.all(privateFilePaths.map(readPosixMode));
      const contentsBeforeHealing = await Promise.all(
        privateFilePaths.map((filePath) => readFile(filePath, 'utf-8')),
      );

      await Promise.all(privateDirectoryPaths.map((directoryPath) => chmod(directoryPath, 0o755)));
      await Promise.all(privateFilePaths.map((filePath) => chmod(filePath, 0o644)));
      await store.writeSummary({
        workspacePath,
        sessionId: 'session-permissions',
        summaryMarkdown: validSummary,
        handoffMarkdown: validSummary,
      });

      expect({
        newDirectoryModes,
        newFileModes,
        healedDirectoryModes: await Promise.all(privateDirectoryPaths.map(readPosixMode)),
        healedFileModes: await Promise.all(privateFilePaths.map(readPosixMode)),
        contentsPreserved:
          JSON.stringify(await Promise.all(privateFilePaths.map((filePath) => readFile(filePath, 'utf-8')))) ===
          JSON.stringify(contentsBeforeHealing),
      }).toEqual({
        newDirectoryModes: [0o700, 0o700, 0o700, 0o700],
        newFileModes: [0o600, 0o600],
        healedDirectoryModes: [0o700, 0o700, 0o700, 0o700],
        healedFileModes: [0o600, 0o600],
        contentsPreserved: true,
      });
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

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
