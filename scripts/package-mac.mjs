import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DEFAULT_OUTPUT_ROOT = 'release/packages';

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const outputRoot = process.env.AGENTDOCK_PACKAGE_OUT || DEFAULT_OUTPUT_ROOT;
const outputDirectory = path.join(outputRoot, timestamp());
const appPath = path.join(outputDirectory, 'AgentDock-darwin-arm64', 'AgentDock.app');

if (existsSync(outputDirectory)) {
  throw new Error(`Package output directory already exists: ${outputDirectory}`);
}

mkdirSync(outputDirectory, { recursive: true });

run('npx', [
  '--no-install',
  'electron-packager',
  '.',
  'AgentDock',
  '--platform=darwin',
  '--arch=arm64',
  `--out=${outputDirectory}`,
  '--prune=true',
  '--asar.unpack=**/{*.node,spawn-helper}',
  '--ignore=^/(src|tests|docs|scripts|release|\\.agent-workflow|\\.git)(/|$)',
]);

run('codesign', ['--force', '--deep', '--sign', '-', appPath]);

console.log(`AgentDock app packaged at: ${appPath}`);
