import path from 'node:path';
import type { Workspace } from '../../shared/agentdockTypes.js';
import { migrateWorkspace, addVersionToWorkspace } from './configMigration.js';
import { createJsonStore } from './jsonStore.js';

export function createWorkspaceStore(rootDir: string) {
  const store = createJsonStore<Workspace>(path.join(rootDir, 'workspaces.json'));

  return {
    async list(): Promise<Workspace[]> {
      // 从存储读取工作区并自动应用迁移
      const stored = await store.list();
      return stored.map((item) => migrateWorkspace(item));
    },
    save(workspace: Workspace): Promise<void> {
      // 保存时添加版本号
      const versionedWorkspace = addVersionToWorkspace({
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
      });
      return store.save(versionedWorkspace as Workspace);
    },
  };
}
