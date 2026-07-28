import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('main session restart wiring', () => {
  it('uses the same resolved restart command for validation, mode normalization and service restart', () => {
    const source = readFileSync('src/main/main.ts', 'utf8');
    const restartHandler = source.match(
      /ipcMain\.handle\('sessions:restart',[\s\S]*?(?=\n\s*ipcMain\.handle\('windows:new')/,
    )?.[0];

    expect(restartHandler).toBeDefined();
    expect(restartHandler).toMatch(/validateSessionCommand\(restartCommand\)/);
    expect(restartHandler).toMatch(
      /normalizedLaunchModes\(\s*profile,\s*restartCommand,\s*request\.claudeLaunchMode,\s*request\.codexLaunchMode,?\s*\)/,
    );
    expect(restartHandler).toMatch(
      /const restartInput\s*=\s*\{[\s\S]*?command:\s*restartCommand\s*,[\s\S]*?\};/,
    );
  });

  // 回归护栏：main.ts 无法直接 import（依赖 electron），过去 87e09a8 的清晰记录功能
  // 只测了实现、没测组装，导致 createSessionRecordSyncService 在 src/ 下零调用、
  // 每窗口 service 落到 unavailableSessionRecordSync（buildRestoreMaterial 恒返回
  // undefined），恢复永远走 PTY 兜底。这些源码断言证明全局服务被构造并注入每窗口。
  it('wires a real record sync service and injects it into each window session service', () => {
    const source = readFileSync('src/main/main.ts', 'utf8');

    // 全局唯一 store + 三个原生 adapter 组成的真实同步服务
    expect(source).toMatch(/createSessionRecordEventStore\(userDataPath\)/);
    expect(source).toMatch(
      /const\s+sessionRecordSyncService\s*=\s*createSessionRecordSyncService\(\{/,
    );
    expect(source).toMatch(/createClaudeRecordSource\(\{\s*approvedRoots:/);
    expect(source).toMatch(/createCodexRecordSource\(\{\s*approvedRoots:/);
    expect(source).toMatch(/createGrokRecordSource\(\{\s*approvedRoots:/);

    // 注入每窗口 service，而不是落到 unavailableSessionRecordSync 默认值
    expect(source).toMatch(/recordSync:\s*sessionRecordSyncService/);

    // 关闭单个窗口不得关闭全局服务：dispose 只在 before-quit 的 disposeAll 之后调用一次
    const beforeQuit = source.match(
      /app\.on\('before-quit',[\s\S]*?\n\}\);/,
    )?.[0];
    expect(beforeQuit).toBeDefined();
    expect(beforeQuit).toMatch(/disposeAll\(\)/);
    expect(beforeQuit).toMatch(/sessionRecordSyncService\.dispose\(\)/);
  });
});
