# 12 Reliability and Error Handling

## Policy

- アプリ全体を止めない
- 前状態を維持
- 分かりやすい日本語で表示
- 技術エラーを直接出さない

## Error Boundary

Viewer、Control Panel、App全体を保護する。

## Fallback

- 個別ポーズ失敗: 前ポーズ維持
- 設定失敗: 初期設定
- 保存失敗: 一時状態のみ
- PWA失敗: 通常Webアプリ
