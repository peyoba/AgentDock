import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  COMMON_CLI_PATHS,
  uniquePathEntries,
  userCliPaths,
} from './adapters/ptyAdapter.js';

const require = createRequire(import.meta.url);

const CCLINE_BINARY_PACKAGE = '@cometix/ccline-darwin-arm64';

export type CclineFileStats = {
  isFile: boolean;
  isExecutable: boolean;
};

export type ResolveCclineCommandInput = {
  platform?: NodeJS.Platform;
  homeDir?: string;
  envPath?: string;
  fileStats?: (filePath: string) => CclineFileStats | undefined;
  makeExecutable?: (filePath: string) => void;
  bundledPackageRoot?: string;
};

function defaultFileStats(filePath: string): CclineFileStats | undefined {
  try {
    const stats = fs.statSync(filePath);
    return { isFile: stats.isFile(), isExecutable: (stats.mode & 0o111) !== 0 };
  } catch {
    return undefined;
  }
}

function defaultMakeExecutable(filePath: string): void {
  try {
    fs.chmodSync(filePath, fs.statSync(filePath).mode | 0o755);
  } catch {
    // 权限修复失败时仍返回该路径，由执行时报错兜底
  }
}

function defaultBundledPackageRoot(): string | undefined {
  try {
    return path.dirname(require.resolve(`${CCLINE_BINARY_PACKAGE}/package.json`));
  } catch {
    // 可选依赖在非 darwin-arm64 环境不会安装
    return undefined;
  }
}

/**
 * 解析 statusLine 应执行的 ccline 命令：
 * 1. 优先使用用户已安装的 ccline（与 PTY 会话相同的 PATH 优先级），跟随用户自行升级的版本；
 * 2. 找不到时回退到随 AgentDock 内嵌的二进制（asar 解包路径）；
 * 3. 两者都缺失时保持旧行为，返回裸命令名交给运行时 PATH 解析。
 */
export function resolveCclineCommand({
  platform = process.platform,
  homeDir = process.env.HOME,
  envPath = process.env.PATH ?? '',
  fileStats = defaultFileStats,
  makeExecutable = defaultMakeExecutable,
  bundledPackageRoot = defaultBundledPackageRoot(),
}: ResolveCclineCommandInput = {}): string | undefined {
  if (platform !== 'darwin') {
    return undefined;
  }

  const searchDirectories = uniquePathEntries([
    ...userCliPaths(homeDir),
    ...envPath.split(path.delimiter),
    ...COMMON_CLI_PATHS,
  ]);

  for (const directory of searchDirectories) {
    const candidate = path.join(directory, 'ccline');
    const stats = fileStats(candidate);
    if (stats?.isFile && stats.isExecutable) {
      return candidate;
    }
  }

  if (bundledPackageRoot) {
    const bundledBinary = path
      .join(bundledPackageRoot, 'ccline')
      .replace('app.asar', 'app.asar.unpacked')
      .replace('node_modules.asar', 'node_modules.asar.unpacked');
    const stats = fileStats(bundledBinary);
    if (stats?.isFile) {
      if (!stats.isExecutable) {
        makeExecutable(bundledBinary);
      }
      return bundledBinary;
    }
  }

  return 'ccline';
}
