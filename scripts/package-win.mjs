import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_OUTPUT_ROOT,
  createBuildInfo,
  gitCommit,
  gitDirty,
  packageVersion,
  run,
  timestamp,
  writeBuildInfo,
} from './package-support.mjs';

const outputRoot = process.env.AGENTDOCK_PACKAGE_OUT || DEFAULT_OUTPUT_ROOT;
const buildTime = new Date();
const buildId = timestamp(buildTime);
const version = packageVersion();
const outputDirectory = path.join(outputRoot, buildId);
const appDirectoryName = 'AgentDock-win32-x64';
const appDirectory = path.join(outputDirectory, appDirectoryName);
const resourcesDirectory = path.join(appDirectory, 'resources');
const archiveName = `AgentDock-v${version}-windows-x64.zip`;
const archivePath = path.join(outputDirectory, archiveName);

if (existsSync(outputDirectory)) {
  throw new Error(`Package output directory already exists: ${outputDirectory}`);
}
mkdirSync(outputDirectory, { recursive: true });

run('npx', [
  '--no-install',
  'electron-packager',
  '.',
  'AgentDock',
  '--platform=win32',
  '--arch=x64',
  `--out=${outputDirectory}`,
  '--prune=true',
  '--asar.unpack=**/{*.node,*.exe}',
  '--ignore=^.*@cometix/ccline-darwin-arm64.*$|^/(src|tests|docs|scripts|release|\\.agent-workflow|\\.agentdock|\\.claude|\\.git|\\.pytest_cache)(/|$)|^/\\.env(?:\\..*)?$|^/.*\\.log$',
]);

const buildInfo = createBuildInfo({
  version,
  buildId,
  buildTime,
  commit: gitCommit(),
  dirty: gitDirty(),
});
writeBuildInfo(path.join(resourcesDirectory, 'build-info.json'), buildInfo);

// npm prune 保留 optionalDependencies 的空目录；Windows 归档不得包含 macOS ccline 路径。
const asarPath = path.join(resourcesDirectory, 'app.asar');
const asarExtractDirectory = path.join(outputDirectory, '.asar-win-clean');
run('npx', ['--no-install', 'asar', 'extract', asarPath, asarExtractDirectory]);
rmSync(path.join(asarExtractDirectory, 'node_modules', '@cometix'), {
  recursive: true,
  force: true,
});
run('npx', ['--no-install', 'asar', 'pack', asarExtractDirectory, asarPath]);
rmSync(asarExtractDirectory, { recursive: true, force: true });

for (const requiredPath of [
  path.join(appDirectory, 'AgentDock.exe'),
  path.join(resourcesDirectory, 'app.asar'),
  path.join(
    resourcesDirectory,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds/win32-x64',
    'pty.node',
  ),
  path.join(
    resourcesDirectory,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'prebuilds/win32-x64',
    'conpty',
    'OpenConsole.exe',
  ),
]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Windows package is missing required file: ${requiredPath}`);
  }
}

run('zip', ['-qry', archiveName, appDirectoryName], { cwd: outputDirectory });
console.log(`AgentDock Windows package: ${archivePath}`);
