import type { Pose } from '../types/Pose';
import type { BoneMap } from './BoneMapper';
import { BONE_NAMES } from '../types/Pose';

// BoneMapに対してPoseの回転値を書き込むだけの純粋な処理。
// Pose JSONに含まれないボーンは初期姿勢（回転0）に戻し、常に一貫した見た目にする。
export function applyPose(boneMap: BoneMap, pose: Pose): void {
  for (const boneName of BONE_NAMES) {
    const bone = boneMap[boneName];
    if (!bone) continue;

    const boneData = pose.bones[boneName];
    if (boneData) {
      const [x, y, z] = boneData.rotation;
      bone.rotation.set(x, y, z);
    } else {
      bone.rotation.set(0, 0, 0);
    }
  }
}
