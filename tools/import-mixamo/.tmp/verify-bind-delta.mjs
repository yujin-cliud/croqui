// ブラウザに頼らず、実際のPoseApplier/FootIKと同じロジックをNode上で再現して
// bind×delta方式が idle_001 で足の沈み込みを解消するか検証する。
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

const GLB_PATH = process.argv[2] ?? 'public/models/mannequin.glb';
const POSE_PATH = process.argv[3] ?? 'src/data/poses/idle_001.json';

const io = new NodeIO();
const doc = await io.read(GLB_PATH);
const root = doc.getRoot();
const allNodes = root.listNodes();

// GLTFLoaderと同じくノード名からピリオドを除去する
const stripDots = (name) => (name ?? '').replace(/\./g, '');

const nodeToObj = new Map();
for (const n of allNodes) {
  const obj = new THREE.Object3D();
  obj.name = stripDots(n.getName());
  const t = n.getTranslation();
  const q = n.getRotation();
  const s = n.getScale();
  obj.position.set(t[0], t[1], t[2]);
  obj.quaternion.set(q[0], q[1], q[2], q[3]);
  obj.scale.set(s[0], s[1], s[2]);
  nodeToObj.set(n, obj);
}
for (const n of allNodes) {
  for (const c of n.listChildren()) {
    nodeToObj.get(n).add(nodeToObj.get(c));
  }
}
const sceneRoot = new THREE.Object3D();
for (const scene of root.listScenes()) {
  for (const n of scene.listChildren()) {
    sceneRoot.add(nodeToObj.get(n));
  }
}

// ModelLoader.tsのGLB_BONE_NAME_MAPと同一
const GLB_BONE_NAME_MAP = {
  hips: 'rootx',
  spine: 'spine_01x',
  chest: 'spine_03x',
  head: 'headx',
  upperArm_L: 'arm_stretchl',
  lowerArm_L: 'forearm_stretchl',
  hand_L: 'handl',
  upperArm_R: 'arm_stretchr',
  lowerArm_R: 'forearm_stretchr',
  hand_R: 'handr',
  upperLeg_L: 'thigh_stretchl',
  lowerLeg_L: 'leg_stretchl',
  foot_L: 'footl',
  upperLeg_R: 'thigh_stretchr',
  lowerLeg_R: 'leg_stretchr',
  foot_R: 'footr',
};
const nameToBoneName = new Map(Object.entries(GLB_BONE_NAME_MAP).map(([k, v]) => [v, k]));

// BoneMapper.buildBoneMapと同一(userData.bindの保存を含む)
const boneMap = {};
sceneRoot.traverse((obj) => {
  const boneName = nameToBoneName.get(obj.name);
  if (boneName) {
    obj.userData.bind = obj.quaternion.clone();
    boneMap[boneName] = obj;
  }
});
sceneRoot.updateMatrixWorld(true);

const missing = Object.keys(GLB_BONE_NAME_MAP).filter((k) => !boneMap[k]);
if (missing.length > 0) {
  console.error('見つからないボーン:', missing);
  process.exit(1);
}

const pose = JSON.parse(readFileSync(POSE_PATH, 'utf-8'));
console.log(`=== pose: ${pose.id} ===`);

// PoseApplier.applyPoseのFKループと同一(bind × delta)
const IDENTITY_Q = new THREE.Quaternion();
const BONE_NAMES = Object.keys(GLB_BONE_NAME_MAP);
for (const boneName of BONE_NAMES) {
  const bone = boneMap[boneName];
  const bind = bone.userData.bind ?? IDENTITY_Q;
  const boneData = pose.bones[boneName];
  const delta = boneData
    ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...boneData.rotation))
    : IDENTITY_Q;
  bone.quaternion.copy(bind).multiply(delta);
}
sceneRoot.updateMatrixWorld(true);

const v = () => new THREE.Vector3();
console.log('--- FK直後(FootIK前) ---');
console.log('hips.position', boneMap.hips.position.toArray());
console.log('footL world', boneMap.foot_L.getWorldPosition(v()).toArray());
console.log('footR world', boneMap.foot_R.getWorldPosition(v()).toArray());

// FootIK.applyFootIKと同一ロジック
const DOWN = new THREE.Vector3(0, -1, 0);
const ANKLE_HEIGHT = 0.05;
const PLANT_THRESHOLD = 0.10;

function solveLegIK(side, target) {
  const upperLeg = boneMap[`upperLeg_${side}`];
  const lowerLeg = boneMap[`lowerLeg_${side}`];
  const foot = boneMap[`foot_${side}`];
  const parent = upperLeg.parent;

  const footWorldQ = foot.getWorldQuaternion(new THREE.Quaternion());
  const L1 = lowerLeg.position.length();
  const L2 = foot.position.length();
  const S = upperLeg.getWorldPosition(v());
  const kneeHint = lowerLeg.getWorldPosition(v());

  const n = target.clone().sub(S);
  const dist = THREE.MathUtils.clamp(n.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  n.normalize();
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));

  const pole = kneeHint.sub(S);
  pole.addScaledVector(n, -pole.dot(n));
  if (pole.lengthSq() < 1e-8) {
    pole.set(0, 0, 1).addScaledVector(n, -n.z);
    if (pole.lengthSq() < 1e-8) pole.set(1, 0, 0).addScaledVector(n, -n.x);
  }
  pole.normalize();

  const knee = S.clone().addScaledVector(n, a).addScaledVector(pole, h);

  const dir1 = knee.clone().sub(S).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(DOWN, dir1);
  const parentInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  upperLeg.quaternion.copy(parentInv.multiply(q1));
  upperLeg.updateWorldMatrix(true, false);

  const dir2 = target.clone().sub(knee).normalize();
  const q2 = new THREE.Quaternion().setFromUnitVectors(DOWN, dir2);
  const upperInv = upperLeg.getWorldQuaternion(new THREE.Quaternion()).invert();
  lowerLeg.quaternion.copy(upperInv.multiply(q2));
  lowerLeg.updateWorldMatrix(true, false);

  const lowerInvW = lowerLeg.getWorldQuaternion(new THREE.Quaternion()).invert();
  foot.quaternion.copy(lowerInvW.multiply(footWorldQ));
  foot.updateWorldMatrix(true, false);
}

function applyFootIK() {
  const hips = boneMap.hips;
  const footL = boneMap.foot_L;
  const footR = boneMap.foot_R;

  const ud = hips.userData;
  if (ud.baseY === undefined) ud.baseY = hips.position.y;
  hips.position.y = ud.baseY;

  if (pose.noFootIk) {
    hips.updateWorldMatrix(true, true);
    return;
  }

  hips.updateWorldMatrix(true, true);

  const lowest = Math.min(footL.getWorldPosition(v()).y, footR.getWorldPosition(v()).y);
  hips.position.y += ANKLE_HEIGHT - lowest;
  hips.updateWorldMatrix(true, true);

  for (const side of ['L', 'R']) {
    const foot = side === 'L' ? footL : footR;
    const p = foot.getWorldPosition(v());
    if (p.y > ANKLE_HEIGHT + PLANT_THRESHOLD) continue;
    solveLegIK(side, new THREE.Vector3(p.x, ANKLE_HEIGHT, p.z));
  }
}

applyFootIK();

console.log('--- FootIK後 ---');
console.log('hips.position', boneMap.hips.position.toArray());
console.log('footL world', boneMap.foot_L.getWorldPosition(v()).toArray());
console.log('footR world', boneMap.foot_R.getWorldPosition(v()).toArray());
console.log('headx world', boneMap.head.getWorldPosition(v()).toArray());
