import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CONTEXT_DIR_PARTS = ['.agentdock', 'context'];
const SUMMARY_DIR_PARTS = [...CONTEXT_DIR_PARTS, 'summaries'];
const HANDOFF_DIR_PARTS = [...CONTEXT_DIR_PARTS, 'handoffs'];
const DEFAULT_SUMMARY_LIMIT_BYTES = 80_000;

const REQUIRED_SUMMARY_HEADINGS = [
  'Current Goal',
  'Decisions',
  'Files And Areas Touched',
  'Commands And Verification',
  'Problems And Risks',
  'Next Steps',
  'Source',
];

export type SummaryValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export type SessionSummaryWriteRequest = {
  workspacePath: string;
  sessionId: string;
  summaryMarkdown: string;
  handoffMarkdown: string;
};

export type SessionSummaryWriteResult = {
  summaryFile: string;
  handoffFile: string;
};

export type SessionSummaryReadRequest = {
  workspacePath: string;
  sessionId: string;
};

export type SessionSummaryReadResult = {
  summaryFile: string;
  handoffFile: string;
  summaryMarkdown: string;
  handoffMarkdown: string;
};

export type SessionSummaryStore = {
  writeSummary(request: SessionSummaryWriteRequest): Promise<SessionSummaryWriteResult>;
  readLatestSummary(request: SessionSummaryReadRequest): Promise<SessionSummaryReadResult | undefined>;
  summaryPath(workspacePath: string, sessionId: string): string;
  handoffPath(workspacePath: string, sessionId: string): string;
};

export function redactSummarySecrets(value: string): string {
  return value
    .replace(/local-development-secret/g, '[REDACTED]')
    .replace(/sk-ant-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/\b(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY)=\S*/g, '$1=[REDACTED]');
}

export function validateSummaryMarkdown(
  value: string,
  maxBytes = DEFAULT_SUMMARY_LIMIT_BYTES,
): SummaryValidationResult {
  if (Buffer.byteLength(value, 'utf-8') > maxBytes) {
    return { ok: false, reason: `摘要超过大小上限: ${maxBytes} bytes` };
  }

  for (const heading of REQUIRED_SUMMARY_HEADINGS) {
    if (!value.includes(`## ${heading}`)) {
      return { ok: false, reason: `摘要缺少必要标题: ${heading}` };
    }
  }

  if (redactSummarySecrets(value) !== value) {
    return { ok: false, reason: '摘要包含疑似 secret' };
  }

  return { ok: true };
}

export function createSessionSummaryStore(): SessionSummaryStore {
  function summaryPath(workspacePath: string, sessionId: string): string {
    return path.join(workspacePath, ...SUMMARY_DIR_PARTS, `${safeSessionFileName(sessionId)}.md`);
  }

  function handoffPath(workspacePath: string, sessionId: string): string {
    return path.join(workspacePath, ...HANDOFF_DIR_PARTS, `${safeSessionFileName(sessionId)}.md`);
  }

  return {
    summaryPath,
    handoffPath,

    async writeSummary({
      workspacePath,
      sessionId,
      summaryMarkdown,
      handoffMarkdown,
    }: SessionSummaryWriteRequest): Promise<SessionSummaryWriteResult> {
      const summaryValidation = validateSummaryMarkdown(summaryMarkdown);
      if (!summaryValidation.ok) {
        throw new Error(summaryValidation.reason);
      }

      const handoffValidation = validateSummaryMarkdown(handoffMarkdown);
      if (!handoffValidation.ok) {
        throw new Error(handoffValidation.reason);
      }

      const summaryFile = summaryPath(workspacePath, sessionId);
      const handoffFile = handoffPath(workspacePath, sessionId);
      await mkdir(path.dirname(summaryFile), { recursive: true });
      await mkdir(path.dirname(handoffFile), { recursive: true });
      await writeFile(summaryFile, ensureTrailingNewline(summaryMarkdown), 'utf-8');
      await writeFile(handoffFile, ensureTrailingNewline(handoffMarkdown), 'utf-8');
      return { summaryFile, handoffFile };
    },

    async readLatestSummary({
      workspacePath,
      sessionId,
    }: SessionSummaryReadRequest): Promise<SessionSummaryReadResult | undefined> {
      const summaryFile = summaryPath(workspacePath, sessionId);
      const handoffFile = handoffPath(workspacePath, sessionId);
      try {
        const [summaryMarkdown, handoffMarkdown] = await Promise.all([
          readFile(summaryFile, 'utf-8'),
          readFile(handoffFile, 'utf-8'),
        ]);
        return { summaryFile, handoffFile, summaryMarkdown, handoffMarkdown };
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    },
  };
}

function safeSessionFileName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
