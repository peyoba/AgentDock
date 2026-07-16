import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const DEFAULT_OUTPUT_ROOT = 'release/packages';

export function timestamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function createBuildInfo({ version, buildId, buildTime, commit, dirty }) {
  return {
    version,
    buildId,
    buildTime: buildTime.toISOString(),
    commit,
    commitShort: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
    dirty,
  };
}

export function packageVersion() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error('package.json version is missing');
  }
  return packageJson.version;
}

export function gitCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`git rev-parse HEAD failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git rev-parse HEAD failed with exit code ${result.status ?? 1}`);
  }
  return result.stdout.trim();
}

export function gitDirty() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`git status --porcelain failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git status --porcelain failed with exit code ${result.status ?? 1}`);
  }
  return result.stdout.trim().length > 0;
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    throw new Error(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? 1}`);
  }
}

export function writeBuildInfo(filePath, buildInfo) {
  writeFileSync(filePath, `${JSON.stringify(buildInfo, null, 2)}\n`);
}
