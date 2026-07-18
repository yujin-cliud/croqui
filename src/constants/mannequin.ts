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
  armRadius: 0.05,
  upperArmLength: 0.26,
  lowerArmLength: 0.24,
  handRadius: 0.055,
  footSize: [0.09, 0.06, 0.22] as const,
  jointRadius: 0.055,
};

export const MANNEQUIN_COLOR = '#c9a06a';
export const MANNEQUIN_JOINT_COLOR = '#8a6a45';
