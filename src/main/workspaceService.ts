import crypto from 'node:crypto';
import path from 'node:path';
import type { Workspace } from '../shared/agentdockTypes.js';

function normalizeWorkspacePath(workspacePath: string): string {
  return path.resolve(workspacePath);
}

function workspaceNameFromPath(workspacePath: string): string {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  return path.basename(normalizedPath) || normalizedPath;
}

export function createWorkspaceFromPath(workspacePath: string): Workspace {
  const normalizedPath = normalizeWorkspacePath(workspacePath);
  const hash = crypto.createHash('sha1').update(normalizedPath).digest('hex').slice(0, 10);

  return {
    id: `workspace-${hash}`,
    name: workspaceNameFromPath(normalizedPath),
    path: normalizedPath,
  };
}

export function mergeWorkspaces(defaultWorkspaces: Workspace[], storedWorkspaces: Workspace[]): Workspace[] {
  const workspacesByPath = new Map<string, Workspace>();

  for (const workspace of defaultWorkspaces) {
    workspacesByPath.set(normalizeWorkspacePath(workspace.path), {
      ...workspace,
      path: normalizeWorkspacePath(workspace.path),
    });
  }

  for (const workspace of storedWorkspaces) {
    workspacesByPath.set(normalizeWorkspacePath(workspace.path), {
      ...workspace,
      path: normalizeWorkspacePath(workspace.path),
    });
  }

  return [...workspacesByPath.values()];
}
