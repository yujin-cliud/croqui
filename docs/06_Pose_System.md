# 06 Pose System

## Policy

ポーズはJSONで管理する。APIサーバーは使わない。

## Data

```txt
src/data/poses/
├── pose-index.json
└── standing_001.json
```

## Features

- 一覧読み込み
- 現在ポーズ管理
- 次
- 前
- ランダム
- タグ検索
- 5ポーズ先読み

## Rules

- UIからPose JSONを直接読まない
- PoseManager経由
- 検索結果0件でも現在ポーズを消さない
- ランダムは連続同一を避ける
