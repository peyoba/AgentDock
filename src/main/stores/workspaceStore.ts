import path from 'node:path';
import type { Workspace } from '../../shared/agentdockTypes.js';
import { createJsonStore } from './jsonStore.js';

export function createWorkspaceStore(rootDir: string) {
  return createJsonStore<Workspace>(path.join(rootDir, 'workspaces.json'));
}
