export type PoseBone = {
  rotation: [number, number, number];
};

export type Pose = {
  id: string;
  name: string;
  tags: string[];
  bones: Record<string, PoseBone>;
  ik?: Partial<Record<'hand_L' | 'hand_R', [number, number, number]>>;
};

export type PoseIndexItem = {
  id: string;
  name: string;
  file: string;
  tags: string[];
  thumbnail: string | null;
  hidden?: boolean;
};

// マネキンが対応するボーン名の一覧。Pose JSONの`bones`はこの名前のサブセットを
// 持てば良く、含まれないボーンは初期姿勢（回転なし）のまま表示される。
export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'head',
  'neck',
  'shoulder_L',
  'shoulder_R',
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
  // 指(親指/人差し指/中指/薬指/小指 × 3関節 × 左右)
  'thumb1_L',
  'thumb2_L',
  'thumb3_L',
  'index1_L',
  'index2_L',
  'index3_L',
  'middle1_L',
  'middle2_L',
  'middle3_L',
  'ring1_L',
  'ring2_L',
  'ring3_L',
  'pinky1_L',
  'pinky2_L',
  'pinky3_L',
  'thumb1_R',
  'thumb2_R',
  'thumb3_R',
  'index1_R',
  'index2_R',
  'index3_R',
  'middle1_R',
  'middle2_R',
  'middle3_R',
  'ring1_R',
  'ring2_R',
  'ring3_R',
  'pinky1_R',
  'pinky2_R',
  'pinky3_R',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];