import type { Pose } from '../types/Pose';
import type { BoneMap } from './BoneMapper';
import { BONE_NAMES } from '../types/Pose';
import { applyFootIK } from './FootIK';
import { applyArmIK } from './ArmIK';

// BoneMapに対してPoseの回転値を書き込むだけの純粋な処理。
// Pose JSONに含まれないボーンは初期姿勢（回転0）に戻し、常に一貫した見た目にする。
// 角度(FK)を当てたあと、足を床に接地(FootIK)→腰などの手接触(ArmIK)の順で補正する。
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

  // 足の接地補正を先に(体全体の上下シフトを含むため)、そのあと手の接触IK。
  applyFootIK(boneMap, pose);
  applyArmIK(boneMap, pose);
}