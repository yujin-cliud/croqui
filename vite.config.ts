import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages(https://<user>.github.io/croqui/)のサブディレクトリ公開に合わせる。
  // 開発サーバーも http://localhost:5173/croqui/ で動く(docs/11)
  base: '/croqui/',
  plugins: [react()],
});
