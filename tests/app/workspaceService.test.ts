import { describe, expect, it } from 'vitest';
import { createWorkspaceFromPath, mergeWorkspaces } from '../../src/main/workspaceService';

describe('workspaceService', () => {
  it('creates a stable workspace record from a chosen local path using the folder name', () => {
    const workspace = createWorkspaceFromPath('/Users/example/projects/Docs');
    const sameWorkspace = createWorkspaceFromPath('/Users/example/projects/Docs');

    expect(workspace).toEqual({
      id: sameWorkspace.id,
      name: 'Docs',
      path: '/Users/example/projects/Docs',
    });
    expect(workspace.id).toMatch(/^workspace-/);
  });

  it('merges saved workspaces with defaults without duplicating the same path', () => {
    const merged = mergeWorkspaces(
      [{ id: 'agentdock', name: 'AgentDock', path: '/Users/example/AgentDock' }],
      [
        { id: 'workspace-docs', name: 'Docs', path: '/Users/example/Docs' },
        { id: 'agentdock-copy', name: 'AgentDock Saved', path: '/Users/example/AgentDock' },
      ],
    );

    expect(merged).toEqual([
      { id: 'agentdock-copy', name: 'AgentDock Saved', path: '/Users/example/AgentDock' },
      { id: 'workspace-docs', name: 'Docs', path: '/Users/example/Docs' },
    ]);
  });
});
