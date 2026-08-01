import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages(https://<user>.github.io/croqui/)のサブディレクトリ公開に合わせる。
  // 開発サーバーも http://localhost:5173/croqui/ で動く(docs/11)
  base: '/croqui/',
  plugins: [react()],
  // GLTFLoaderが内部で読み込む'three'を本体と同じ依存最適化バンドルに含め、
  // 「Multiple instances of Three.js being imported」(二重インスタンス化)を防ぐ
  optimizeDeps: {
    include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js'],
  },
});
