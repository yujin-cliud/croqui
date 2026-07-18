import * as THREE from 'three';
import { MANNEQUIN_DIMENSIONS, MANNEQUIN_COLOR, MANNEQUIN_JOINT_COLOR } from '../constants/mannequin';
import type { BoneName } from '../types/Pose';

export type MannequinModel = {
  root: THREE.Group;
};

type Side = 'L' | 'R';

// 配布物にモデル資産（glTF等）が含まれていないため、Three.jsのプリミティブ形状を
// 組み合わせてデッサン用の木製アーティストマネキンを生成する。
// 各関節はTHREE.Groupとして表現し、`userData.bone`にPose JSONと対応する
// ボーン名を持たせることで、BoneMapperが後から機械的に収集できるようにする。

function createJointSphere(radius: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createLimbBone(
  boneName: BoneName,
  length: number,
  radius: number,
  material: THREE.Material
): THREE.Group {
  const bone = new THREE.Group();
  bone.name = boneName;
  bone.userData.bone = boneName;

  const capsuleLength = Math.max(length - radius * 2, 0.02);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, capsuleLength, 4, 8), material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  bone.add(mesh);

  return bone;
}

export function createMannequin(): MannequinModel {
  const d = MANNEQUIN_DIMENSIONS;
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: MANNEQUIN_COLOR,
    roughness: 0.85,
    metalness: 0.05,
  });
  const jointMaterial = new THREE.MeshStandardMaterial({
    color: MANNEQUIN_JOINT_COLOR,
    roughness: 0.7,
    metalness: 0.1,
  });

  const root = new THREE.Group();
  root.name = 'mannequinRoot';

  const hipHeight = d.footHeight + d.lowerLegLength + d.upperLegLength;

  // Hips: ルートボーン（骨盤）。カメラの注視点もここを基準にする。
  const hips = new THREE.Group();
  hips.name = 'hips';
  hips.userData.bone = 'hips';
  hips.position.set(0, hipHeight, 0);
  root.add(hips);

  const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(...d.pelvisSize), bodyMaterial);
  pelvisMesh.castShadow = true;
  pelvisMesh.receiveShadow = true;
  hips.add(pelvisMesh);

  // Spine -> Chest -> Head
  const spine = new THREE.Group();
  spine.name = 'spine';
  spine.userData.bone = 'spine';
  spine.position.set(0, d.pelvisSize[1] / 2, 0);
  hips.add(spine);

  const spineMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(d.spineRadius, Math.max(d.spineLength - d.spineRadius * 2, 0.02), 4, 8),
    bodyMaterial
  );
  spineMesh.position.y = d.spineLength / 2;
  spineMesh.castShadow = true;
  spineMesh.receiveShadow = true;
  spine.add(spineMesh);

  const chest = new THREE.Group();
  chest.name = 'chest';
  chest.userData.bone = 'chest';
  chest.position.set(0, d.spineLength, 0);
  spine.add(chest);

  const chestMesh = new THREE.Mesh(new THREE.BoxGeometry(...d.chestSize), bodyMaterial);
  chestMesh.position.y = d.chestSize[1] / 2;
  chestMesh.castShadow = true;
  chestMesh.receiveShadow = true;
  chest.add(chestMesh);

  const head = new THREE.Group();
  head.name = 'head';
  head.userData.bone = 'head';
  head.position.set(0, d.chestSize[1] + d.neckLength, 0);
  chest.add(head);

  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, d.neckLength, 8), bodyMaterial);
  neckMesh.position.y = -d.neckLength / 2;
  neckMesh.castShadow = true;
  head.add(neckMesh);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(d.headRadius, 16, 12), bodyMaterial);
  headMesh.position.y = d.headRadius;
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);

  // Arms
  const sides: Array<{ side: Side; sign: 1 | -1 }> = [
    { side: 'L', sign: -1 },
    { side: 'R', sign: 1 },
  ];

  for (const { side, sign } of sides) {
    const shoulderPosition = new THREE.Vector3((d.shoulderWidth / 2) * sign, d.chestSize[1] * 0.85, 0);

    const shoulderJoint = createJointSphere(d.jointRadius, jointMaterial);
    shoulderJoint.position.copy(shoulderPosition);
    chest.add(shoulderJoint);

    const upperArmName = `upperArm_${side}` as BoneName;
    const upperArm = createLimbBone(upperArmName, d.upperArmLength, d.armRadius, bodyMaterial);
    upperArm.position.copy(shoulderPosition);
    chest.add(upperArm);

    const elbowJoint = createJointSphere(d.jointRadius * 0.85, jointMaterial);
    elbowJoint.position.set(0, -d.upperArmLength, 0);
    upperArm.add(elbowJoint);

    const lowerArmName = `lowerArm_${side}` as BoneName;
    const lowerArm = createLimbBone(lowerArmName, d.lowerArmLength, d.armRadius * 0.85, bodyMaterial);
    lowerArm.position.set(0, -d.upperArmLength, 0);
    upperArm.add(lowerArm);

    const handMesh = createJointSphere(d.handRadius, bodyMaterial);
    handMesh.position.set(0, -d.lowerArmLength, 0);
    lowerArm.add(handMesh);
  }

  // Legs
  for (const { side, sign } of sides) {
    const hipJointPosition = new THREE.Vector3((d.hipWidth / 2) * sign, -d.pelvisSize[1] / 2, 0);

    const hipJoint = createJointSphere(d.jointRadius, jointMaterial);
    hipJoint.position.copy(hipJointPosition);
    hips.add(hipJoint);

    const upperLegName = `upperLeg_${side}` as BoneName;
    const upperLeg = createLimbBone(upperLegName, d.upperLegLength, d.legRadius, bodyMaterial);
    upperLeg.position.copy(hipJointPosition);
    hips.add(upperLeg);

    const kneeJoint = createJointSphere(d.jointRadius * 0.9, jointMaterial);
    kneeJoint.position.set(0, -d.upperLegLength, 0);
    upperLeg.add(kneeJoint);

    const lowerLegName = `lowerLeg_${side}` as BoneName;
    const lowerLeg = createLimbBone(lowerLegName, d.lowerLegLength, d.legRadius * 0.85, bodyMaterial);
    lowerLeg.position.set(0, -d.upperLegLength, 0);
    upperLeg.add(lowerLeg);

    const footName = `foot_${side}` as BoneName;
    const foot = new THREE.Group();
    foot.name = footName;
    foot.userData.bone = footName;
    foot.position.set(0, -d.lowerLegLength, 0);
    lowerLeg.add(foot);

    const footMesh = new THREE.Mesh(new THREE.BoxGeometry(...d.footSize), bodyMaterial);
    footMesh.position.set(0, -d.footSize[1] / 2, d.footSize[2] / 2 - d.legRadius);
    footMesh.castShadow = true;
    footMesh.receiveShadow = true;
    foot.add(footMesh);
  }

  return { root };
}

// Viewerからは非同期のロードとして扱う。実際は同期生成だが、将来glTF等の
// 実ファイル読み込みに差し替えても呼び出し側のインターフェースが変わらないようにするため、
// また失敗時の再読み込みUI（docs/05, docs/12）と挙動を揃えるためPromise化している。
export function loadMannequin(): Promise<MannequinModel> {
  return new Promise((resolve, reject) => {
    try {
      const model = createMannequin();
      resolve(model);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('モデルの読み込みに失敗しました'));
    }
  });
}
