#!/usr/bin/env node
/**
 * import-mixamo.mjs — Mixamo FBX を Croqui の Pose JSON に変換するビルドタイムツール
 *
 * 使い方:
 *   tools/import-mixamo/mixamo-src/<タグ名>/ に Mixamo の FBX を置く
 *   npm run import:poses            … 各アニメの中間フレームを1ポーズとして抽出
 *   npm run import:poses -- --frames 3   … 各アニメから均等に3ポーズ抽出
 *
 * 出力:
 *   src/data/poses/<id>.json        … Croqui 標準の Pose 形式(既存と同じ)
 *   src/data/poses/pose-index.json  … 追記更新(既存エントリの name/tags/thumbnail の手動編集は保持)
 *
 * 設計メモ:
 *   - ランタイムには一切手を入れない。アプリから見れば「ポーズJSONが増えただけ」。
 *     docs/06(ポーズはJSON管理・APIなし)と docs/11(オフラインPWA)をそのまま満たす。
 *   - Mixamo(mixamorig:* 52本)→ マネキン(14本)へのリターゲットは2方式の併用:
 *       [Δ方式]   胴体・頭・脚: レスト姿勢が両者とも「直立」なので、
 *                 ワールド回転の差分 q_anim * q_rest⁻¹ をそのまま移植できる
 *       [方向方式] 腕: Mixamo は T ポーズ・マネキンは腕を下ろした姿勢でレストが違うため、
 *                 「肩→肘」「肘→手首」のワールド方向ベクトルに -Y 軸を向ける回転を解く
 *   - 左右対応はボーン名でなくレスト時のワールドX座標で決める(マネキンの _R は +X 側)。
 *     見た目の空間配置がそのまま一致する(鏡像にならない)。
 *   - [接触IK/フェーズ①] 手が胴(腰)に触れているポーズは、手首の目標点を pose.ik に焼く。
 *     角度FKだけでは接触位置を保証できないため、実行時に腕2ボーンIKでこの点へ届かせる。
 *     目標は「Mixamoの手ワールド座標」を直接使わず、hipsローカルに移して体長で正規化し、
 *     さらにマネキンの腰表面(楕円断面)へスナップする。詳細は solveHandContacts を参照。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_DIR = path.join(ROOT, 'tools', 'import-mixamo', 'mixamo-src');
const POSES_DIR = path.join(ROOT, 'src', 'data', 'poses');
const INDEX_PATH = path.join(POSES_DIR, 'pose-index.json');
const TMP_DIR = path.join(ROOT, 'tools', 'import-mixamo', '.tmp');

const FBX2GLTF = path.join(
  ROOT, 'node_modules', 'fbx2gltf', 'bin',
  { linux: 'Linux', darwin: 'Darwin', win32: 'Windows_NT' }[process.platform],
  process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF'
);

const args = process.argv.slice(2);
const FRAMES = Math.max(1, parseInt(args[args.indexOf('--frames') + 1], 10) || 1);
const FORCE = args.includes('--force');
const ROTATION_EPSILON = 0.005; // これ未満の回転は「初期姿勢」とみなし JSON から省く(rad)

/* ================================================================
 * glTF スケルトンのサンプリング
 * ============================================================== */

/** glTF Document → { nodes, parents, channels } の素朴な木構造に変換 */
function buildSkeleton(doc) {
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const index = new Map(nodes.map((n, i) => [n, i]));
  const parents = new Array(nodes.length).fill(-1);
  for (const node of nodes) {
    for (const child of node.listChildren()) {
      parents[index.get(child)] = index.get(node);
    }
  }
  const anim = root.listAnimations()[0];
  if (!anim) throw new Error('アニメーションが含まれていません');

  const channels = anim.listChannels().map((ch) => {
    const sampler = ch.getSampler();
    return {
      nodeIndex: index.get(ch.getTargetNode()),
      path: ch.getTargetPath(), // 'translation' | 'rotation' | 'scale'
      times: sampler.getInput().getArray(),
      values: sampler.getOutput().getArray(),
    };
  });
  const duration = Math.max(...channels.map((c) => c.times[c.times.length - 1]));
  return { nodes, parents, channels, duration };
}

/** キーフレーム列を時刻 t で線形補間(回転は slerp) */
function sampleChannel(channel, t) {
  const { times, values, path: p } = channel;
  const stride = p === 'rotation' ? 4 : 3;
  let i = 0;
  while (i < times.length - 1 && times[i + 1] < t) i++;
  const j = Math.min(i + 1, times.length - 1);
  const span = times[j] - times[i];
  const alpha = span > 0 ? (t - times[i]) / span : 0;
  const a = values.slice(i * stride, i * stride + stride);
  const b = values.slice(j * stride, j * stride + stride);
  if (p === 'rotation') {
    const qa = new THREE.Quaternion(...a);
    const qb = new THREE.Quaternion(...b);
    return qa.slerp(qb, alpha);
  }
  return new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), alpha);
}

/** 全ノードのワールド行列を計算。t === null ならレスト姿勢 */
function computeWorld(skeleton, t) {
  const { nodes, parents, channels } = skeleton;
  const locals = nodes.map((n) => ({
    position: new THREE.Vector3(...n.getTranslation()),
    quaternion: new THREE.Quaternion(...n.getRotation()),
    scale: new THREE.Vector3(...n.getScale()),
  }));
  if (t !== null) {
    for (const ch of channels) {
      const v = sampleChannel(ch, t);
      if (ch.path === 'rotation') locals[ch.nodeIndex].quaternion.copy(v);
      else if (ch.path === 'translation') locals[ch.nodeIndex].position.copy(v);
      else if (ch.path === 'scale') locals[ch.nodeIndex].scale.copy(v);
    }
  }
  const world = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const m = new THREE.Matrix4().compose(locals[i].position, locals[i].quaternion, locals[i].scale);
    world[i] = parents[i] >= 0 ? new THREE.Matrix4().multiplyMatrices(world[parents[i]], m) : m;
  }
  return world.map((m) => {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(position, quaternion, scale);
    return { position, quaternion };
  });
}

/* ================================================================
 * リターゲット: mixamorig(52本) → Croqui マネキン(14本)
 * ============================================================== */

/** "mixamorig:Hips" / "mixamorig1:Hips" 等の揺れを吸収してノード index を引く */
function findBone(skeleton, shortName) {
  const i = skeleton.nodes.findIndex((n) => {
    const name = n.getName() ?? '';
    return name === shortName || name.endsWith(`:${shortName}`) || name.endsWith(`_${shortName}`);
  });
  if (i < 0) throw new Error(`ボーンが見つかりません: ${shortName}`);
  return i;
}

/** レスト時ワールドXで Mixamo の Left/Right → マネキンの _L(-X)/_R(+X) を決める */
function resolveSides() {
  // ARPリグは解剖学的に素直な対応(hand_R ← RightHand)。MX_BONEも全ボーン
  // Left→_L / Right→_R で写しているため、接触検出も同じ対応で測る。
  // (旧・木製マネキンは _R=+X の空間対応で Left/Right を入れ替えていた)
  return { L: 'Left', R: 'Right' };
}

const DOWN = new THREE.Vector3(0, -1, 0); // マネキンの手足はローカル -Y 方向に伸びる
const ARP_BIND_WORLD = {
  hips: [0.000000, -0.000001, 0.000000, 1.000000],
  spine: [-0.048077, 0.000000, 0.000000, 0.998844],
  chest: [-0.037888, -0.000000, -0.000000, 0.999282],
  head: [0.000000, -0.000000, -0.000000, 1.000000],
  neck: [0.174305, -0.000000, -0.000000, 0.984692],
  shoulder_L: [0.500481, 0.500481, 0.499518, -0.499518],
  shoulder_R: [-0.500481, 0.500481, 0.499518, 0.499518],
  upperArm_L: [0.748948, 0.557089, 0.241883, -0.264995],
  lowerArm_L: [0.632084, 0.686872, 0.286943, -0.215268],
  hand_L: [0.541011, 0.475351, 0.533459, -0.443587],
  upperArm_R: [0.748967, -0.557110, -0.241822, -0.264950],
  lowerArm_R: [-0.632084, 0.686872, 0.286943, 0.215268],
  hand_R: [0.541011, -0.475351, -0.533459, -0.443587],
  upperLeg_L: [0.735120, 0.013826, 0.677766, -0.006384],
  lowerLeg_L: [0.734885, -0.023169, 0.676587, -0.040468],
  foot_L: [0.039662, 0.526549, 0.848863, -0.024602],
  upperLeg_R: [0.735120, -0.013826, -0.677766, -0.006384],
  lowerLeg_R: [0.734885, 0.023169, -0.676587, -0.040468],
  foot_R: [-0.039662, 0.526549, 0.848863, 0.024602],
  // 指(実GLB実測値)
  thumb1_L: [-0.173445, 0.323687, 0.819848, -0.439309],
  thumb2_L: [-0.137928, 0.253163, 0.840846, -0.458108],
  thumb3_L: [-0.183899, 0.350034, 0.813118, -0.427195],
  index1_L: [0.531686, 0.484580, 0.575015, -0.389680],
  index2_L: [0.566322, 0.442440, 0.571837, -0.395637],
  index3_L: [0.565747, 0.443230, 0.571114, -0.396618],
  middle1_L: [0.553729, 0.460027, 0.534734, -0.442515],
  middle2_L: [0.583421, 0.419588, 0.556752, -0.416645],
  middle3_L: [0.576203, 0.429339, 0.566010, -0.404093],
  ring1_L: [0.599843, 0.397563, 0.496710, -0.485191],
  ring2_L: [0.612224, 0.376014, 0.531468, -0.448706],
  ring3_L: [0.599221, 0.397274, 0.527427, -0.452690],
  pinky1_L: [-0.633559, -0.340527, -0.468098, 0.513350],
  pinky2_L: [0.636285, 0.333676, 0.500110, -0.483417],
  pinky3_L: [0.626170, 0.352811, 0.503507, -0.479496],
  thumb1_R: [0.173445, 0.323687, 0.819848, 0.439308],
  thumb2_R: [0.137928, 0.253163, 0.840846, 0.458108],
  thumb3_R: [0.183899, 0.350034, 0.813118, 0.427195],
  index1_R: [-0.531686, 0.484580, 0.575015, 0.389680],
  index2_R: [-0.566322, 0.442440, 0.571837, 0.395637],
  index3_R: [-0.565747, 0.443230, 0.571114, 0.396618],
  middle1_R: [0.553729, -0.460027, -0.534734, -0.442515],
  middle2_R: [0.583421, -0.419588, -0.556752, -0.416645],
  middle3_R: [0.576203, -0.429339, -0.566010, -0.404093],
  ring1_R: [0.599843, -0.397563, -0.496710, -0.485191],
  ring2_R: [0.612224, -0.376014, -0.531468, -0.448707],
  ring3_R: [0.599221, -0.397274, -0.527427, -0.452690],
  pinky1_R: [-0.633559, 0.340527, 0.468098, 0.513350],
  pinky2_R: [0.636285, -0.333676, -0.500110, -0.483417],
  pinky3_R: [0.626170, -0.352811, -0.503507, -0.479496],
};
// ★ モデル別の自動較正データ。main()がモデルごとに loadModelCalib() で設定する。
// 未設定時はハードコードのARP_BIND_WORLD(標準ボディの実測値)にフォールバック。
let CALIB = null;
const arpBindWorld = (role) => CALIB
  ? CALIB.bind[role].clone()
  : new THREE.Quaternion(...ARP_BIND_WORLD[role]);

// Croquiのrole → GLBボーン名(ピリオド除去後)。ModelLoader.tsのGLB_BONE_NAME_MAPと同一。
const ROLE_GLB = {
  hips: 'rootx', spine: 'spine_01x', chest: 'spine_03x', head: 'headx', neck: 'neckx',
  shoulder_L: 'shoulderl', shoulder_R: 'shoulderr',
  upperArm_L: 'arm_stretchl', lowerArm_L: 'forearm_stretchl', hand_L: 'handl',
  upperArm_R: 'arm_stretchr', lowerArm_R: 'forearm_stretchr', hand_R: 'handr',
  upperLeg_L: 'thigh_stretchl', lowerLeg_L: 'leg_stretchl', foot_L: 'footl',
  upperLeg_R: 'thigh_stretchr', lowerLeg_R: 'leg_stretchr', foot_R: 'footr',
};
for (const side of ['L', 'R']) {
  for (const fg of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    for (let j = 1; j <= 3; j++) ROLE_GLB[`${fg}${j}_${side}`] = `${fg}${j}${side.toLowerCase()}`;
  }
}

// 「上」「前」の2方向から正規直交基底の回転を作る(指リターゲットの手の基底用)
function basisFrom(dirIndexMeta, dirRingMeta, dirMiddleMeta) {
  const y = dirMiddleMeta.clone().normalize();
  let z = new THREE.Vector3().crossVectors(dirIndexMeta, dirRingMeta).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  z = new THREE.Vector3().crossVectors(x, y).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// モデルGLBから較正データを自動実測する:
//  bind    = 各roleのバインドworld回転(bind×deltaの基準)
//  handBasis = 手の解剖学的基底(指リターゲットのフレーム対応用)
//  mannequin = 腰まわりの寸法(腰に手IKの目標スナップ用)
async function loadModelCalib(io, glbPath) {
  const doc = await io.read(glbPath);
  const nodes = doc.getRoot().listNodes();
  const par = new Array(nodes.length).fill(-1);
  for (const n of nodes) for (const c of n.listChildren()) par[nodes.indexOf(c)] = nodes.indexOf(n);
  const order = [];
  {
    const seen = new Array(nodes.length).fill(false);
    const vis = (i) => { if (seen[i]) return; if (par[i] >= 0) vis(par[i]); seen[i] = true; order.push(i); };
    for (let i = 0; i < nodes.length; i++) vis(i);
  }
  const W = new Array(nodes.length);
  for (const i of order) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...nodes[i].getTranslation()),
      new THREE.Quaternion(...nodes[i].getRotation()),
      new THREE.Vector3(...nodes[i].getScale()));
    W[i] = par[i] >= 0 ? new THREE.Matrix4().multiplyMatrices(W[par[i]], m) : m;
  }
  const wq = (i) => { const q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(); W[i].decompose(p, q, sc); return q; };
  const wp = (i) => new THREE.Vector3().setFromMatrixPosition(W[i]);
  // role→ノード: 完全一致→先頭c_剥がし の2パス(ModelLoader.tsと同じ規則)
  const roleOf = new Map(Object.entries(ROLE_GLB).map(([r, g]) => [g, r]));
  const idxOf = {};
  const assigned = new Set();
  for (let pass = 0; pass < 2; pass++) {
    nodes.forEach((n, i) => {
      const san = (n.getName() || '').replace(/\./g, '');
      const key = pass === 0 ? san : san.replace(/^c_/, '');
      const role = roleOf.get(key);
      if (role && !assigned.has(role)) { idxOf[role] = i; assigned.add(role); }
    });
  }
  // 四肢の付け根role(upperArm/upperLeg)の解決: 候補のうち「他方の先祖にいる骨」が真の関節。
  // (ARPの流儀A: arm_stretch=肩関節・twistは同位置の子 / 流儀B: c_arm_twist_offset=肩関節・stretchは先半分)
  const isAncestor = (a, b) => { let p = par[b]; while (p >= 0) { if (p === a) return true; p = par[p]; } return false; };
  const sanIdx = new Map();
  nodes.forEach((n, i) => { const k = (n.getName() || '').replace(/\./g, '').replace(/^c_/, ''); if (!sanIdx.has(k)) sanIdx.set(k, i); });
  const pickRoot = (names) => {
    const cands = names.map((n) => sanIdx.get(n)).filter((i) => i != null);
    if (cands.length <= 1) return cands[0];
    for (const c of cands) if (cands.every((o) => o === c || isAncestor(c, o))) return c;
    return cands[0];
  };
  for (const sside of ['l', 'r']) {
    const S = sside.toUpperCase();
    const arm = pickRoot([`arm_stretch${sside}`, `arm_twist_offset${sside}`, `arm_twist${sside}`]);
    if (arm != null) idxOf[`upperArm_${S}`] = arm;
    const leg = pickRoot([`thigh_stretch${sside}`, `thigh_twist${sside}`]);
    if (leg != null) idxOf[`upperLeg_${S}`] = leg;
  }
  const missing = Object.keys(ROLE_GLB).filter((r) => !(r in idxOf));
  if (missing.length) throw new Error(`モデルにボーンが足りません(${path.basename(glbPath)}): ${missing.join(', ')}`);
  const bind = {};
  for (const role of Object.keys(ROLE_GLB)) bind[role] = wq(idxOf[role]);
  // 手の基底(左右)
  const handBasis = {};
  for (const side of ['L', 'R']) {
    const h = wp(idxOf[`hand_${side}`]);
    const d = (r) => wp(idxOf[r]).clone().sub(h).normalize().applyQuaternion(wq(idxOf[`hand_${side}`]).clone().invert());
    handBasis[side] = basisFrom(d(`index1_${side}`), d(`ring1_${side}`), d(`middle1_${side}`));
  }
  // 腰まわり寸法(最大スキンメッシュの断面から実測)
  const rootP = wp(idxOf.hips);
  const headP = wp(idxOf.head);
  const hipsToHead = headP.clone().sub(rootP).length();
  let mainPrim = null, mainNode = null, maxV = 0;
  for (const n of nodes) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    for (const p of mesh.listPrimitives()) {
      if (!p.getAttribute('JOINTS_0')) continue;
      const c = p.getAttribute('POSITION')?.getCount() ?? 0;
      if (c > maxV) { maxV = c; mainPrim = p; mainNode = n; }
    }
  }
  const mannequin = {
    hipsToHead, handRadius: 0.04,
    pelvisHalfWidth: 0.178, pelvisHalfDepth: 0.148,
    waistHalfWidth: 0.153, waistHalfDepth: 0.138,
    pelvisY: 0.0, waistY: 0.3 * hipsToHead,
  };
  if (mainPrim && mainNode) {
    const mw = W[nodes.indexOf(mainNode)];
    const POS = mainPrim.getAttribute('POSITION').getArray();
    const nV = mainPrim.getAttribute('POSITION').getCount();
    const slice = (yl) => {
      const y = rootP.y + yl;
      let hw = 0, hd = 0;
      const v3 = new THREE.Vector3();
      for (let v = 0; v < nV; v++) {
        v3.set(POS[v * 3], POS[v * 3 + 1], POS[v * 3 + 2]).applyMatrix4(mw);
        if (Math.abs(v3.y - y) > 0.012) continue;
        const px = v3.x - rootP.x, pz = v3.z - rootP.z;
        if (Math.abs(px) > 0.3 || Math.abs(pz) > 0.25) continue; // 腕等を除外
        hw = Math.max(hw, Math.abs(px)); hd = Math.max(hd, Math.abs(pz));
      }
      return { hw, hd };
    };
    const pel = slice(mannequin.pelvisY);
    const wst = slice(mannequin.waistY);
    if (pel.hw > 0.03) { mannequin.pelvisHalfWidth = pel.hw; mannequin.pelvisHalfDepth = pel.hd; }
    if (wst.hw > 0.03) { mannequin.waistHalfWidth = wst.hw; mannequin.waistHalfDepth = wst.hd; }
  }
  // 腕のレスト垂れ角の正規化。腕の変換(共通Tレスト方式)は「モデルのバインドの腕の
  // 垂れ具合」がそのまま結果に乗る。実績のある標準ボディの垂れ角を基準(アンカー)とし、
  // 各モデルの腕バインド方向をアンカーへ揃える補正回転を較正しておく。
  // (標準・女性は垂れが基準と同等で補正ほぼ0。male2のように垂れの深いバインドだけ起こされる)
  const ARM_ANCHOR = {
    L: { upper: new THREE.Vector3(0.9627, -0.2389, -0.1274), fore: new THREE.Vector3(0.9919, 0.0363, 0.1221) },
    R: { upper: new THREE.Vector3(-0.9627, -0.2389, -0.1274), fore: new THREE.Vector3(-0.9919, 0.0363, 0.1221) },
  };
  const armFix = {};
  for (const side of ['L', 'R']) {
    const shP = wp(idxOf[`upperArm_${side}`]);
    const elP = wp(idxOf[`lowerArm_${side}`]);
    const haP = wp(idxOf[`hand_${side}`]);
    const dU = elP.clone().sub(shP).normalize();
    const dF = haP.clone().sub(elP).normalize();
    armFix[side] = {
      upper: new THREE.Quaternion().setFromUnitVectors(dU, ARM_ANCHOR[side].upper.clone().normalize()),
      fore: new THREE.Quaternion().setFromUnitVectors(dF, ARM_ANCHOR[side].fore.clone().normalize()),
    };
  }
  return { bind, handBasis, mannequin, armFix };
}

const MX_BONE = {
  hips: 'Hips', spine: 'Spine', chest: 'Spine2', head: 'Head',
  neck: 'Neck', shoulder_L: 'LeftShoulder', shoulder_R: 'RightShoulder',
  upperArm_L: 'LeftArm', lowerArm_L: 'LeftForeArm', hand_L: 'LeftHand',
  upperArm_R: 'RightArm', lowerArm_R: 'RightForeArm', hand_R: 'RightHand',
  upperLeg_L: 'LeftUpLeg',  lowerLeg_L: 'LeftLeg',  foot_L: 'LeftFoot',
  upperLeg_R: 'RightUpLeg', lowerLeg_R: 'RightLeg', foot_R: 'RightFoot',
  // 指
  thumb1_L: 'LeftHandThumb1', thumb2_L: 'LeftHandThumb2', thumb3_L: 'LeftHandThumb3',
  index1_L: 'LeftHandIndex1', index2_L: 'LeftHandIndex2', index3_L: 'LeftHandIndex3',
  middle1_L: 'LeftHandMiddle1', middle2_L: 'LeftHandMiddle2', middle3_L: 'LeftHandMiddle3',
  ring1_L: 'LeftHandRing1', ring2_L: 'LeftHandRing2', ring3_L: 'LeftHandRing3',
  pinky1_L: 'LeftHandPinky1', pinky2_L: 'LeftHandPinky2', pinky3_L: 'LeftHandPinky3',
  thumb1_R: 'RightHandThumb1', thumb2_R: 'RightHandThumb2', thumb3_R: 'RightHandThumb3',
  index1_R: 'RightHandIndex1', index2_R: 'RightHandIndex2', index3_R: 'RightHandIndex3',
  middle1_R: 'RightHandMiddle1', middle2_R: 'RightHandMiddle2', middle3_R: 'RightHandMiddle3',
  ring1_R: 'RightHandRing1', ring2_R: 'RightHandRing2', ring3_R: 'RightHandRing3',
  pinky1_R: 'RightHandPinky1', pinky2_R: 'RightHandPinky2', pinky3_R: 'RightHandPinky3',
};
// 腕のレスト差補正用: idle FBX(Tポーズ)の腕レスト回転。
const MIXAMO_TPOSE_REST = {
  shoulder_L: [-0.5264, -0.4192, 0.5800, -0.4590],
  shoulder_R: [0.5282, -0.4178, 0.5784, 0.4603],
  upperArm_L: [-0.5097, -0.4403, 0.5851, -0.4517],
  lowerArm_L: [0.4814, 0.4637, -0.5076, 0.5437],
  hand_L:     [-0.4950, -0.4756, 0.5695, -0.4521],
  upperArm_R: [0.5078, -0.4435, 0.5867, 0.4487],
  lowerArm_R: [0.4833, -0.4618, 0.5057, 0.5453],
  hand_R:     [0.4891, -0.4680, 0.5781, 0.4557],
};
/**
 * 1フレーム分のリターゲットを解く。
 * 返り値: { boneName: THREE.Euler(XYZ) } — PoseApplier がそのまま適用できるローカル回転
 */
// ARP階層(親子関係)。ローカルデルタ計算に使う。
const ARP_PARENT = {
  hips: null, spine: 'hips', chest: 'spine', head: 'neck',
  neck: 'chest', shoulder_L: 'chest', shoulder_R: 'chest',
  upperArm_L: 'shoulder_L', lowerArm_L: 'upperArm_L', hand_L: 'lowerArm_L',
  upperArm_R: 'shoulder_R', lowerArm_R: 'upperArm_R', hand_R: 'lowerArm_R',
  upperLeg_L: 'hips', lowerLeg_L: 'upperLeg_L', foot_L: 'lowerLeg_L',
  upperLeg_R: 'hips', lowerLeg_R: 'upperLeg_R', foot_R: 'lowerLeg_R',
  // 指(role階層。GLBの*_base中手骨は未駆動でバインド維持=role親hand換算で整合)
  thumb1_L: 'hand_L', thumb2_L: 'thumb1_L', thumb3_L: 'thumb2_L',
  index1_L: 'hand_L', index2_L: 'index1_L', index3_L: 'index2_L',
  middle1_L: 'hand_L', middle2_L: 'middle1_L', middle3_L: 'middle2_L',
  ring1_L: 'hand_L', ring2_L: 'ring1_L', ring3_L: 'ring2_L',
  pinky1_L: 'hand_L', pinky2_L: 'pinky1_L', pinky3_L: 'pinky2_L',
  thumb1_R: 'hand_R', thumb2_R: 'thumb1_R', thumb3_R: 'thumb2_R',
  index1_R: 'hand_R', index2_R: 'index1_R', index3_R: 'index2_R',
  middle1_R: 'hand_R', middle2_R: 'middle1_R', middle3_R: 'middle2_R',
  ring1_R: 'hand_R', ring2_R: 'ring1_R', ring3_R: 'ring2_R',
  pinky1_R: 'hand_R', pinky2_R: 'pinky1_R', pinky3_R: 'pinky2_R',
};

/**
 * 1フレーム分のリターゲット(新方式: ARPバインド基準の bind×delta)。
 * 返り値: { boneName: THREE.Euler(XYZ) } — PoseApplier が bind×delta で使うローカルデルタ。
 */
function solveFrame(skeleton, restWorld, animWorld /* sides は未使用 */) {
  const B = (name) => findBone(skeleton, name);

  // 各ボーンの目標ワールド回転 = Mixamoのワールド差分 × ARPバインド向き
  const targetWorld = {};
  for (const role of Object.keys(ARP_PARENT)) {
    const i = B(MX_BONE[role]);
    // 腕は各FBX固有レストだとAポーズ差で開くため、共通Tポーズレストを使う。
    const restQ = MIXAMO_TPOSE_REST[role]
      ? new THREE.Quaternion(...MIXAMO_TPOSE_REST[role])
      : restWorld[i].quaternion;
    const mxDelta = animWorld[i].quaternion.clone()
      .multiply(restQ.clone().invert());
    // 腕(上腕/前腕/手)はモデルごとの腕レスト垂れ角の補正(armFix)を挟む。
    // バインドの腕が深く垂れたモデルでも、共通Tレスト基準と同じ土俵に乗る。
    let base = arpBindWorld(role);
    if (CALIB && CALIB.armFix) {
      const m = /^(upperArm|lowerArm|hand)_(L|R)$/.exec(role);
      if (m) {
        const fix = CALIB.armFix[m[2]];
        const q = m[1] === 'upperArm' ? fix.upper : fix.fore;
        base = q.clone().multiply(base);
      }
    }
    targetWorld[role] = mxDelta.multiply(base);
  }
  // 肩は胴(chest)に自然に追従させる(クラビクルの上下動は付けない)。
  // ワールド固定だと胴がねじれたポーズで肩が置いていかれ、その"置いていかれ"が
  // 上腕の見かけ上のねじれ(candy-wrapper)の正体だった。胴追従にすると上腕ねじれは
  // ほぼ0になり、肩の潰れ・なで肩・裂けが同時に解消する。follow調整は不要。
  for (const side of ['L', 'R']) {
    const key = `shoulder_${side}`;
    const bindLocalSh = arpBindWorld('chest').clone().invert().multiply(arpBindWorld(key));
    targetWorld[key] = targetWorld['chest'].clone().multiply(bindLocalSh);
  }
  // 手のひらのロール補正: ARPとMixamoの手ボーンの軸差で手のひらが正面を向くため、
  // 前腕の軸(ローカルY)まわりに補正回転を掛ける。角度は実機で調整する。
  const PALM_ROLL_DEG = 45; // ← 実機で調整する値(90→-90→180などを試す)
  const palmRoll = (sign) => new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), sign * PALM_ROLL_DEG * Math.PI / 180);
  for (const side of ['L', 'R']) {
    const fore = side === 'L' ? 'LeftForeArm' : 'RightForeArm';
    const hand = side === 'L' ? 'LeftHand' : 'RightHand';
    const wristLocal = animWorld[B(fore)].quaternion.clone().invert()
      .multiply(animWorld[B(hand)].quaternion);
    // 左右で回転方向が逆になるので sign を分ける
    const sign = side === 'L' ? 1 : -1;
    targetWorld[`hand_${side}`] = targetWorld[`lowerArm_${side}`].clone()
      .multiply(wristLocal).multiply(palmRoll(sign));
  }
  // 指: 方向ベース(aim)リターゲット。Mixamoの各指節の「向き」を手ローカルで取り、
  // 解剖学的な手の基底対応 M(実測定数)でARPの手ローカルへ写し、指ボーンの+Yを
  // その方向へ向ける(ロールは親から継承)。フレーム規約差の影響を受けず、
  // 拳の曲がり角がMixamoとほぼ一致する(実測誤差0〜3°)。
  // 手の基底対応M = ARPの手基底(モデル実測) × Mixamoの手基底(このFBXのレスト実測)^-1
  const FINGER_M = {};
  for (const side of ['L', 'R']) {
    const Side = side === 'L' ? 'Left' : 'Right';
    const h = restWorld[B(`${Side}Hand`)];
    const hq = h.quaternion.clone().invert();
    const d = (nm) => restWorld[B(nm)].position.clone().sub(h.position).normalize().applyQuaternion(hq);
    const mxBasis = basisFrom(d(`${Side}HandIndex1`), d(`${Side}HandRing1`), d(`${Side}HandMiddle1`));
    const arpBasis = CALIB ? CALIB.handBasis[side] : null;
    FINGER_M[side] = arpBasis
      ? arpBasis.clone().multiply(mxBasis.clone().invert())
      : (side === 'L'
        ? new THREE.Quaternion(0.043585, -0.999013, 0.002957, 0.007988)
        : new THREE.Quaternion(0.038067, 0.999142, 0.007200, 0.014617));
  }
  const FINGERS = [['thumb', 'Thumb'], ['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Pinky']];
  const PLUS_Y_AXIS = new THREE.Vector3(0, 1, 0);
  for (const side of ['L', 'R']) {
    const Side = side === 'L' ? 'Left' : 'Right';
    const handRole = `hand_${side}`;
    const mxHandInv = animWorld[B(`${Side}Hand`)].quaternion.clone().invert();
    for (const [fg, Fg] of FINGERS) {
      let parentRole = handRole;
      for (let j = 1; j <= 3; j++) {
        const role = `${fg}${j}_${side}`;
        // 「親に剛体追従」した場合の姿勢(ロールの基準)
        const baseline = targetWorld[parentRole].clone()
          .multiply(arpBindWorld(parentRole).clone().invert())
          .multiply(arpBindWorld(role));
        // Mixamoの指節方向(手ローカル)→ ARP手ローカル(M)→ ワールド。
        // 古いFBX(52ボーン)は指先tipボーンが無いことがある→その節は親に追従。
        let next = -1;
        try { next = B(`${Side}Hand${Fg}${j + 1}`); } catch { /* tipなし */ }
        if (next < 0) {
          targetWorld[role] = baseline;
        } else {
          const cur = B(`${Side}Hand${Fg}${j}`);
          const dir = animWorld[next].position.clone().sub(animWorld[cur].position)
            .normalize().applyQuaternion(mxHandInv)
            .applyQuaternion(FINGER_M[side])
            .applyQuaternion(targetWorld[handRole]);
          const y0 = PLUS_Y_AXIS.clone().applyQuaternion(baseline);
          const arc = new THREE.Quaternion().setFromUnitVectors(y0, dir);
          targetWorld[role] = arc.multiply(baseline);
        }
        parentRole = role;
      }
    }
  }

  // // 腕はレスト差が大きい(Mixamo=水平/ARP=斜め下)ので、delta方式だと開きすぎる。
  // // 肩→肘・肘→手首のワールド方向にARP腕ボーンの+Y軸を向けるaim方式で上書きする。
  // // (ARPの腕ボーンは+Y方向に伸びる。ひねりは捨てるがクロッキーでは問題ない)
  // const PLUS_Y = new THREE.Vector3(0, 1, 0);
  // const aim = (fromMx, toMx) => {
  //   const d = animWorld[B(toMx)].position.clone()
  //     .sub(animWorld[B(fromMx)].position).normalize();
  //   return new THREE.Quaternion().setFromUnitVectors(PLUS_Y, d);
  // };
  // targetWorld.upperArm_L = aim('LeftArm', 'LeftForeArm');
  // targetWorld.lowerArm_L = aim('LeftForeArm', 'LeftHand');
  // targetWorld.upperArm_R = aim('RightArm', 'RightForeArm');
  // targetWorld.lowerArm_R = aim('RightForeArm', 'RightHand');

  // ワールド目標 → ARP階層のローカルデルタ(PoseApplierの bind×delta 用)
  const eulers = {};
  for (const [role, parent] of Object.entries(ARP_PARENT)) {
    const parentTargetWorld = parent ? targetWorld[parent] : new THREE.Quaternion();
    const localTarget = parentTargetWorld.clone().invert().multiply(targetWorld[role]);

    const parentBindWorld = parent ? arpBindWorld(parent) : new THREE.Quaternion();
    const bindLocal = parentBindWorld.clone().invert().multiply(arpBindWorld(role));

    const delta = bindLocal.clone().invert().multiply(localTarget);
    if (delta.w < 0) { delta.x *= -1; delta.y *= -1; delta.z *= -1; delta.w *= -1; }
    eulers[role] = new THREE.Euler().setFromQuaternion(delta, 'XYZ');
  }

  // // 自己検証: euler→delta で targetWorld を再現できるか
  // for (const [role, parent] of Object.entries(ARP_PARENT)) {
  //   const delta = new THREE.Quaternion().setFromEuler(eulers[role]);
  //   const parentBindWorld = parent ? arpBindWorld(parent) : new THREE.Quaternion();
  //   const bindLocal = parentBindWorld.clone().invert().multiply(arpBindWorld(role));
  //   const localRebuilt = bindLocal.clone().multiply(delta);
  //   const parentTargetWorld = parent ? targetWorld[parent] : new THREE.Quaternion();
  //   const worldRebuilt = parentTargetWorld.clone().multiply(localRebuilt);
  //   const err = worldRebuilt.angleTo(targetWorld[role]);
  //   if (err > 1e-2) {
  //     throw new Error(`検証失敗: ${role} のワールド回転を再現できません (誤差 ${err.toFixed(6)} rad)`);
  //   }
  // }

  return eulers;
}

/* ================================================================
 * 接触IK ターゲット(フェーズ①)
 *   手が胴(腰)に触れているポーズを検出し、手首IKの目標点を pose.ik に焼く。
 *
 *   [判定] 接触してるか否かは "Mixamo 自身の身体" 基準で測る:
 *     - 本物の腰手ポーズは手が Mixamo 女性の"肉のある腰"に載る。これを細いマネキン腰から
 *       測ると 9cm ほど離れて見え(=浮きの正体)、マネキン基準だと誤って弾いてしまう。
 *     - そこで「手→最寄りの股関節(UpLeg)距離」を腕リーチで正規化して判定する。
 *       腰に載った手はこの比が小さく、空中/伸ばした手は大きい。体格差はリーチ正規化で吸収。
 *   [配置] 検出したら目標は "マネキン" 基準で置く:
 *     - 手を hips ローカル→マネキン尺へ写し、断面(x,z)を高さに応じた下胴の楕円面
 *       (低い=骨盤で広い / 高い=腰くびれで細い)+ handRadius へスナップする。
 *       → 手のひらが物理的に必ずマネキン腰へ触れる点になる(角度FKの"浮き"を根絶)。
 *   非接触ポーズは目標を焼かない。実行時IKは目標のある腕だけ動かすので従来のFK表示のまま。
 *
 *   ★ 数値は mannequin.ts の MANNEQUIN_DIMENSIONS が真実の出処。ここは必要値のミラー。
 *     mannequin.ts を変えたら下も合わせ、`npm run import:poses -- --force` で焼き直す。
 * ============================================================== */
const MANNEQUIN = {
  // ★ ARP解剖学ボディ(mannequin.glb)の実測値。メッシュ断面から採寸(rootxローカル)。
  hipsToHead: 0.657,       // rootx(hips)→headx のバインド距離。Mixamo体長との正規化スケール合わせ用
  handRadius: 0.04,        // 手首をこのぶん表面から離すと手のひらが面に乗る
  // 下胴の断面半径。低い所(骨盤)は広く、高い所(腰)は細い。高さで補間する。
  pelvisHalfWidth: 0.178,  // y=0.00 実測 |x|max
  pelvisHalfDepth: 0.148,  // y=0.00 実測 |z|max
  waistHalfWidth: 0.153,   // y=0.20 実測 |x|max
  waistHalfDepth: 0.138,   // y=0.20 実測 |z|max
  pelvisY: 0.00,
  waistY: 0.20,
};
// 接触判定のしきい値(実データで較正。ラベル付きポーズが増えたら要再調整)。
// 「腰に手を置く」動作の本質は "肘が曲がってる" こと。股関節への単純な近さだと、
// 前でだらんと下ろした手(股関節に近いが曲がってない)を誤って拾ってしまうため複合条件にする。
const CONTACT = {
  elbowMinDeg: 45,     // 肘がこれ以上曲がってる=手を能動的に置いている(下ろした手を除外)
  yMin: -0.15,         // 手の高さ(hipsローカル・マネキン尺)。骨盤〜腰の帯だけ拾う
  yMax: 0.30,          //   ↑頭上/肩上や、低く前で組む手を除外
  axisMaxRatio: 0.70,  // 手→胴中心軸の距離÷腕リーチ。伸ばしきった手を除外
};

/** 点pから線分ab への最短距離 */
function distToSeg(p, a, b) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
}

/** hips ローカルの高さ y における下胴の楕円半径(手のひらぶん外)を返す */
function waistEllipseAt(y) {
  const MQ = CALIB ? CALIB.mannequin : MANNEQUIN;
  const t = clamp01((y - MQ.pelvisY) / (MQ.waistY - MQ.pelvisY));
  const halfW = lerp(MQ.pelvisHalfWidth, MQ.waistHalfWidth, t);
  const halfD = lerp(MQ.pelvisHalfDepth, MQ.waistHalfDepth, t);
  return { ax: halfW + MQ.handRadius, az: halfD + MQ.handRadius };
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * 返り値: { hand_L?: [x,y,z], hand_R?: [x,y,z] }
 *   値は hips ローカル・マネキン尺の手首目標点。接触がなければキー自体を含めない。
 */
function solveHandContacts(skeleton, animWorld, sides) {
  const B = (name) => findBone(skeleton, name);
  const hips = animWorld[B('Hips')];
  const hipsPos = hips.position;
  const hipsQuatInv = hips.quaternion.clone().invert();
  const neckPos = animWorld[B('Neck')].position;
  const mixamoTorso = animWorld[B('Head')].position.clone().sub(hipsPos).length() || 1;
  const toMannequin = (CALIB ? CALIB.mannequin : MANNEQUIN).hipsToHead / mixamoTorso;
  // 検出(どの手を接触とみなすか)はモデルに依存させない。モデル尺で判定すると
  // 体型ごとに接触ポーズの集合が変わってしまう(例: 胴の短い体型で誤検出が増える)。
  // 固定の基準尺=標準ボディのhipsToHead(0.657)で判定し、配置だけモデル尺で行う。
  const DETECT_SCALE = 0.657 / mixamoTorso;

  const out = {};
  for (const side of ['L', 'R']) {
    const mx = sides[side];
    const armP = animWorld[B(`${mx}Arm`)].position;
    const foreP = animWorld[B(`${mx}ForeArm`)].position;
    const handP = animWorld[B(`${mx}Hand`)].position;

    // --- 接触判定(Mixamo 身体基準・複合条件) ---
    // (1) 肘の曲げ角。手を能動的に置いているか(下ろした手を除外)
    const v1 = foreP.clone().sub(armP).normalize();
    const v2 = handP.clone().sub(foreP).normalize();
    const elbowDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v1.dot(v2), -1, 1)));
    if (elbowDeg < CONTACT.elbowMinDeg) continue;

    // 手を hips ローカルへ(検出用=固定基準尺 / 配置用=モデル尺 の2本)
    const localRaw = handP.clone().sub(hipsPos).applyQuaternion(hipsQuatInv);
    const localDet = localRaw.clone().multiplyScalar(DETECT_SCALE);
    const local = localRaw.clone().multiplyScalar(toMannequin);

    // (2) 高さ帯(骨盤〜腰)。頭上/肩上や低く前で組む手を除外 ※固定基準尺で判定
    if (localDet.y < CONTACT.yMin || localDet.y > CONTACT.yMax) continue;

    // (3) 胴中心軸への近さ(腕リーチ正規化)。伸ばしきった手を除外
    const reach = armP.distanceTo(foreP) + foreP.distanceTo(handP);
    const axisRatio = distToSeg(handP, hipsPos, neckPos) / reach;
    if (axisRatio > CONTACT.axisMaxRatio) continue;

    // --- 目標配置(マネキン基準) ---
    // 断面(x,z)を高さ相応の下胴楕円へスナップ
    const radial = Math.hypot(local.x, local.z);
    if (radial < 1e-4) continue; // 向きが定まらない(真上/真下)→ 除外
    const { ax, az } = waistEllipseAt(local.y);
    const s = 1 / Math.hypot(local.x / ax, local.z / az);
    out[`hand_${side}`] = [round3(local.x * s), round3(local.y), round3(local.z * s)];
  }
  return out;
}

/* ================================================================
 * 入出力
 * ============================================================== */

function toId(baseName, frameNo) {
  const slug = baseName.normalize('NFKC').replace(/[^\w\s-]/g, '').trim()
    .replace(/[\s-]+/g, '_').toLowerCase();
  return `${slug}_${String(frameNo).padStart(3, '0')}`;
}

const round3 = (x) => {
  const v = Math.round(x * 1000) / 1000;
  return Object.is(v, -0) ? 0 : v;
};

function eulersToPoseBones(eulers) {
  const bones = {};
  for (const [bone, e] of Object.entries(eulers)) {
    if (Math.abs(e.x) < ROTATION_EPSILON && Math.abs(e.y) < ROTATION_EPSILON && Math.abs(e.z) < ROTATION_EPSILON) {
      continue; // 初期姿勢のボーンは既存ポーズにならい省略(PoseApplier が 0 に戻す)
    }
    bones[bone] = { rotation: [round3(e.x), round3(e.y), round3(e.z)] };
  }
  return bones;
}

async function main() {
  if (!fs.existsSync(FBX2GLTF)) {
    console.error('fbx2gltf が見つかりません。`npm install` を実行してください。');
    process.exit(1);
  }
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`FBX 置き場がありません: ${SRC_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const io = new NodeIO();
  const index = fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : [];
  const byId = new Map(index.map((p) => [p.id, p]));
  let added = 0, skipped = 0, contactCount = 0;

  // モデル一覧(public/models/models.json)。バインド姿勢がモデルごとに違うため、
  // ポーズはモデルごとに src/data/poses/<modelId>/ へ焼き分ける。
  // 較正値(バインド・手の基底・腰寸法)は各GLBから自動実測する。
  const MODELS_PATH = path.join(ROOT, 'public', 'models', 'models.json');
  const MODELS = fs.existsSync(MODELS_PATH)
    ? JSON.parse(fs.readFileSync(MODELS_PATH, 'utf8'))
    : [{ id: 'anatomy', name: '標準ボディ', file: 'mannequin.glb' }];

  const tagDirs = fs.readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);

  for (const model of MODELS) {
  const modelDir = path.join(POSES_DIR, model.id);
  fs.mkdirSync(modelDir, { recursive: true });
  CALIB = await loadModelCalib(io, path.join(ROOT, 'public', 'models', model.file));
  console.log(`\n===== モデル "${model.id}" (${model.file}) を焼く =====`);

  for (const tagDir of tagDirs) {
    const tags = tagDir.split(',').map((t) => t.trim()).filter(Boolean);
    const dir = path.join(SRC_DIR, tagDir);

    for (const fbx of fs.readdirSync(dir).filter((f) => /\.fbx$/i.test(f))) {
      // ファイル名の "@〜" サフィックスでそのFBXのサンプリングを指定できる。
      //   "Walking@4.fbx"       → 均等に4ポーズ(名前は "Walking 1"〜"Walking 4")
      //   "Jump@40%.fbx"        → アニメの40%地点の瞬間だけを1ポーズ切り出し
      //   "Kick@25%,60%,90%.fbx"→ 指定した複数地点をそれぞれ切り出し
      // %の位置はMixamoプレビューのシークバーでおおよそを掴む。指定なしは --frames(デフォルト1=中間)。
      const rawName = path.basename(fbx, path.extname(fbx));
      const fm = rawName.match(/^(.*?)\s*@([\d.,%\s]+)$/);
      const baseName = fm ? fm[1].trim() : rawName;
      let frames = FRAMES;
      let percents = null; // 例: [40] や [25,60,90]
      if (fm) {
        const spec = fm[2].trim();
        if (spec.includes('%')) {
          percents = spec.split(',')
            .map((x) => parseFloat(x))
            .filter((x) => Number.isFinite(x))
            .map((x) => Math.min(100, Math.max(0, x)));
          if (percents.length === 0) percents = null;
        } else {
          frames = Math.max(1, parseInt(spec, 10) || 1);
        }
      }
      const firstId = toId(baseName, 1);

      // 差分ビルド: 1フレーム目の JSON があればスキップ
      if (!FORCE && byId.has(firstId) && fs.existsSync(path.join(modelDir, `${firstId}.json`))) {
        skipped += percents ? percents.length : frames;
        continue;
      }

      process.stdout.write(`変換中: [${tags.join(',')}] ${baseName} ... `);
      try {
        const glbBase = path.join(TMP_DIR, firstId);
        execFileSync(FBX2GLTF, ['--binary', '--input', path.join(dir, fbx), '--output', glbBase], { stdio: 'pipe' });

        const doc = await io.read(`${glbBase}.glb`);
        const skeleton = buildSkeleton(doc);
        const restWorld = computeWorld(skeleton, null);
        const sides = resolveSides(skeleton, restWorld);

        // FRAMES=1 は中間フレーム、複数なら両端を少し避けて均等サンプリング
        const times = percents
          ? percents.map((p) => (skeleton.duration * p) / 100)
          : frames === 1
            ? [skeleton.duration / 2]
            : Array.from({ length: frames }, (_, k) => (skeleton.duration * (k + 0.5)) / frames);

        times.forEach((t, k) => {
          const animWorld = computeWorld(skeleton, t);
          const eulers = solveFrame(skeleton, restWorld, animWorld, sides);
          const contacts = solveHandContacts(skeleton, animWorld, sides); // ARP実測寸法で有効化済み
          // 空中ポーズの自動判定: Mixamoのアニメは床=y0基準なので、低い方の足首の高さが
          // 脚長の25%を超えていたら空中姿勢(ジャンプ等)とみなし、接地補正(FootIK)を自動オフ。
          // (レスト姿勢は一部FBXで足が地中にあるなど信用できないため参照しない)
          const airborne = (() => {
            const B2 = (nm) => findBone(skeleton, nm);
            const legLen =
              animWorld[B2('LeftUpLeg')].position.distanceTo(animWorld[B2('LeftLeg')].position) +
              animWorld[B2('LeftLeg')].position.distanceTo(animWorld[B2('LeftFoot')].position);
            const animLowest = Math.min(animWorld[B2('LeftFoot')].position.y, animWorld[B2('RightFoot')].position.y);
            return legLen > 1e-6 && animLowest / legLen > 0.25;
          })();
          const id = toId(baseName, k + 1);
          const existing = byId.get(id);
          const pose = {
            id,
            name: existing?.name ?? (times.length === 1 ? baseName : `${baseName} ${k + 1}`),
            tags: existing?.tags ?? tags,
            bones: eulersToPoseBones(eulers),
          };
          // 既存ポーズJSONに手書きした手動フラグ(noIk/noFootIk)を引き継ぐ(--force で消さない)。
          // 座り→noIk、ジャンプ等→noFootIk。焼き直しても崩れ対策のvetoが残る。
          // 手動フラグの引き継ぎ: モデル別ファイル→(無ければ)旧ルート直下ファイルの順で見る
          const posePath = fs.existsSync(path.join(modelDir, `${id}.json`))
            ? path.join(modelDir, `${id}.json`)
            : path.join(POSES_DIR, `${id}.json`);
          if (fs.existsSync(posePath)) {
            try {
              const prev = JSON.parse(fs.readFileSync(posePath, 'utf8'));
              if (prev.noIk) pose.noIk = true;
              if (prev.noFootIk) pose.noFootIk = true;
            } catch {
              // 既存JSONが壊れていても無視して新規に焼く
            }
          }
          if (airborne && !pose.noFootIk) {
            pose.noFootIk = true;
            console.log(`\n  ↳ 空中ポーズ検出 [${id}]: noFootIk を自動設定`);
          }
          // 接触があれば手首IKの目標点を焼く(なければ ik 自体を出さない=従来ポーズと同一形式)
          if (Object.keys(contacts).length) {
            pose.ik = contacts;
            contactCount++;
            const desc = Object.entries(contacts)
              .map(([b, v]) => `${b}=(${v.join(', ')})`).join(' / ');
            process.stdout.write(`\n  ↳ 接触検出 [${id}]: ${desc} `);
          }
          fs.writeFileSync(path.join(modelDir, `${id}.json`), JSON.stringify(pose, null, 2) + '\n');
          byId.set(id, {
            id,
            name: pose.name,
            file: `${id}.json`,
            tags: pose.tags,
            hidden: existing?.hidden, // 一覧の隠し指定も引き継ぐ(undefinedならJSONから省かれる)
            thumbnail: existing?.thumbnail ?? null,
          });
          added++;
        });
        console.log(`OK (${times.length} ポーズ)`);
      } catch (e) {
        console.log(`失敗: ${e.message}`);
      }
    }
  }

  } // ← モデルループ終わり

  // 旧構成(ルート直下)のポーズJSONは新構成(モデル別サブディレクトリ)へ移行済みなので削除する。
  for (const p of byId.values()) {
    const legacy = path.join(POSES_DIR, `${p.id}.json`);
    if (fs.existsSync(legacy) && fs.existsSync(path.join(POSES_DIR, MODELS[0].id, `${p.id}.json`))) {
      fs.unlinkSync(legacy);
      console.log(`旧ルート直下のJSONを削除(移行済み): ${p.id}`);
    }
  }

  // 索引の掃除: ポーズJSONが存在しないエントリは除去する(FBX削除や @N を減らした後の残骸対策)。
  // hidden:true のエントリはJSONがある限り残る(隠しただけで消えない)。
  const entries = [...byId.values()].filter((p) => {
    const ok = fs.existsSync(path.join(POSES_DIR, MODELS[0].id, `${p.id}.json`));
    if (!ok) console.log(`索引から除去(JSONなし): ${p.id}`);
    return ok;
  });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(entries, null, 2) + '\n');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\n完了: 追加 ${added} / スキップ ${skipped} / 合計 ${entries.length} ポーズ(うち接触 ${contactCount} 手)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
