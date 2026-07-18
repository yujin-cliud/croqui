# 07 State Management

Zustandを使用する。

## Rule

Storeは状態のみ。

禁止：

- 非同期処理
- IndexedDBアクセス
- JSON読み込み
- ランダム
- タイマー制御
- エラー復旧

## Stores

- ViewerStore
- PoseStore
- TimerStore
- FavoriteStore
- SettingsStore

## Selector

Reactでは必要なstateだけ取得する。
