import * as THREE from 'three';
import { BONE_NAMES, type BoneName } from '../types/Pose';

export type BoneMap = Partial<Record<BoneName, THREE.Object3D>>;

// ModelLoaderが構築した階層を走査し、`userData.bone`にボーン名を持つノードだけを
// 集めてBoneMapを作る。PoseApplierはこのマップを介してのみボーンへアクセスする。
// この時点(ポーズ適用前)のクォータニオンを`userData.bind`(ローカル、PoseApplierの
// bind×deltaが使用)と`userData.bindWorld`(ワールド、FootIKが接地足の向きを
// 幾何学的に決め直す際、「甲の上方向/つま先方向」をバインド姿勢から逆算するのに使用)
// に保存する。
export function buildBoneMap(root: THREE.Object3D): BoneMap {
  const boneMap: BoneMap = {};

  root.traverse((object) => {
    const boneName = object.userData.bone as BoneName | undefined;
    if (boneName && (BONE_NAMES as readonly string[]).includes(boneName)) {
      object.userData.bind = object.quaternion.clone();
      object.userData.bindWorld = object.getWorldQuaternion(new THREE.Quaternion());
      boneMap[boneName] = object;
    }
  });

  return boneMap;
}
