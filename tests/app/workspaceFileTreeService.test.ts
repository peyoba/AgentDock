import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkspaceFileTreeService } from '../../src/main/workspaceFileTreeService';

describe('workspaceFileTreeService', () => {
  it('rejects paths outside the workspace root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-tree-'));
    const workspacePath = path.join(root, 'workspace');
    await mkdir(workspacePath);
    const service = createWorkspaceFileTreeService();

    await expect(service.listDirectory({ workspacePath, relativePath: '../' }))
      .rejects.toThrow('文件路径超出工作区');
  });

  it('lists files without returning file contents', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-tree-'));
    const workspacePath = path.join(root, 'workspace');
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, 'App.tsx'), 'secret source text', 'utf-8');
    const service = createWorkspaceFileTreeService();

    const result = await service.listDirectory({ workspacePath, relativePath: '.' });

    expect(result.entries).toEqual([
      expect.objectContaining({ name: 'App.tsx', type: 'file' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('secret source text');
  });

  it('marks git status and session-touched files separately', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agentdock-tree-'));
    const workspacePath = path.join(root, 'workspace');
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, 'App.tsx'), 'source text', 'utf-8');
    const service = createWorkspaceFileTreeService({
      readGitStatus: async () => new Map([['App.tsx', 'M']]),
    });

    const result = await service.listDirectory({
      workspacePath,
      relativePath: '.',
      touchedFiles: new Set(['App.tsx']),
    });

    expect(result.entries).toEqual([
      expect.objectContaining({
        name: 'App.tsx',
        gitStatus: 'M',
        touchedInSession: true,
      }),
    ]);
  });
});
