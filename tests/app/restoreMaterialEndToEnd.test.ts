import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionRecordSyncService } from '../../src/main/sessionRecordSyncService.js';
import { createClaudeRecordSource } from '../../src/main/recordSources/claudeRecordSource.js';
import { createSessionRecordEventStore } from '../../src/main/stores/sessionRecordEventStore.js';
import { createRestoreContextStore } from '../../src/main/restoreContextStore.js';
import type { RecordSourceBinding } from '../../src/main/recordSources/types.js';
import type { AgentSession } from '../../src/shared/agentdockTypes.js';

// 这是堵住根因的端到端护栏：过去 buildRestoreMaterial 在真实 app 里恒返回 undefined，
// 恢复永远走 PTY 屏幕重绘兜底，产出的是被覆写的半行碎片。此处用真实同步服务 +
// 真实 claude adapter + 真实事件 store + 真实 restore store 跑通整条链路，证明原生
// JSONL 记录能产出结构化、可读的恢复文本（clear-record 命中），且无记录时正确回退。

let tempDir: string;

const session: AgentSession = {
  id: 'session-w1-99',
  title: 'Claude · AgentDock',
  profileId: 'claude-a',
  workspaceId: 'workspace-a',
  command: 'claude --dangerously-skip-permissions',
  status: 'interrupted',
  startedAt: '2026-07-27T08:00:00.000Z',
};

function jsonl(lines: unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

function claudeBinding(recordHome: string, workspacePath: string): RecordSourceBinding {
  return {
    sessionId: session.id,
    runId: 'run-e2e-1',
    source: 'claude',
    nativeSessionId: 'native-e2e',
    workspacePath,
    recordHome,
    startedAt: session.startedAt,
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentdock-restore-e2e-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('restore material end-to-end wiring', () => {
  it('turns a native Claude JSONL record into readable structured restore text', async () => {
    const recordHome = path.join(tempDir, '.claude');
    const workspacePath = path.join(tempDir, 'workspace');
    await mkdir(workspacePath, { recursive: true });
    const transcriptPath = path.join(recordHome, 'projects', 'synthetic', 'native-e2e.jsonl');
    await mkdir(path.dirname(transcriptPath), { recursive: true });
    await writeFile(
      transcriptPath,
      jsonl([
        {
          type: 'user',
          sessionId: 'native-e2e',
          uuid: 'evt-user-1',
          timestamp: '2026-07-27T08:00:01Z',
          cwd: workspacePath,
          message: { role: 'user', content: '请修复恢复链路的接线问题。' },
        },
        {
          type: 'assistant',
          sessionId: 'native-e2e',
          uuid: 'evt-assistant-1',
          timestamp: '2026-07-27T08:00:02Z',
          cwd: workspacePath,
          message: { role: 'assistant', content: [{ type: 'text', text: '已定位根因并完成接线。' }] },
        },
      ]),
      'utf8',
    );

    const store = createSessionRecordEventStore(tempDir);
    const service = createSessionRecordSyncService({
      store,
      adapters: [createClaudeRecordSource({ approvedRoots: [recordHome] })],
      retryDelaysMs: [],
    });

    await service.bind(claudeBinding(recordHome, workspacePath));
    await service.syncNow(session.id, 'launch');

    const clearRecordText = await service.buildRestoreMaterial(session.id);
    // clear-record 命中：不再是 undefined，且包含真实完整对话。
    expect(clearRecordText).toBeDefined();
    expect(clearRecordText).toContain('请修复恢复链路的接线问题。');
    expect(clearRecordText).toContain('已定位根因并完成接线。');
    expect(clearRecordText).toContain('用户');
    expect(clearRecordText).toContain('Agent');

    // 写进真实 restore store：走 Trusted Session Record 分支，非 PTY 兜底。
    const restoreStore = createRestoreContextStore();
    const result = await restoreStore.writeRestoreContext({
      workspacePath,
      session,
      clearRecordText,
      transcriptTail: 'PTY-FALLBACK-MUST-NOT-APPEAR',
    });
    expect(result.status).toBe('loaded');
    const content = await readFile(result.contextFile as string, 'utf-8');
    expect(content).toContain('## Trusted Session Record');
    expect(content).toContain('请修复恢复链路的接线问题。');
    expect(content).toContain('已定位根因并完成接线。');
    expect(content).not.toContain('PTY-FALLBACK-MUST-NOT-APPEAR');
    await service.dispose();
  });

  it('returns undefined so the PTY fallback engages when no native record exists', async () => {
    const recordHome = path.join(tempDir, '.claude');
    const workspacePath = path.join(tempDir, 'workspace');
    await mkdir(path.join(recordHome, 'projects'), { recursive: true });
    await mkdir(workspacePath, { recursive: true });

    const store = createSessionRecordEventStore(tempDir);
    const service = createSessionRecordSyncService({
      store,
      adapters: [createClaudeRecordSource({ approvedRoots: [recordHome] })],
      retryDelaysMs: [],
    });

    await service.bind(claudeBinding(recordHome, workspacePath));
    await service.syncNow(session.id, 'launch');

    const clearRecordText = await service.buildRestoreMaterial(session.id);
    expect(clearRecordText).toBeUndefined();
    await service.dispose();
  });
});
