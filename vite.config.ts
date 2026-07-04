import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join('; ');

// 仅在生产构建时注入 CSP：打包后的 file:// 页面强制同源，堵住 XSS 加载远程脚本或外泄数据。
// 开发模式（Vite dev server + HMR WebSocket）不注入，避免内联脚本与热更新被 CSP 拦截。
function productionCspPlugin(): Plugin {
  return {
    name: 'agentdock-production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: CONTENT_SECURITY_POLICY,
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), productionCspPlugin()],
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
