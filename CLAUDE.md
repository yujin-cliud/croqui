# CLAUDE.md

このファイルはClaude Codeが最初に読む開発指示書です。

## Role

あなたはCroqui Ver.1 MVPを実装する開発エージェントです。

目的は、完成形ではなく **公開できるVer.1 MVP** を完成させることです。

## Most Important Rule

`docs/` 配下の設計書を唯一の仕様として扱ってください。

設計書にない機能は実装しないでください。

## MVP Only

以下は実装禁止です。

- AI生成
- AI添削
- 模写モード
- コレクション
- 最近使ったポーズ
- 人気順
- 課金
- クラウド同期
- Push通知
- 統計
- バックアップ
- アカウント機能

## Working Style

このプロジェクトは基本的に既存コードの手直しで進める。

- 既存のコードはなるべく壊さない
- 変更は必要な部分だけに留める
- 頼まれていない範囲のリファクタリングや書き直しをしない
- 動いている実装を、頼まれてもいないのに「きれいにする」ために変更しない

## Architecture Rules

- UIは表示と操作受付のみ
- Managerは処理のみ
- Storeは状態のみ
- StorageServiceは保存のみ
- Viewerは描画のみ
- UIからIndexedDBを直接操作しない
- UIからThree.jsを直接操作しない
- Storeに非同期処理を書かない
- Storeにビジネスロジックを書かない
- IndexedDBは必ずStorageService経由
- Three.js操作はviewer層に閉じ込める

## Coding Rules

- TypeScriptを使う
- `any`は禁止
- 意味のある命名をする
- マジックナンバーは禁止
- 1ファイル1責務
- Future機能の未使用コードを書かない
- TODOだけの未完成機能を残さない
- 新しいライブラリを勝手に追加しない

## Implementation Order

1. package確認
2. srcディレクトリ確認
3. 型定義
4. constants
5. Zustand Store
6. StorageService
7. Viewer
8. Pose System
9. Timer
10. Search
11. Favorites
12. Settings
13. PWA
14. Error Handling
15. Build確認

## Before Editing

作業前に必ず以下を読むこと。

- README.md
- docs/01_Project_Overview.md
- docs/02_Architecture.md
- docs/03_Directory_Structure.md
- docs/14_Development_Guide.md

該当機能を実装する場合は、対応する章も必ず読むこと。

## Done Criteria

- `npm run build` が成功する
- TypeScriptエラーがない
- MVP範囲外の実装がない
- 設計書と矛盾しない
- オフライン動作を壊していない
- エラー時にアプリ全体を止めない

## Final Goal

Croqui Ver.1を公開可能な品質で完成させること。
