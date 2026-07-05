import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSessionSummaryStore } from '../../src/main/sessionSummaryStore';
import { createSummaryJobService } from '../../src/main/summaryJobService';
import type { AgentSession, Workspace } from '../../src/shared/agentdockTypes';

const session: AgentSession = {
  id: 'session-1',
  title: 'Claude A · AgentDock',
  profileId: 'profile-a',
  workspaceId: 'workspace-a',
  command: 'claude --dangerously-skip-permissions',
  status: 'running',
  startedAt: '2026-07-06T00:00:00.000Z',
};

async function testWorkspace(): Promise<Workspace> {
  return {
    id: 'workspace-a',
    name: 'AgentDock',
    path: await mkdtemp(path.join(os.tmpdir(), 'agentdock-summary-job-')),
  };
}

function validSummary(source = 'Transcript: .agentdock/context/sessions/session-1.md'): string {
  return [
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
    source,
    '',
  ].join('\n');
}

describe('summaryJobService', () => {
  it('redacts transcript input before calling the summary runner', async () => {
    const workspace = await testWorkspace();
    const openAiKey = `sk-${'1'.repeat(16)}`;
    let runnerInput = '';
    const service = createSummaryJobService({
      summaryStore: createSessionSummaryStore(),
      runSummary: async (input) => {
        runnerInput = input.redactedTranscriptTail;
        return validSummary();
      },
      readTranscript: async () => `OPENAI_API_KEY=${openAiKey}\nimportant output`,
      clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
    });

    await service.summarizeSession({ session, workspace, continueAfterSummary: false });

    expect(runnerInput).toBe('OPENAI_API_KEY=[REDACTED]\nimportant output');
  });

  it('writes valid summary and handoff files', async () => {
    const workspace = await testWorkspace();
    const service = createSummaryJobService({
      summaryStore: createSessionSummaryStore(),
      runSummary: async () => validSummary(),
      readTranscript: async () => 'important output',
      clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
    });

    const result = await service.summarizeSession({ session, workspace, continueAfterSummary: false });

    expect(result.status).toBe('success');
    expect(result.handoffPrompt).toContain(result.handoffFile);
    await expect(readFile(result.summaryFile, 'utf-8')).resolves.toContain('## Current Goal');
    await expect(readFile(result.handoffFile, 'utf-8')).resolves.toContain('## Next Steps');
  });

  it('does not write invalid summary output', async () => {
    const workspace = await testWorkspace();
    const service = createSummaryJobService({
      summaryStore: createSessionSummaryStore(),
      runSummary: async () => '# AgentDock Session Summary\n\n## Current Goal\nmissing sections',
      readTranscript: async () => 'important output',
      clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
    });

    await expect(
      service.summarizeSession({ session, workspace, continueAfterSummary: false }),
    ).rejects.toThrow('摘要缺少必要标题');

    await expect(readFile(
      path.join(workspace.path, '.agentdock/context/summaries/session-1.md'),
      'utf-8',
    )).rejects.toThrow();
  });

  it('launches continuation only after summary success', async () => {
    const workspace = await testWorkspace();
    const continuationSession: AgentSession = {
      ...session,
      id: 'session-2',
      startedAt: '2026-07-06T00:01:00.000Z',
    };
    const launchContinuation = vi.fn(async () => continuationSession);
    const service = createSummaryJobService({
      summaryStore: createSessionSummaryStore(),
      runSummary: async () => validSummary(),
      readTranscript: async () => 'important output',
      launchContinuation,
      clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
    });

    const result = await service.summarizeSession({ session, workspace, continueAfterSummary: true });

    expect(launchContinuation).toHaveBeenCalledWith({ sourceSession: session, handoffPrompt: result.handoffPrompt });
    expect(result.continuationSession).toEqual(continuationSession);
  });
});
