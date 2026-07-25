export type PoseBone = {
  rotation: [number, number, number];
};

export type Pose = {
  id: string;
  name: string;
  tags: string[];
  bones: Record<string, PoseBone>;
};

export type PoseIndexItem = {
  id: string;
  name: string;
  file: string;
  tags: string[];
  thumbnail: string | null;
};

// マネキンが対応するボーン名の一覧。Pose JSONの`bones`はこの名前のサブセットを
// 持てば良く、含まれないボーンは初期姿勢（回転なし）のまま表示される。
export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'head',
  'upperArm_L',
  'lowerArm_L',
  'hand_L',
  'upperArm_R',
  'lowerArm_R',
  'hand_R',
  'upperLeg_L',
  'lowerLeg_L',
  'foot_L',
  'upperLeg_R',
  'lowerLeg_R',
  'foot_R',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];