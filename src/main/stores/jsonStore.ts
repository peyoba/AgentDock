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

export function createJsonStore<T extends Identified>(filePath: string): JsonStore<T> {
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

  return {
    list,
    save,
    replaceAll,
  };
}
