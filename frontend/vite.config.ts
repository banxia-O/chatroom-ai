import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

// 浏览器跑在 5173；后端跑在 3000。dev 用 vite proxy 转发 /api 与 /ws，
// 这样前端代码里所有请求都用相对路径，prod 走 Nginx 同源时无需改一行。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/mcp': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
});
