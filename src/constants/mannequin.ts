// public/models にモデル資産が同梱されていないため、Three.jsのプリミティブ形状で
// 木製デッサン人形（アーティストマネキン）を組み立てる。ここでは組み立てに使う
// 寸法値を一箇所にまとめ、マジックナンバーを避ける。
export const MANNEQUIN_DIMENSIONS = {
  footHeight: 0.05,
  lowerLegLength: 0.42,
  upperLegLength: 0.42,
  legRadius: 0.07,
  hipWidth: 0.16,
  pelvisSize: [0.26, 0.16, 0.16] as const,
  spineLength: 0.18,
  spineRadius: 0.075,
  chestSize: [0.32, 0.2, 0.16] as const,
  chestLength: 0.2,
  shoulderWidth: 0.34,
  neckLength: 0.06,
  headRadius: 0.11,
  armRadius: 0.058,
  upperArmLength: 0.26,
  lowerArmLength: 0.24,
  handRadius: 0.055,
  footSize: [0.09, 0.06, 0.22] as const,
  jointRadius: 0.038,
  // 骨盤(逆三角形)。pelvisSizeはスパイン/脚付け根のオフセット計算に引き続き使用し、
  // 以下は見た目のメッシュ形状にのみ使う
  pelvisTopWidth: 0.22,
  pelvisBottomWidth: 0.30,
  pelvisCornerRadius: 0.02,
  pelvisDepth: 0.07,
  pelvisBevel: 0.018,
  // 骨盤メッシュを少し下げ、股関節の球が三角形の上角の横に見えるようにする
  pelvisOffsetY: -0.02,
  // 胸(上が広く下がすぼまる台形ブロック)
  chestTopWidth: 0.28,
  chestBottomWidth: 0.2,
  chestCornerRadius: 0.02,
  chestDepth: 0.1,
  chestBevel: 0.018,
  // 腰の球(胸と骨盤の間のくびれ部分)
  waistRadius: 0.085,
  bellyWidth: 0.17,
  bellyHeight: 0.10,
  bellyDepth: 0.075,
  bellyBevel: 0.025,
  // 手足の先細り: 末端側の半径 = 基本半径 × この比率
  limbTaperRatio: 0.72,
  // 手の指(ポーズ用ボーンなし・手に固定の飾り)
  fingerRadius: 0.011,
  fingerLength: 0.05,
  fingerGap: 0.024,
  thumbRadius: 0.012,
  thumbLength: 0.042,
  thumbAngle: 0.6,
  // 足の指(同上)
  toeRadius: 0.0095,
  toeLength: 0.03,
  toeGap: 0.019,
};

// 指・足指の長さ/太さの比率(内側=親指側から小指側へ)。木製マネキンらしい簡略表現
export const FINGER_LENGTH_SCALES = [0.92, 1.0, 0.96, 0.85] as const;
export const TOE_SCALES = [1.25, 1.05, 1.0, 0.92, 0.82] as const;

export const MANNEQUIN_COLOR = '#c9a06a';
export const MANNEQUIN_JOINT_COLOR = '#8a6a45';
