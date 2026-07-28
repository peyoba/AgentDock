import type { AgentSession } from '../shared/agentdockTypes.js';
import { readableSessionHistory } from '../shared/terminalText.js';
import { redactSummarySecrets } from './sessionSummaryStore.js';

export type ContextRestorePromptInput = {
  session: AgentSession;
  summaryMarkdown?: string;
  transcriptTail: string;
};

export function buildContextRestorePrompt({
  session,
  summaryMarkdown,
  transcriptTail,
}: ContextRestorePromptInput): string {
  const safeSummary = summaryMarkdown?.trim()
    ? redactSummarySecrets(readableSessionHistory(summaryMarkdown.trim()).trim())
    : 'No AgentDock summary is available. Use the recent transcript tail below as fallback context.';
  // See restoreContextStore.normalizeReadableText: raw PTY tails are mostly
  // redraw noise, so collapse them before they reach the prompt.
  const safeTranscriptTail = redactSummarySecrets(
    readableSessionHistory(transcriptTail).trim(),
  );

  return [
    'Continue this AgentDock session using the restored context below.',
    '',
    'Session metadata:',
    `- Session ID: ${session.id}`,
    `- Profile ID: ${session.profileId}`,
    `- Workspace ID: ${session.workspaceId}`,
    `- Command: ${session.command}`,
    `- Status: ${session.status}`,
    `- Started at: ${session.startedAt}`,
    session.exitedAt ? `- Exited at: ${session.exitedAt}` : undefined,
    '',
    'AgentDock summary:',
    safeSummary,
    '',
    'Recent transcript tail:',
    safeTranscriptTail || '(empty)',
  ].filter((line): line is string => line !== undefined).join('\n');
}
