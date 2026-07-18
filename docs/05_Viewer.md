# 05 Viewer

## Tech

- Three.js
- React Three Fiber
- Drei

## Policy

- Sceneは1つ
- PerspectiveCameraは1台
- 3Dマネキンは1体
- JSONポーズ
- Bone Mapping
- 5ポーズ先読み
- 柔らかい影
- マット素材
- スタジオ環境
- グリッド
- 背景3色
- カメラ中心は骨盤

## Camera

```ts
fov: 35
near: 0.1
far: 100
position: [0, 1.4, 4]
target: [0, 1.0, 0]
```

## Errors

モデル失敗時は再読み込みボタン。
ポーズ失敗時は前ポーズ維持。

## Future

複数モデル、服装変更、体型変更、ポーズ編集、AI生成は実装しない。
