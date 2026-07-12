import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRestoreInstruction,
  createRestoreContextStore,
  summarizeRestoreMemory,
} from '../../src/main/restoreContextStore';
import { registerKnownSecret } from '../../src/main/secretRedaction';
import type { AgentSession } from '../../src/shared/agentdockTypes';

async function readPosixMode(targetPath: string): Promise<number> {
  return (await stat(targetPath)).mode & 0o777;
}

const session: AgentSession = {
  id: 'session-w1-12',
  title: 'Claude A · AgentDock',
  profileId: 'claude-anyrouter',
  workspaceId: 'workspace-agentdock',
  command: 'claude --dangerously-skip-permissions',
  status: 'interrupted',
  startedAt: '2026-07-06T14:28:10.006Z',
};

describe('restoreContextStore', () => {
  it('creates private restore paths and heals legacy permissions without changing contents', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-permissions-'));
    const workspacePath = path.join(tempDir, 'workspace');
    const store = createRestoreContextStore();

    try {
      const result = await store.writeRestoreContext({
        workspacePath,
        session,
        summaryMarkdown: '# AgentDock Session Summary\n\n## Current Goal\nVerify private restore storage.',
        transcriptTail: 'permission contract transcript tail',
      });
      const contextFilePath = result.contextFile as string;
      const privateDirectoryPaths = [
        path.join(workspacePath, '.agentdock'),
        path.join(workspacePath, '.agentdock/context'),
        path.join(workspacePath, '.agentdock/context/restores'),
      ];
      const newDirectoryModes = await Promise.all(privateDirectoryPaths.map(readPosixMode));
      const newFileMode = await readPosixMode(contextFilePath);
      const contentsBeforeHealing = await readFile(contextFilePath, 'utf-8');

      await Promise.all(privateDirectoryPaths.map((directoryPath) => chmod(directoryPath, 0o755)));
      await chmod(contextFilePath, 0o644);
      const rewrittenResult = await store.writeRestoreContext({
        workspacePath,
        session,
        summaryMarkdown: '# AgentDock Session Summary\n\n## Current Goal\nVerify private restore storage.',
        transcriptTail: 'permission contract transcript tail',
      });

      expect(rewrittenResult.contextFile).toBe(contextFilePath);
      expect({
        newDirectoryModes,
        newFileMode,
        healedDirectoryModes: await Promise.all(privateDirectoryPaths.map(readPosixMode)),
        healedFileMode: await readPosixMode(contextFilePath),
        contentsPreserved: (await readFile(contextFilePath, 'utf-8')) === contentsBeforeHealing,
      }).toEqual({
        newDirectoryModes: [0o700, 0o700, 0o700],
        newFileMode: 0o600,
        healedDirectoryModes: [0o700, 0o700, 0o700],
        healedFileMode: 0o600,
        contentsPreserved: true,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('writes a redacted restore context file and returns a short instruction', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-context-store-'));
    const workspacePath = path.join(tempDir, 'workspace');
    const fakeCommandKey = ['sk', 'test-command-redaction-token'].join('-');
    const fakeTranscriptKey = ['sk', 'test-transcript-redaction-token'].join('-');
    try {
      const store = createRestoreContextStore();
      const result = await store.writeRestoreContext({
        workspacePath,
        session: {
          ...session,
          command: `OPENAI_API_KEY=${fakeCommandKey} claude`,
        },
        summaryMarkdown: '# AgentDock Session Summary\n\n## Current Goal\n修复 AgentDock 会话恢复。',
        transcriptTail: `OPENAI_API_KEY=${fakeTranscriptKey}\n用户确认采用分层记忆恢复。`,
      });

      expect(result.status).toBe('loaded');
      expect(result.summary).toBe('记忆已恢复：修复 AgentDock 会话恢复。');
      expect(result.contextFile).toBe(path.join(workspacePath, '.agentdock/context/restores/session-w1-12.md'));
      expect(result.instruction).toBe(
        [
          'Read the AgentDock restore context file and use it as background memory.',
          "Reply with one short memory-restored sentence, then wait for the user's next instruction.",
          'Do not continue previous tasks unless the user explicitly asks.',
          result.contextFile,
        ].join(' ') + '\r',
      );

      const content = await readFile(result.contextFile as string, 'utf-8');
      expect(content).toContain('修复 AgentDock 会话恢复');
      expect(content).toContain('## Long-Term Summary');
      expect(content).toContain('## Recent Transcript Tail');
      expect(content).toContain('用户确认采用分层记忆恢复');
      expect(content).toContain("wait for the user's next instruction");
      expect(content).not.toContain(fakeTranscriptKey);
      expect(content).not.toContain(fakeCommandKey);
      expect(content).toContain('[REDACTED]');
      expect(result.instruction).not.toContain('用户确认采用分层记忆恢复');
      expect(result.instruction).not.toContain('OPENAI_API_KEY');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('redacts registered provider secrets with arbitrary formats', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-known-secret-'));
    const providerSecret = 'provider.private/credential:Zx91-restore';
    registerKnownSecret(providerSecret);

    try {
      const store = createRestoreContextStore();
      const result = await store.writeRestoreContext({
        workspacePath: tempDir,
        session,
        transcriptTail: `Authentication succeeded with token ${providerSecret}`,
      });

      const content = await readFile(result.contextFile as string, 'utf-8');
      expect(content).not.toContain(providerSecret);
      expect(content).toContain('[REDACTED]');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns empty when no summary or transcript exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-empty-'));
    try {
      const store = createRestoreContextStore();
      const result = await store.writeRestoreContext({
        workspacePath: tempDir,
        session,
        transcriptTail: '',
      });

      expect(result).toEqual({
        status: 'empty',
        summary: '未找到可恢复记忆',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('builds one-sentence summaries deterministically', () => {
    expect(summarizeRestoreMemory({
      summaryMarkdown: '# AgentDock Session Summary\n\n## Current Goal\n整理分层记忆恢复设计。\n\n## Next Steps\n实现短指令注入。',
      transcriptTail: '用户要求摘要只用一句话。',
    })).toBe('记忆已恢复：整理分层记忆恢复设计；实现短指令注入。');
  });

  it('uses a generic short restore summary when only transcript tail exists', () => {
    expect(summarizeRestoreMemory({
      transcriptTail: [
        '⚠ `--dangerously-bypass-hook-trust` is enabled.',
        'diff --git a/tests/app/TerminalPane.test.tsx b/tests/app/TerminalPane.test.tsx',
        '用户刚刚说明恢复内容太长。',
      ].join('\n'),
    })).toBe('记忆已恢复：已加载最近会话背景，等待你的下一步指令。');
  });

  it('keeps restore instruction short and path-only', () => {
    expect(buildRestoreInstruction('/tmp/agentdock restore/context.md')).toBe(
      [
        'Read the AgentDock restore context file and use it as background memory.',
        "Reply with one short memory-restored sentence, then wait for the user's next instruction.",
        'Do not continue previous tasks unless the user explicitly asks.',
        '/tmp/agentdock restore/context.md',
      ].join(' ') + '\r',
    );
  });
});
