import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('security hardening', () => {
  it('denies renderer-opened windows and locks navigation in the main process', () => {
    const mainSource = readFileSync('src/main/main.ts', 'utf8');

    expect(mainSource).toMatch(/setWindowOpenHandler/);
    expect(mainSource).toMatch(/action:\s*'deny'/);
    expect(mainSource).toMatch(/will-navigate/);
  });

  it('injects a Content-Security-Policy into production builds only', () => {
    const viteConfig = readFileSync('vite.config.ts', 'utf8');

    expect(viteConfig).toMatch(/Content-Security-Policy/);
    // apply:'build' 确保 dev server（含 HMR WebSocket）不被 CSP 拦截
    expect(viteConfig).toContain("apply: 'build'");
    expect(viteConfig).toMatch(/default-src 'self'/);
    // 脚本限定同源，禁止内联/远程脚本执行
    expect(viteConfig).toMatch(/script-src 'self'/);
  });

  it('keeps context isolation on and node integration off', () => {
    const mainSource = readFileSync('src/main/main.ts', 'utf8');

    expect(mainSource).toMatch(/contextIsolation:\s*true/);
    expect(mainSource).toMatch(/nodeIntegration:\s*false/);
  });
});
