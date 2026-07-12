import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession, Workspace } from '../shared/agentdockTypes.js';
import {
  appendPrivateFile,
  ensurePrivateDirectory,
  ensurePrivateFile,
  writePrivateFileAtomically,
} from './privateFileSystem.js';
import { redactSecrets } from './secretRedaction.js';

const RECENT_OUTPUT_LIMIT = 40_000;
// index 与 transcript 文件都需要上限，否则长期使用后 .agentdock/ 膨胀数 GB
// 且每次重建都要全量读入内存。
const MAX_INDEX_SESSIONS = 20;
const MAX_SESSION_TRANSCRIPT_BYTES = 2_000_000;
const SESSION_TRANSCRIPT_KEEP_BYTES = 1_000_000;
const CONTEXT_DIR_PARTS = ['.agentdock', 'context'];
const TRANSCRIPT_DIR_PARTS = [...CONTEXT_DIR_PARTS, 'sessions'];
const SUMMARY_DIR_PARTS = [...CONTEXT_DIR_PARTS, 'summaries'];
const DEFAULT_REBUILD_THROTTLE_MS = 500;

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
  flush?(): Promise<void>;
};

type Clock = {
  now(): Date;
};

type WorkspaceContextStoreOptions = {
  clock?: Clock;
  rebuildThrottleMs?: number;
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

type RebuildThrottleState = {
  workspace: Workspace;
  cooldownTimer: ReturnType<typeof setTimeout>;
  dirty: boolean;
};

export function createWorkspaceContextStore(
  options: WorkspaceContextStoreOptions = {},
): WorkspaceContextStore {
  const clock = options.clock ?? { now: () => new Date() };
  const rebuildThrottleMs = options.rebuildThrottleMs ?? DEFAULT_REBUILD_THROTTLE_MS;
  // 每个 workspace 一条串行写队列：transcript 追加、index 和 shared-context 写入
  // 互不交错，避免高频输出下并发写同一文件
  const workspaceQueues = new Map<string, Promise<unknown>>();
  const throttleStates = new Map<string, RebuildThrottleState>();

  function enqueue<T>(workspacePath: string, task: () => Promise<T>): Promise<T> {
    const tail = workspaceQueues.get(workspacePath) ?? Promise.resolve();
    const run = tail.then(task, task);
    workspaceQueues.set(
      workspacePath,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  function startCooldown(workspace: Workspace): void {
    const cooldownTimer = setTimeout(() => {
      onCooldownElapsed(workspace.path);
    }, rebuildThrottleMs);
    (cooldownTimer as { unref?: () => void }).unref?.();
    throttleStates.set(workspace.path, { workspace, cooldownTimer, dirty: false });
  }

  function onCooldownElapsed(workspacePath: string): void {
    const state = throttleStates.get(workspacePath);
    if (!state) {
      return;
    }

    throttleStates.delete(workspacePath);
    if (state.dirty) {
      startCooldown(state.workspace);
      void enqueue(workspacePath, () => rebuildSharedContext(state.workspace)).catch(
        () => undefined,
      );
    }
  }

  // 首个输出立即重建（leading），冷却窗口内的后续输出合并为一次尾部重建（trailing），
  // 把重建频率限制在每窗口至多两次，而不是每个 PTY chunk 一次
  function requestSharedContextRebuild(workspace: Workspace): Promise<void> {
    const state = throttleStates.get(workspace.path);
    if (state) {
      state.dirty = true;
      return Promise.resolve();
    }

    startCooldown(workspace);
    return enqueue(workspace.path, () => rebuildSharedContext(workspace));
  }

  async function startSession(input: {
    workspace: Workspace;
    session: AgentSession;
  }): Promise<WorkspaceContextFiles> {
    const files = contextFiles(input.workspace, input.session.id);
    await enqueue(input.workspace.path, async () => {
      await ensureWorkspaceContextDirectories(input.workspace.path);
      await ensurePrivateDirectory(path.join(input.workspace.path, ...TRANSCRIPT_DIR_PARTS));
      await ensureGitExcluded(input.workspace);

      const index = await readIndex(input.workspace, clock.now().toISOString());
      const nextSession = indexSession(input.session);
      const sessions = [
        ...index.sessions.filter((session) => session.sessionId !== input.session.id),
        nextSession,
      ];
      // 超出上限时淘汰最旧的会话，并删除其 transcript / summary 文件。
      const evicted = sessions.length > MAX_INDEX_SESSIONS
        ? sessions.splice(0, sessions.length - MAX_INDEX_SESSIONS)
        : [];
      for (const evictedSession of evicted) {
        await rm(path.join(input.workspace.path, evictedSession.transcriptFile), { force: true })
          .catch(() => undefined);
        await rm(
          path.join(
            input.workspace.path,
            ...SUMMARY_DIR_PARTS,
            `${safeContextFileName(evictedSession.sessionId)}.md`,
          ),
          { force: true },
        ).catch(() => undefined);
      }
      await writeIndex(input.workspace, {
        ...index,
        workspaceId: input.workspace.id,
        workspaceName: input.workspace.name,
        updatedAt: clock.now().toISOString(),
        sessions,
      });

      await writePrivateFileAtomically(
        files.sessionTranscriptFile,
        transcriptHeader(input.session),
      );
      await rebuildSharedContext(input.workspace);
    });
    return files;
  }

  async function appendOutput(input: {
    workspace: Workspace;
    sessionId: string;
    data: string;
  }): Promise<void> {
    const files = contextFiles(input.workspace, input.sessionId);
    await enqueue(input.workspace.path, async () => {
      await ensureWorkspaceContextDirectories(input.workspace.path);
      await ensurePrivateDirectory(path.dirname(files.sessionTranscriptFile));
      await appendPrivateFile(files.sessionTranscriptFile, redactSecrets(input.data));
      const fileStat = await stat(files.sessionTranscriptFile);
      if (fileStat.size > MAX_SESSION_TRANSCRIPT_BYTES) {
        await rollFileToTail(files.sessionTranscriptFile, SESSION_TRANSCRIPT_KEEP_BYTES);
      }
    });
    await requestSharedContextRebuild(input.workspace);
  }

  async function readSharedContext(workspace: Workspace): Promise<{ filePath: string; content: string }> {
    const sharedContextFile = path.join(workspace.path, ...CONTEXT_DIR_PARTS, 'shared-context.md');
    await ensureWorkspaceContextDirectories(workspace.path);
    await ensurePrivateFile(sharedContextFile);
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
        // 仅在确认是 git 仓库时补建 info/exclude；非 git 工作区跳过
        if (!(await isGitWorkspace(workspace))) {
          return;
        }
        await mkdir(path.dirname(excludePath), { recursive: true });
        await writeFile(excludePath, '.agentdock/\n', 'utf-8');
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

  // 把 index 时间戳更新并入重建：读一次 index，写回 updatedAt，再产出 shared-context
  async function rebuildSharedContext(workspace: Workspace): Promise<void> {
    const updatedAt = clock.now().toISOString();
    const index: ContextIndex = { ...(await readIndex(workspace, updatedAt)), updatedAt };
    await writeIndex(workspace, index);

    const sharedContextFile = path.join(workspace.path, ...CONTEXT_DIR_PARTS, 'shared-context.md');
    await ensureWorkspaceContextDirectories(workspace.path);
    await writePrivateFileAtomically(
      sharedContextFile,
      await sharedContextMarkdown(workspace, index),
    );
  }

  async function sharedContextMarkdown(workspace: Workspace, index: ContextIndex): Promise<string> {
    const sessionLines = index.sessions.map(
      (session) => `- ${session.sessionId}: ${session.title} (\`${session.transcriptFile}\`)`,
    );
    const summaries = (
      await Promise.all(
        index.sessions.map(async (session) => {
          const summaryPath = path.join(
            workspace.path,
            ...SUMMARY_DIR_PARTS,
            `${safeContextFileName(session.sessionId)}.md`,
          );
          try {
            await ensurePrivateFile(summaryPath);
            return {
              sessionId: session.sessionId,
              content: await readFile(summaryPath, 'utf-8'),
            };
          } catch (error) {
            if (isNodeError(error) && error.code === 'ENOENT') {
              return undefined;
            }
            throw error;
          }
        }),
      )
    ).filter((summary): summary is { sessionId: string; content: string } => Boolean(summary));
    const summarizedSessionIds = new Set(summaries.map((summary) => summary.sessionId));
    const summaryOutput = summaries.map((summary) =>
      [
        `### ${summary.sessionId}`,
        redactSecrets(summary.content).trimEnd(),
      ].join('\n'),
    );
    const recentOutput = await Promise.all(
      index.sessions
        .filter((session) => !summarizedSessionIds.has(session.sessionId))
        .map(async (session) => {
          const transcriptPath = path.join(workspace.path, session.transcriptFile);
          let transcript = '';
          try {
            // 只读尾部，避免重建时把所有历史 transcript 全量读入内存。
            transcript = await readFileTail(transcriptPath, RECENT_OUTPUT_LIMIT * 4);
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
      ...(summaryOutput.length > 0
        ? [
            '## Session Summaries',
            '',
            ...summaryOutput,
            '',
          ]
        : []),
      '## Recent Output',
      '',
      ...recentOutput,
      '',
    ].join('\n');
  }

  async function flush(): Promise<void> {
    const states = [...throttleStates.values()];
    throttleStates.clear();
    for (const state of states) {
      clearTimeout(state.cooldownTimer);
    }

    await Promise.all(
      states
        .filter((state) => state.dirty)
        .map((state) =>
          enqueue(state.workspace.path, () => rebuildSharedContext(state.workspace)),
        ),
    );
    await Promise.all(
      [...workspaceQueues.values()].map((queueTail) => queueTail.catch(() => undefined)),
    );
  }

  return {
    startSession,
    appendOutput,
    readSharedContext,
    ensureGitExcluded,
    flush,
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

function safeContextFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function isGitWorkspace(workspace: Workspace): Promise<boolean> {
  try {
    await access(path.join(workspace.path, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function readIndex(workspace: Workspace, updatedAt: string): Promise<ContextIndex> {
  const indexPath = path.join(workspace.path, ...CONTEXT_DIR_PARTS, 'index.json');
  const emptyIndex: ContextIndex = {
    version: 1,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    updatedAt,
    sessions: [],
  };
  try {
    await ensureWorkspaceContextDirectories(workspace.path);
    await ensurePrivateFile(indexPath);
    return JSON.parse(await readFile(indexPath, 'utf-8')) as ContextIndex;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return emptyIndex;
    }
    if (error instanceof SyntaxError) {
      // index.json 损坏时备份并从空索引重建，避免共享上下文管线永久失效。
      await rename(indexPath, `${indexPath}.corrupt`).catch(() => undefined);
      return emptyIndex;
    }
    throw error;
  }
}

async function writeIndex(workspace: Workspace, index: ContextIndex): Promise<void> {
  const indexPath = path.join(workspace.path, ...CONTEXT_DIR_PARTS, 'index.json');
  await ensureWorkspaceContextDirectories(workspace.path);
  await writePrivateFileAtomically(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

async function ensureWorkspaceContextDirectories(workspacePath: string): Promise<void> {
  const agentDockDirectory = path.join(workspacePath, '.agentdock');
  const contextDirectory = path.join(agentDockDirectory, 'context');
  await ensurePrivateDirectory(agentDockDirectory);
  await ensurePrivateDirectory(contextDirectory);
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function utf8SafeStart(buffer: Buffer): Buffer {
  let start = 0;
  while (start < buffer.length && (buffer[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return buffer.subarray(start);
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string> {
  await ensurePrivateFile(filePath);
  const handle = await open(filePath, 'r');
  try {
    const fileStat = await handle.stat();
    const length = Math.min(fileStat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, fileStat.size - length);
    return utf8SafeStart(buffer).toString('utf-8');
  } finally {
    await handle.close();
  }
}

async function rollFileToTail(filePath: string, keepBytes: number): Promise<void> {
  const kept = await readFileTail(filePath, keepBytes);
  await writePrivateFileAtomically(filePath, kept);
}
