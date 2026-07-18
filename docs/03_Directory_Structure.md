# 03 Directory Structure

Layer First Architectureを採用する。

```txt
src/
├── assets/
├── components/
├── viewer/
├── managers/
├── stores/
├── services/
├── hooks/
├── data/
├── types/
├── utils/
├── constants/
├── pages/
├── App.tsx
└── main.tsx
```

## Rules

- 新しいフォルダを勝手に作らない
- 1ファイル1責務
- 意味の分かる名前にする
- Storeはstores
- Managerはmanagers
- Three.js関連はviewer
