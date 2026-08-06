import * as THREE from 'three';
import type { Pose } from '../types/Pose';
import type { BoneMap } from './BoneMapper';
import { BONE_NAMES } from '../types/Pose';
import { applyFootIK } from './FootIK';
import { applyArmIK } from './ArmIK';
import { applyBendSmoothing } from './Bendsmoother';

const IDENTITY_QUATERNION = new THREE.Quaternion();

// BoneMapに対してPoseの回転値を書き込むだけの純粋な処理。
// 各ボーンの「バインド(レスト)姿勢」からの相対回転として適用する(bind × delta)。
// プリミティブ版マネキンは全ボーンのバインド回転が恒等なのでdeltaがそのまま最終回転になり
// 従来の挙動と変わらない。バインド回転が非恒等なGLBリグでも正しく重ね合わせられる。
// footの見た目は最終的にFootIKが接地時に幾何学的な向きへ上書きするため、ここでのfoot自体の
// 精度は問わない(FK値は遊脚時のフォールバックとしてのみ使われる)。
// Pose JSONに含まれないボーンはバインド姿勢(delta=恒等)に戻し、常に一貫した見た目にする。
// 角度(FK)を当てたあと、足を床に接地(FootIK)→腰などの手接触(ArmIK)の順で補正する。
export function applyPose(boneMap: BoneMap, pose: Pose): void {
  for (const boneName of BONE_NAMES) {
    const bone = boneMap[boneName];
    if (!bone) continue;

    const bind = (bone.userData.bind as THREE.Quaternion | undefined) ?? IDENTITY_QUATERNION;
    const boneData = pose.bones[boneName];
    const delta = boneData
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...boneData.rotation))
      : IDENTITY_QUATERNION;
    bone.quaternion.copy(bind).multiply(delta);
  }

  // 足の接地補正を先に(体全体の上下シフトを含むため)、そのあと手の接触IK。
  applyBendSmoothing(boneMap);
  applyFootIK(boneMap, pose);
  applyArmIK(boneMap, pose);
}