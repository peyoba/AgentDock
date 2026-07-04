import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Identified = {
  id: string;
};

export type JsonStore<T extends Identified> = {
  list(): Promise<T[]>;
  save(item: T): Promise<void>;
  replaceAll(items: T[]): Promise<void>;
};

export type JsonStoreWithMigration<T extends Identified> = JsonStore<T> & {
  /**
   * 应用迁移函数到所有已存储的数据
   * 当配置格式变化时调用此方法以升级用户数据
   */
  migrateAll(migrator: (data: unknown) => T): Promise<void>;
};

export function createJsonStore<T extends Identified>(filePath: string): JsonStoreWithMigration<T> {
  async function list(): Promise<T[]> {
    try {
      const text = await readFile(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(text);

      if (!Array.isArray(parsed)) {
        throw new Error(`Expected array in ${filePath}`);
      }

      return parsed as T[];
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async function writeItems(items: T[]): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf-8');
  }

  async function save(item: T): Promise<void> {
    const items = await list();
    const existingIndex = items.findIndex((storedItem) => storedItem.id === item.id);

    if (existingIndex === -1) {
      items.push(item);
    } else {
      items[existingIndex] = item;
    }

    await writeItems(items);
  }

  async function replaceAll(items: T[]): Promise<void> {
    await writeItems(items);
  }

  async function migrateAll(migrator: (data: unknown) => T): Promise<void> {
    const items = await list();
    const migratedItems = items.map((item) => migrator(item as unknown));
    await writeItems(migratedItems);
  }

  return {
    list,
    save,
    replaceAll,
    migrateAll,
  };
}
