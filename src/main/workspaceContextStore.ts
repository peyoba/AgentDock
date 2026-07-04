import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession, Workspace } from '../shared/agentdockTypes';

const RECENT_OUTPUT_LIMIT = 40_000;
const CONTEXT_DIR_PARTS = ['.agentdock', 'context'];
const TRANSCRIPT_DIR_PARTS = [...CONTEXT_DIR_PARTS, 'sessions'];

export type WorkspaceContextFiles = {
  contextDir: string;
  sharedContextFile: string;
  sessionTranscriptFile: string;
};

export type WorkspaceContextStore = {
  startSession(input: { workspace: Workspace; session: AgentSession }): Promise<WorkspaceContextFiles>;
  appendOutput(input: { workspace: Workspace; sessionId: string; data: string }): Promise<void>;
  readSharedContext(workspace: Workspace): Promise<{ filePath: string; content: string }>;
  ensureGitExcluded(workspace: Workspace): Promise<void>;
};

type Clock = {
  now(): Date;
};

type WorkspaceContextStoreOptions = {
  clock?: Clock;
};

type ContextIndexSession = {
  sessionId: string;
  title: string;
  profileId: string;
  workspaceId: string;
  command: string;
  startedAt: string;
  transcriptFile: string;
};

type ContextIndex = {
  version: 1;
  workspaceId: string;
  workspaceName: string;
  updatedAt: string;
  sessions: ContextIndexSession[];
};

export function createWorkspaceContextStore(
  options: WorkspaceContextStoreOptions = {},
): WorkspaceContextStore {
  const clock = options.clock ?? { now: () => new Date() };

  async function startSession(input: {
    workspace: Workspace;
    session: AgentSession;
  }): Promise<WorkspaceContextFiles> {
    const files = contextFiles(input.workspace, input.session.id);
    await mkdir(path.join(input.workspace.path, ...TRANSCRIPT_DIR_PARTS), { recursive: true });
    await ensureGitExcluded(input.workspace);

    const index = await readIndex(input.workspace, clock.now().toISOString());
    const nextSession = indexSession(input.session);
    const sessions = [
      ...index.sessions.filter((session) => session.sessionId !== input.session.id),
      nextSession,
    ];
    await writeIndex(input.workspace, {
      ...index,
      workspaceId: input.workspace.id,
      workspaceName: input.workspace.name,
      updatedAt: clock.now().toISOString(),
      sessions,
    });

    await writeFile(files.sessionTranscriptFile, transcriptHeader(input.session), 'utf-8');
    await rebuildSharedContext(input.workspace);
    return files;
  }

  async function appendOutput(input: {
    workspace: Workspace;
    sessionId: string;
    data: string;
  }): Promise<void> {
    const files = contextFiles(input.workspace, input.sessionId);
    await mkdir(path.dirname(files.sessionTranscriptFile), { recursive: true });
    await appendFile(files.sessionTranscriptFile, redactSecrets(input.data), 'utf-8');
    await updateIndexTimestamp(input.workspace, clock.now().toISOString());
    await rebuildSharedContext(input.workspace);
  }

  async function readSharedContext(workspace: Workspace): Promise<{ filePath: string; content: string }> {
    const sharedContextFile = path.join(workspace.path, ...CONTEXT_DIR_PARTS, 'shared-context.md');
    return {
      filePath: sharedContextFile,
      content: await readFile(sharedContextFile, 'utf-8'),
    };
  }

  async function ensureGitExcluded(workspace: Workspace): Promise<void> {
    const excludePath = path.join(workspace.path, '.git', 'info', 'exclude');
    let excludeContent: string;
    try {
      excludeContent = await readFile(excludePath, 'utf-8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const lines = excludeContent.split('\n');
    if (lines.includes('.agentdock/')) {
      return;
    }
    const separator = excludeContent.endsWith('\n') || excludeContent.length === 0 ? '' : '\n';
    await writeFile(excludePath, `${excludeContent}${separator}.agentdock/\n`, 'utf-8');
  }

  async function rebuildSharedContext(workspace: Workspace): Promise<void> {
    const index = await readIndex(workspace, clock.now().toISOString());
    const sharedContextFile = path.join(workspace.path, ...CONTEXT_DIR_PARTS, 'shared-context.md');
    await mkdir(path.dirname(sharedContextFile), { recursive: true });
    await writeFile(sharedContextFile, await sharedContextMarkdown(workspace, index), 'utf-8');
  }

  async function sharedContextMarkdown(workspace: Workspace, index: ContextIndex): Promise<string> {
    const sessionLines = index.sessions.map(
      (session) => `- ${session.sessionId}: ${session.title} (\`${session.transcriptFile}\`)`,
    );
    const recentOutput = await Promise.all(
      index.sessions.map(async (session) => {
        const transcriptPath = path.join(workspace.path, session.transcriptFile);
        let transcript = '';
        try {
          transcript = await readFile(transcriptPath, 'utf-8');
        } catch (error) {
          if (!(isNodeError(error) && error.code === 'ENOENT')) {
            throw error;
          }
        }
        return [
          `### ${session.sessionId}`,
          '```text',
          redactSecrets(transcript).slice(-RECENT_OUTPUT_LIMIT),
          '```',
        ].join('\n');
      }),
    );

    return [
      '# AgentDock Shared Context',
      '',
      `Workspace: ${workspace.name}`,
      `Updated: ${index.updatedAt}`,
      '',
      '## How To Use',
      'Read this file before continuing work in AgentDock sessions for this workspace.',
      '',
      '## Sessions',
      ...(sessionLines.length > 0 ? sessionLines : ['No sessions recorded yet.']),
      '',
      '## Recent Output',
      '',
      ...recentOutput,
      '',
    ].join('\n');
  }

  async function updateIndexTimestamp(workspace: Workspace, updatedAt: string): Promise<void> {
    const index = await readIndex(workspace, updatedAt);
    await writeIndex(workspace, { ...index, updatedAt });
  }

  return {
    startSession,
    appendOutput,
    readSharedContext,
    ensureGitExcluded,
  };
}

function contextFiles(workspace: Workspace, sessionId: string): WorkspaceContextFiles {
  const contextDir = path.join(workspace.path, ...CONTEXT_DIR_PARTS);
  return {
    contextDir,
    sharedContextFile: path.join(contextDir, 'shared-context.md'),
    sessionTranscriptFile: path.join(workspace.path, ...TRANSCRIPT_DIR_PARTS, `${sessionId}.md`),
  };
}

async function readIndex(workspace: Workspace, updatedAt: string): Promise<ContextIndex> {
  const indexPath = path.join(workspace.path, ...CONTEXT_DIR_PARTS, 'index.json');
  try {
    return JSON.parse(await readFile(indexPath, 'utf-8')) as ContextIndex;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {
        version: 1,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        updatedAt,
        sessions: [],
      };
    }
    throw error;
  }
}

async function writeIndex(workspace: Workspace, index: ContextIndex): Promise<void> {
  const indexPath = path.join(workspace.path, ...CONTEXT_DIR_PARTS, 'index.json');
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf-8');
}

function indexSession(session: AgentSession): ContextIndexSession {
  return {
    sessionId: session.id,
    title: session.title,
    profileId: session.profileId,
    workspaceId: session.workspaceId,
    command: session.command,
    startedAt: session.startedAt,
    transcriptFile: `.agentdock/context/sessions/${session.id}.md`,
  };
}

function transcriptHeader(session: AgentSession): string {
  return [
    '# AgentDock Session Transcript',
    '',
    `Session: ${session.id}`,
    `Title: ${session.title}`,
    `Profile: ${session.profileId}`,
    `Workspace: ${session.workspaceId}`,
    `Command: ${session.command}`,
    `Started: ${session.startedAt}`,
    '',
    '## Output',
    '',
  ].join('\n');
}

function redactSecrets(value: string): string {
  return value
    .replace(/local-development-secret/g, '[REDACTED]')
    .replace(/sk-ant-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
    .replace(/\b(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY)=\S*/g, '$1=[REDACTED]');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
