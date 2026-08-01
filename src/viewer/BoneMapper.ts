import * as THREE from 'three';
import { BONE_NAMES, type BoneName } from '../types/Pose';

export type BoneMap = Partial<Record<BoneName, THREE.Object3D>>;

// ModelLoaderが構築した階層を走査し、`userData.bone`にボーン名を持つノードだけを
// 集めてBoneMapを作る。PoseApplierはこのマップを介してのみボーンへアクセスする。
// この時点(ポーズ適用前)のクォータニオンを`userData.bind`(ローカル)と
// `userData.bindWorld`(ワールド、bind×delta方式が破綻するfoot系のみが使用)に保存する。
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
