# 02 Architecture

## Layers

```txt
User
 ↓
React UI
 ↓
Manager
 ↓
Zustand Store
 ↓
StorageService / Viewer Engine / Pose Data
```

## Responsibilities

- UI: 表示と操作受付
- Manager: 処理
- Store: 状態
- Viewer: 3D描画
- StorageService: 保存
- Data: JSONポーズ・タグ

## Stores

- ViewerStore
- PoseStore
- TimerStore
- FavoriteStore
- SettingsStore

## Managers

- PoseManager
- TimerManager
- FavoriteManager
- SettingsManager
- ViewerManager

## Rules

- UIにビジネスロジックを書かない
- Storeに非同期処理を書かない
- IndexedDBはStorageService経由
- Viewer操作はViewerManager経由
