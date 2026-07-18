import type * as THREE from 'three';
import { BONE_NAMES, type BoneName } from '../types/Pose';

export type BoneMap = Partial<Record<BoneName, THREE.Object3D>>;

// ModelLoaderが構築した階層を走査し、`userData.bone`にボーン名を持つノードだけを
// 集めてBoneMapを作る。PoseApplierはこのマップを介してのみボーンへアクセスする。
export function buildBoneMap(root: THREE.Object3D): BoneMap {
  const boneMap: BoneMap = {};

  root.traverse((object) => {
    const boneName = object.userData.bone as BoneName | undefined;
    if (boneName && (BONE_NAMES as readonly string[]).includes(boneName)) {
      boneMap[boneName] = object;
    }
  });

  return boneMap;
}
