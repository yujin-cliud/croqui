import * as THREE from 'three';
import type { Pose, BoneName } from '../types/Pose';
import type { BoneMap } from './BoneMapper';
import { BONE_NAMES } from '../types/Pose';
import { applyFootIK } from './FootIK';
import { applyArmIK } from './ArmIK';

const IDENTITY_QUATERNION = new THREE.Quaternion();

// bind×delta(ローカル合成)が破綻するボーン。pose JSONのdelta値は「ワールド空間の
// 回転差分」を前提に作られているが(docs/15)、bind×deltaはdeltaをローカル空間の値として
// 扱うため、バインド回転が大きい(恒等から遠い)ボーンでは意図しない向きになる。
// footはIK(FootIK)で毎回上書きされる upperLeg/lowerLeg と違い、この結果がそのまま
// 最終的な見た目になる唯一のボーンのため、ここだけ例外的にワールド空間で合成する。
const WORLD_COMPOSITE_BONES = new Set<BoneName>(['foot_L', 'foot_R']);

// BoneMapに対してPoseの回転値を書き込むだけの純粋な処理。
// 各ボーンの「バインド(レスト)姿勢」からの相対回転として適用する(bind × delta)。
// プリミティブ版マネキンは全ボーンのバインド回転が恒等なのでdeltaがそのまま最終回転になり
// 従来の挙動と変わらない。バインド回転が非恒等なGLBリグでも正しく重ね合わせられる。
// Pose JSONに含まれないボーンはバインド姿勢(delta=恒等)に戻し、常に一貫した見た目にする。
// 角度(FK)を当てたあと、足を床に接地(FootIK)→腰などの手接触(ArmIK)の順で補正する。
export function applyPose(boneMap: BoneMap, pose: Pose): void {
  for (const boneName of BONE_NAMES) {
    const bone = boneMap[boneName];
    if (!bone) continue;

    const boneData = pose.bones[boneName];
    const delta = boneData
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...boneData.rotation))
      : IDENTITY_QUATERNION;

    if (WORLD_COMPOSITE_BONES.has(boneName) && bone.parent) {
      const bindWorld = (bone.userData.bindWorld as THREE.Quaternion | undefined) ?? IDENTITY_QUATERNION;
      const targetWorld = delta.clone().multiply(bindWorld);
      const parentWorldInv = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      bone.quaternion.copy(parentWorldInv.multiply(targetWorld));
    } else {
      const bind = (bone.userData.bind as THREE.Quaternion | undefined) ?? IDENTITY_QUATERNION;
      bone.quaternion.copy(bind).multiply(delta);
    }
  }

  // 足の接地補正を先に(体全体の上下シフトを含むため)、そのあと手の接触IK。
  applyFootIK(boneMap, pose);
  applyArmIK(boneMap, pose);
}