import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Identified = {
  id: string;
};

export type JsonStore<T extends Identified> = {
  list(): Promise<T[]>;
  save(item: T): Promise<void>;
  replaceAll(items: T[]): Promise<void>;
};

export function createJsonStore<T extends Identified>(filePath: string): JsonStore<T> {
  // 串行化写操作，避免并发 read-modify-write 互相覆盖（如多窗口同时保存配置）。
  let writeQueue: Promise<unknown> = Promise.resolve();

  function enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const run = writeQueue.then(operation, operation);
    writeQueue = run.catch(() => undefined);
    return run;
  }

  async function list(): Promise<T[]> {
    let text: string;
    try {
      text = await readFile(filePath, 'utf-8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error(`Expected array in ${filePath}`);
      }
      return parsed as T[];
    } catch (error) {
      // 文件损坏（如进程中断导致半写）时备份原文件并返回空列表，
      // 避免一个坏文件让应用永远无法启动；备份保留用户手工恢复的机会。
      const backupPath = path.join(
        path.dirname(filePath),
        `${path.basename(filePath, '.json')}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      );
      await rename(filePath, backupPath).catch(() => undefined);
      console.error(`[jsonStore] ${filePath} 损坏，已备份到 ${backupPath}`, error);
      return [];
    }
  }

  async function writeItems(items: T[]): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    // 先写临时文件再 rename，保证任意时刻磁盘上的文件都是完整 JSON。
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(items, null, 2)}\n`, 'utf-8');
    await rename(tempPath, filePath);
  }

  function save(item: T): Promise<void> {
    return enqueue(async () => {
      const items = await list();
      const existingIndex = items.findIndex((storedItem) => storedItem.id === item.id);

      if (existingIndex === -1) {
        items.push(item);
      } else {
        items[existingIndex] = item;
      }

      await writeItems(items);
    });
  }

  function replaceAll(items: T[]): Promise<void> {
    return enqueue(() => writeItems(items));
  }

  return {
    list,
    save,
    replaceAll,
  };
}
