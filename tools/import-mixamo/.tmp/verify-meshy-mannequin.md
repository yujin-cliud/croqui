# Meshyリグ付きモデル 検証結果

検証日: 2026-07-31
対象: `meshy_mannequin_rigged.blend` からエクスポートした `meshy_mannequin_rigged.glb`
検証方法: `tools/import-mixamo/.tmp/inspect-glb.mjs` (既存コード非依存の一時検証スクリプト)

```
node tools/import-mixamo/.tmp/inspect-glb.mjs "C:\Users\あづさ\Downloads\meshy_mannequin_rigged.glb"
```

## 階層(world Y座標つき、下から上)

```
Hips(96.6)
├ LeftUpLeg/RightUpLeg → Leg → Foot → ToeBase   (脚: Mixamo標準命名と完全一致)
└ Spine02(108.2) → Spine01(119.9) → Spine(131.5)
    ├ LeftShoulder → LeftArm → LeftForeArm → LeftHand
    ├ RightShoulder → RightArm → RightForeArm → RightHand
    └ neck → Head → (head_end, headfront)
```

## Croqui 16ボーンへのマッピング判定

| Croquiの役割 | 判定 | 実際のノード |
|---|---|---|
| hips | OK | `Hips` |
| upperArm/lowerArm/hand (L/R) | OK | `LeftArm/LeftForeArm/LeftHand` ほか、Mixamo標準と完全一致 |
| upperLeg/lowerLeg/foot (L/R) | OK | `LeftUpLeg/LeftLeg/LeftFoot` ほか、完全一致 |
| head | OK | `Head` |
| spine(腰に近い方) | **要補正**(下記) | スクリプトは `"Spine"` を発見しOK扱いしたが誤り |
| chest(首に近い方) | 誤検出でNG | `"Spine2"` という名前が存在しないため未検出 |

### 要補正の内容(Spine02/Spine 逆転)

このモデルは `Spine02(下,108.2) → Spine01(119.9) → Spine(上,131.5)` で、
Mixamo標準(`Spine`が下・`Spine2`が上)と数字の意味が逆。
スクリプトは文字列 `"Spine"` に完全一致する実在ノードを見つけたため機械的に
「OK」と出したが、それは実際には上側(胸寄り)のボーンであり、Croquiの
`spine`(腰寄り)役には使えない。

正しい対応:

- Croqui `spine`(腰寄り) ← 実際は **`Spine02`**
- Croqui `chest`(胸寄り) ← 実際は **`Spine`**(無番号の方)
- `Spine01`(中間) → 未使用でOK(Mixamo本家の `Spine1` も同様に未使用)

## 余分なボーン

`LeftShoulder/RightShoulder`, `neck`, `LeftToeBase/RightToeBase`, `head_end`,
`headfront` はCroquiの16ボーンに含まれないが、現行の `import-mixamo.mjs` も
Mixamoの同種ボーン(`Shoulder`/`Neck`/`ToeBase`)を最初から使っていないため
問題にならない。

## レストポーズの診断

- 左右の腕: **Tポーズ寄り**(方向ベクトルがX方向優勢)
- 脚: 直立でCroquiのマネキンと同じ「まっすぐ立った」姿勢(world座標がほぼ-Y方向に一直線)

脚・腰・胸・頭はCroquiと同じ「直立」レストで一致し、腕だけMixamoと同様にTポーズで
ズレている。これは既存の `import-mixamo.mjs` が想定している構図と同じであり、
「胴体・脚・頭はワールド回転差分(delta方式)、腕だけ方向ベクトル(aim方式)」という
2方式の使い分けがこのモデルにもそのまま応用できる見込みが高い。

## 結論

Croquiの16ボーン全てにマッピング可能。必要な補正は「Spine02/Spineの役割入れ替え」
1点のみで、それ以外は命名・階層・レストポーズともに想定通りだった。
