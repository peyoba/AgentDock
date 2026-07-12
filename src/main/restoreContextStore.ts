import path from 'node:path';
import type { AgentSession, MemoryRestoreState } from '../shared/agentdockTypes.js';
import { terminalOutputToPlainText } from '../shared/terminalText.js';
import {
  ensurePrivateDirectory,
  writePrivateFileAtomically,
} from './privateFileSystem.js';
import { redactCommandSecrets, redactSecrets } from './secretRedaction.js';

export type RestoreContextInput = {
  workspacePath: string;
  session: AgentSession;
  summaryMarkdown?: string;
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
const MAX_SUMMARY_SENTENCE_CHARS = 160;
const RESTORED_BACKGROUND_SUMMARY = '记忆已恢复：已加载最近会话背景，等待你的下一步指令。';

function safeRestoreFileName(sessionId: string): string {
  return `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.md`;
}

function normalizeReadableText(value: string | undefined): string {
  return redactSecrets(terminalOutputToPlainText(value ?? '').trim())
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

function isIgnoredMemoryLine(line: string): boolean {
  return (
    /^agentdock session summary$/i.test(line) ||
    /^\[AgentDock\]/.test(line) ||
    /^(current goal|instructions|discoveries|accomplished|next steps|relevant files)$/i.test(line) ||
    hasSecretAssignment(line) ||
    line === '[REDACTED]'
  );
}

function firstReadableLines(value: string, limit: number): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .filter((line) => !isIgnoredMemoryLine(line))
    .slice(0, limit);
}

function compactSentencePart(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[。；;,.，]+$/g, '')
    .slice(0, MAX_SUMMARY_SENTENCE_CHARS)
    .trim();
}

export function summarizeRestoreMemory({
  summaryMarkdown,
  transcriptTail,
}: {
  summaryMarkdown?: string;
  transcriptTail: string;
}): string {
  const summaryText = normalizeReadableText(summaryMarkdown);
  const transcriptText = normalizeReadableText(transcriptTail);
  const parts = firstReadableLines(summaryText, 2)
    .map(compactSentencePart)
    .filter(Boolean);

  if (parts.length > 0) {
    return `记忆已恢复：${parts.join('；')}。`;
  }

  if (transcriptText) {
    return RESTORED_BACKGROUND_SUMMARY;
  }

  return '未找到可恢复记忆';
}

export function buildRestoreInstruction(contextFile: string): string {
  return [
    'Read the AgentDock restore context file and use it as background memory.',
    "Reply with one short memory-restored sentence, then wait for the user's next instruction.",
    'Do not continue previous tasks unless the user explicitly asks.',
    contextFile,
  ].join(' ') + '\r';
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
      transcriptTail,
    }: RestoreContextInput): Promise<RestoreContextResult> {
      const safeSummary = normalizeReadableText(summaryMarkdown);
      const safeTranscriptTail = normalizeReadableText(transcriptTail);
      const safeCommand = sanitizeRestoreCommand(session.command);
      const summary = summarizeRestoreMemory({
        summaryMarkdown: safeSummary,
        transcriptTail: safeTranscriptTail,
      });

      if (!safeSummary && !safeTranscriptTail) {
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
        '## Recent Transcript Tail',
        safeTranscriptTail || 'No recent transcript tail is available for this session.',
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
        instruction: buildRestoreInstruction(contextFile),
      };
    },
  };
}
