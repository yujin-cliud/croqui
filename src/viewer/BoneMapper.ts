import type * as THREE from 'three';
import { BONE_NAMES, type BoneName } from '../types/Pose';

export type BoneMap = Partial<Record<BoneName, THREE.Object3D>>;

// ModelLoaderが構築した階層を走査し、`userData.bone`にボーン名を持つノードだけを
// 集めてBoneMapを作る。PoseApplierはこのマップを介してのみボーンへアクセスする。
// この時点(ポーズ適用前)のクォータニオンを`userData.bind`に保存し、PoseApplierが
// バインド姿勢からの相対回転(bind × delta)としてポーズを重ねられるようにする。
export function buildBoneMap(root: THREE.Object3D): BoneMap {
  const boneMap: BoneMap = {};

  root.traverse((object) => {
    const boneName = object.userData.bone as BoneName | undefined;
    if (boneName && (BONE_NAMES as readonly string[]).includes(boneName)) {
      object.userData.bind = object.quaternion.clone();
      boneMap[boneName] = object;
    }
  });

  return boneMap;
}
