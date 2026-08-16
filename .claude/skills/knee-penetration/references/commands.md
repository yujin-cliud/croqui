# 膝貫通ツールのコマンドと読み方

すべて Node が要る。リポジトリのルートで実行する。
（WSL/コンテナ側には node が無い場合がある。その場合は Windows 側で実行する）

モデルは3体: `public/models/mannequin.glb`(anatomy) / `female.glb` / `male2.glb`。
ポーズの実体はモデル別に `src/data/poses/<modelId>/<file>.json`。

## 検出

### 全数調査（ここから始める）

```bash
node tools/survey-knee-poses.mjs --threshold 1.0
```

全ポーズ × 全モデル × 左右を測り、貫通が大きい順に上位40件を表示する。

```
  max(cm)  verts   内角   側  モデル    ポーズ
```

- `max` … 最大**超過**貫通(cm)。レスト状態の食い込みを差し引いた超過分
- `verts` … 超過した頂点数
- `内角` … 膝の内角(度)。180°=まっすぐ、小さいほど深屈曲
- `--threshold` … 「問題ポーズ」として集計するしきい値(cm)。既定1.0

**読み方**: `max` が大きい順に潰す。`内角` が45°未満に集中しているはずで、そうでない
ポーズが混じっていたら、ひねりなど別要因を疑う手がかりになる。

### 1ポーズを詳しく測る

```bash
node tools/measure-knee-penetration.mjs public/models/male2.glb \
  --pose src/data/poses/male2/female_action_pose_001.json --side both
```

貫通頂点数・最大貫通深さ・平均貫通深さを出す。測定手順は `docs/cowork_brief_knee.md` §6 の実装。

- `--side L|R|both`
- `--morph <name> --influence <0..1>` … morph を効かせた状態で測る（対策後の確認に使う）

**FootIK/ArmIK は掛からない純FK**で測ることに注意。実機の見た目とは接地補正のぶんだけ違う。

### 角度を指定して測る（傾向をつかむ）

```bash
node tools/measure-knee-penetration.mjs public/models/male2.glb --bend 45 --side L
```

ポーズではなく「純粋な膝曲げで内角45°」の状態を作って測る。屈曲軸はボーンのローカルZ、
二分探索で目標角度に合わせている。モデル間・対策前後の比較に使う。

## 対策を作る

### 案B: 再ピボット morph

```bash
# CPU上で効果を先に確認（GLBは変更しない）
node tools/test-knee-repivot.mjs public/models/male2.glb \
  src/data/poses/male2/female_action_pose_001.json --side L [--shift auto|<m>]

# 実機用に6枚のmorph(左右×xyz)をGLBへ焼く
node tools/build-knee-repivot.mjs <in.glb> <out.glb>
```

焼いたあとは実行時に `src/viewer/KneeCorrective.ts` が influence を駆動する。
中央化量 δ は `mesh.extras.kneeRepivot` に入る。

### 案A: 角度駆動の補正シェイプキー

```bash
# フル補正(influence=1)のmorphを焼く
node tools/build-knee-corrective.mjs <in.glb> <out.glb> --side L \
  --pose src/data/poses/male2/female_action_pose_001.json \
  [--margin 0.004] [--iters 8] [--smooth 1] [--name kneeCorrective_L]

# 合否は独立ツールで測る（焼いたツール自身の自己申告を信じない）
node tools/measure-knee-penetration.mjs <out.glb> --pose <pose.json> --side L \
  --morph kneeCorrective_L --influence 1
```

### 汎化と駆動の検証

```bash
# 1つの角度で作ったmorphを、他の角度に線形influenceで流用して破綻しないか
node tools/sweep-knee-influence.mjs <model.glb> --side L --morph kneeCorrective_L \
  [--angles 115,85,65,45,37] [--infl 0,0.25,0.5,0.75,1]

# 複数morphを角度でtentブレンドして全ポーズを評価
node tools/eval-knee-driver.mjs <multiMorph.glb> --model-id male2 [--ramp 155] [--pose <file>]
```

`sweep-knee-influence.mjs` は2つを同時に出す。

- **超過貫通**（補正不足）… まだ潜っている頂点数と最大深さ
- **過補正**（逆向きの膨らみ）… その角度では潜っていない頂点をmorphが動かした量

**両方を見る。** 片方だけ良くしても、もう片方がスパイクや膨らみとして見た目に出る。

`eval-knee-driver.mjs` の `--ramp` は「この内角より真っ直ぐなら補正0」のしきい値（既定155°）。

## 参考ツール（不採用の対策・残置）

- `tools/smooth-skin-weights.mjs` … ウェイト平滑化。効果なしと確認済み。再試行しない
- `tools/analyze-mixamo-skinning.mjs` … Mixamo側のスキニング調査
- `tools/bake-cavity.mjs` / `tools/fix-model-hierarchy.mjs`

## ポーズを作り直す

```bash
npm run import:poses -- --force
```

Mixamo FBX（`tools/import-mixamo/mixamo-src/`、gitignore対象）から全ポーズを再生成する。
`--frames <n>` でサンプリング枚数を変えられる。

## 数値の基準（再掲）

| 指標 | 現状 | 合格ライン |
|---|---|---|
| 最大貫通 | 約6cm | 1cm 未満 |
| 貫通頂点数 | 1600前後(male2) | 現状の1/10以下 |
| 対象 | — | 3体すべて |
| リターゲット精度 | 平均0.13° / 最大0.67° | 悪化させない |
