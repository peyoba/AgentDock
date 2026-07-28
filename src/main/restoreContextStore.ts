import path from 'node:path';
import type { AgentSession, MemoryRestoreState } from '../shared/agentdockTypes.js';
import { readableSessionHistory } from '../shared/terminalText.js';
import {
  ensurePrivateDirectory,
  writePrivateFileAtomically,
} from './privateFileSystem.js';
import { redactCommandSecrets, redactSecrets } from './secretRedaction.js';

export type RestoreContextInput = {
  workspacePath: string;
  session: AgentSession;
  summaryMarkdown?: string;
  clearRecordText?: string;
  transcriptTail: string;
};

export type RestoreContextResult = MemoryRestoreState & {
  instruction?: string;
};

export type RestoreContextStore = {
  writeRestoreContext(input: RestoreContextInput): Promise<RestoreContextResult>;
  restoreContextPath(workspacePath: string, sessionId: string): string;
};

const RESTORE_DIR_PARTS = ['.agentdock', 'context', 'restores'];
const MAX_CONTEXT_TRANSCRIPT_CHARS = 20_000;
const MAX_EMBEDDED_MEMORY_CHARS = 8_000;
const RESTORED_SUMMARY = '记忆已恢复';

function safeRestoreFileName(sessionId: string): string {
  return `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.md`;
}

// Raw PTY buffers are dominated by TUI redraw frames: blank rows, box-drawing
// borders and repeated status bars. Collapsing them here (before boundedTail)
// keeps the character budget spent on real conversation instead of whitespace.
function normalizeReadableText(value: string | undefined): string {
  return redactSecrets(readableSessionHistory(value ?? '').trim())
    .split('\n')
    .filter((line) => !hasSecretAssignment(line))
    .join('\n')
    .trim();
}

function hasSecretAssignment(line: string): boolean {
  return /\b[A-Z_]*(?:API_KEY|AUTH_TOKEN|TOKEN|SECRET)\b\s*=/.test(line);
}

function sanitizeRestoreCommand(command: string): string {
  return redactCommandSecrets(command).trim();
}

function boundedTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `[Earlier transcript omitted]\n${value.slice(-maxChars)}`;
}

function boundedMemory(value: string): string {
  if (value.length <= MAX_EMBEDDED_MEMORY_CHARS) {
    return value;
  }
  const retainedSideLength = Math.floor(MAX_EMBEDDED_MEMORY_CHARS / 2);
  return [
    value.slice(0, retainedSideLength),
    '[Middle of restored memory omitted]',
    value.slice(-retainedSideLength),
  ].join('\n');
}

export function summarizeRestoreMemory({
  summaryMarkdown,
  clearRecordText,
  transcriptTail,
}: {
  summaryMarkdown?: string;
  clearRecordText?: string;
  transcriptTail: string;
}): string {
  const summaryText = normalizeReadableText(summaryMarkdown);
  const clearRecord = normalizeReadableText(clearRecordText);
  const transcriptText = normalizeReadableText(transcriptTail);
  return summaryText || clearRecord || transcriptText
    ? RESTORED_SUMMARY
    : '未找到可恢复记忆';
}

export function buildRestoreInstruction(contextFile: string, restoredMemory: string): string {
  const embeddedMemory = boundedMemory(restoredMemory);
  return [
    'Use the AgentDock restored memory below as background memory.',
    'The restored memory is embedded below. Do not claim that you cannot access the file.',
    "Reply with one short memory-restored sentence, then wait for the user's next instruction.",
    'Do not continue previous tasks unless the user explicitly asks.',
    `Source file: ${contextFile}`,
    '',
    '<agentdock-restored-memory>',
    embeddedMemory,
    '</agentdock-restored-memory>',
  ].join('\n') + '\r';
}

export function createRestoreContextStore(): RestoreContextStore {
  function restoreContextPath(workspacePath: string, sessionId: string): string {
    return path.join(workspacePath, ...RESTORE_DIR_PARTS, safeRestoreFileName(sessionId));
  }

  return {
    restoreContextPath,

    async writeRestoreContext({
      workspacePath,
      session,
      summaryMarkdown,
      clearRecordText,
      transcriptTail,
    }: RestoreContextInput): Promise<RestoreContextResult> {
      const safeSummary = normalizeReadableText(summaryMarkdown);
      const safeClearRecord = normalizeReadableText(clearRecordText);
      const safeTranscriptTail = normalizeReadableText(transcriptTail);
      const contextClearRecord = boundedTail(
        safeClearRecord,
        MAX_CONTEXT_TRANSCRIPT_CHARS,
      );
      const contextTranscriptTail = boundedTail(
        safeTranscriptTail,
        MAX_CONTEXT_TRANSCRIPT_CHARS,
      );
      const safeCommand = sanitizeRestoreCommand(session.command);
      const summary = summarizeRestoreMemory({
        summaryMarkdown: safeSummary,
        clearRecordText: safeClearRecord,
        transcriptTail: safeTranscriptTail,
      });

      if (!safeSummary && !safeClearRecord && !safeTranscriptTail) {
        return { status: 'empty', summary };
      }

      const contextFile = restoreContextPath(workspacePath, session.id);
      const content = [
        '# AgentDock Restore Context',
        '',
        '## Session',
        `- Session ID: ${session.id}`,
        `- Profile ID: ${session.profileId}`,
        `- Workspace ID: ${session.workspaceId}`,
        `- Command: ${safeCommand}`,
        `- Previous Status: ${session.status}`,
        '',
        '## One Sentence Summary',
        summary,
        '',
        '## Long-Term Summary',
        safeSummary || 'No long-term summary is available for this session.',
        '',
        ...(contextClearRecord
          ? [
              '## Trusted Session Record',
              contextClearRecord,
            ]
          : [
              '## Recent Transcript Tail',
              contextTranscriptTail || 'No recent transcript tail is available for this session.',
            ]),
        '',
        '## Restore Behavior',
        "Reply with one short memory-restored sentence, then wait for the user's next instruction.",
        'Do not continue previous tasks unless the user explicitly asks.',
        '',
      ].join('\n');

      const agentDockDirectory = path.join(workspacePath, '.agentdock');
      const contextDirectory = path.join(agentDockDirectory, 'context');
      await ensurePrivateDirectory(agentDockDirectory);
      await ensurePrivateDirectory(contextDirectory);
      await ensurePrivateDirectory(path.dirname(contextFile));
      await writePrivateFileAtomically(contextFile, content);

      return {
        status: 'loaded',
        summary,
        contextFile,
        instruction: buildRestoreInstruction(
          contextFile,
          [
            safeSummary ? `## Long-Term Summary\n${safeSummary}` : '',
            contextClearRecord
              ? `## Trusted Session Record\n${contextClearRecord}`
              : contextTranscriptTail
                ? `## Recent Transcript Tail\n${contextTranscriptTail}`
                : '',
          ].filter(Boolean).join('\n\n'),
        ),
      };
    },
  };
}
