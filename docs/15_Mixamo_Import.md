# 15 Mixamo Import

## Policy

Mixamo のアニメーション FBX をビルドタイムで Croqui 標準の Pose JSON に変換する。

- ランタイムには一切変更を加えない(GLB や FBX をアプリが読むことはない)
- docs/06 のポリシー(ポーズは JSON 管理・API なし)と docs/11(オフライン PWA)を維持する
- 変換ツールは開発時のみ使用し、依存(fbx2gltf / @gltf-transform/core)は devDependencies に置く

## Data Flow

```txt
tools/import-mixamo/mixamo-src/<タグ名>/*.fbx
        │  npm run import:poses [-- --frames N]
        ▼
src/data/poses/<id>.json          … Pose 形式(docs/06 と同一)
src/data/poses/pose-index.json    … 追記更新
```

- フォルダ名がそのままタグになる。カンマ区切りで複数タグ(例: `歩き,全身`)
- `--frames N` で 1 アニメから N ポーズを均等抽出(省略時は中間の 1 フレーム)
- id は `<ファイル名スラッグ>_001` 形式(既存ポーズの命名規則に合わせる)

## Rules

- 変換済みポーズはスキップする(差分ビルド)
- pose-index.json の既存エントリの name / tags / thumbnail の手動編集は再実行しても保持する
- 変換時に各ボーンのワールド回転を再合成して自己検証し、誤差 1e-3 rad 超なら失敗として書き出さない
- 初期姿勢(回転ほぼゼロ)のボーンは Pose JSON から省略する(PoseApplier が 0 に戻すため)

## Retargeting

Mixamo(mixamorig 52 本)→ マネキン(14 本)の変換は 2 方式を併用する。

| 対象 | 方式 | 理由 |
|---|---|---|
| hips / spine / chest / head / 脚 / 足 | ワールド回転差分(q_anim · q_rest⁻¹) | 両者のレスト姿勢が「直立」で一致するため差分をそのまま移植できる |
| 腕(upperArm / lowerArm) | 方向ベクトル(肩→肘、肘→手首に -Y を向ける) | Mixamo は T ポーズ、マネキンは腕下げでレストが異なるため |

左右の対応はボーン名ではなくレスト時ワールド X 座標で決める(マネキンの `_R` は +X 側)。
これにより空間配置が Mixamo の見た目と一致し、鏡像にならない。

## Verification

`npm run validate:pose -- <poseId>` で、マネキンと同じ階層・寸法の順運動学により
正面/側面のスティックフィギュア SVG を `tools/import-mixamo/` に出力できる。

## Known Limits

- PoseApplier は回転のみ適用するため、腰の位置は常に直立時の高さに固定される。
  寝る・しゃがむ等では接地が浮くことがある(既存ポーズと同じ制約)
- 腕は方向ベースのため軸まわりの捻りは持たない(カプセル形状のため見た目に影響なし)
