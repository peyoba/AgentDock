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

// ad-hoc 签名（"-"）每次打包 cdhash 都不同，macOS TCC 会把每个新包当成新应用，
// 桌面/文稿等文件夹授权反复弹窗。优先使用本机固定证书（钥匙串里创建一次即可），
// 让重新打包后的 App 保持同一签名身份，授权持续有效。
export function resolveSigningIdentity({
  explicitIdentity = process.env.AGENTDOCK_CODESIGN_IDENTITY,
  listIdentities = defaultListIdentities,
} = {}) {
  if (explicitIdentity) {
    return explicitIdentity;
  }

  const output = listIdentities();
  const identities = [...output.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const preferred =
    identities.find((identity) => /agentdock/i.test(identity)) ??
    identities.find((identity) => /^(Apple Development|Developer ID Application)/.test(identity));

  return preferred ?? '-';
}

function defaultListIdentities() {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout : '';
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isDirectRun) {
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
    '--asar.unpack=**/{*.node,spawn-helper,ccline}',
    '--ignore=^/(src|tests|docs|scripts|release|\\.agent-workflow|\\.agentdock|\\.claude|\\.git|\\.pytest_cache)(/|$)|^/\\.env(?:\\..*)?$|^/.*\\.log$',
  ]);

  const signingIdentity = resolveSigningIdentity();
  if (signingIdentity === '-') {
    console.warn(
      '[package-mac] 未找到本机代码签名证书，使用 ad-hoc 签名：每次重新打包 macOS 都会重新请求文件夹访问授权。\n' +
        '[package-mac] 一次性修复：钥匙串访问 → 证书助理 → 创建证书（名称含 AgentDock，类型选“代码签名”），之后重新打包即可。',
    );
  } else {
    console.log(`[package-mac] Signing with identity: ${signingIdentity}`);
  }
  run('codesign', ['--force', '--deep', '--sign', signingIdentity, appPath]);

  console.log(`AgentDock app packaged at: ${appPath}`);
}
