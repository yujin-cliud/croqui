#!/usr/bin/env node
/**
 * inspect-glb.mjs — 一時検証用スクリプト(既存コード非依存・使い捨て)
 *
 * 目的: BlenderからエクスポートしたGLBのボーン構成が、Croquiの16ボーン
 * (src/types/Pose.ts の BONE_NAMES)にマッピングできそうか、既存コードを
 * 一切変更せずに確認する。import-mixamo.mjs の findBone と同じ命名規則
 * (完全一致 or ":Name"/"_Name" サフィックス)で照合し、結果を突き合わせやすくする。
 *
 * 使い方: node tools/import-mixamo/.tmp/inspect-glb.mjs <path-to-glb>
 */
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const glbPath = process.argv[2];
if (!glbPath) {
  console.error('使い方: node inspect-glb.mjs <GLBファイルへの絶対パス>');
  process.exit(1);
}

const io = new NodeIO();
const doc = await io.read(glbPath);
const root = doc.getRoot();
const allNodes = root.listNodes();
const skins = root.listSkins();

console.log(`=== ${glbPath} ===`);
console.log(`ノード総数: ${allNodes.length} / メッシュ: ${root.listMeshes().length} / スキン: ${skins.length}`);
console.log('');

if (skins.length === 0) {
  console.log('⚠ スキン(Armature)が見つかりません。glTF Exportで「Include > Armature」が有効か、');
  console.log('  Blender側でメッシュがArmatureモディファイアで正しくバインドされているか確認してください。');
  process.exit(0);
}

for (const skin of skins) {
  const joints = skin.listJoints();
  console.log(`--- スキン「${skin.getName() || '(無名)'}」: ジョイント数 ${joints.length} ---`);

  const jointSet = new Set(joints);
  const parentOf = new Map();
  for (const n of joints) {
    for (const c of n.listChildren()) {
      if (jointSet.has(c)) parentOf.set(c, n);
    }
  }
  const roots = joints.filter((n) => !parentOf.has(n));

  // ローカル変換からワールド変換を再帰計算(import-mixamo.mjsのcomputeWorldと同じ考え方)
  const worldCache = new Map();
  function getWorld(node) {
    if (worldCache.has(node)) return worldCache.get(node);
    const t = new THREE.Vector3(...node.getTranslation());
    const q = new THREE.Quaternion(...node.getRotation());
    const s = new THREE.Vector3(...node.getScale());
    const local = new THREE.Matrix4().compose(t, q, s);
    const parent = parentOf.get(node);
    const world = parent ? new THREE.Matrix4().multiplyMatrices(getWorld(parent), local) : local;
    worldCache.set(node, world);
    return world;
  }

  const fmt = (n) => n.toFixed(3);
  function printTree(node, depth) {
    const wp = new THREE.Vector3().setFromMatrixPosition(getWorld(node));
    const indent = '  '.repeat(depth);
    console.log(`${indent}${node.getName() || '(無名)'}   world=(${fmt(wp.x)}, ${fmt(wp.y)}, ${fmt(wp.z)})`);
    for (const c of node.listChildren()) {
      if (jointSet.has(c)) printTree(c, depth + 1);
    }
  }
  for (const r of roots) printTree(r, 0);
  console.log('');

  // import-mixamo.mjs の findBone と同じ規則で名前解決
  const findBone = (shortName) =>
    joints.find((n) => {
      const name = n.getName() ?? '';
      return name === shortName || name.endsWith(`:${shortName}`) || name.endsWith(`_${shortName}`);
    });

  // Croquiの16ボーンに必要な、Mixamo標準命名での「役割」一覧
  const REQUIRED = [
    ['hips', 'Hips'],
    ['spine(腰に近い方)', 'Spine'],
    ['chest(首に近い方)', 'Spine2'],
    ['head', 'Head'],
    ['upperArm_L', 'LeftArm'], ['lowerArm_L', 'LeftForeArm'], ['hand_L', 'LeftHand'],
    ['upperArm_R', 'RightArm'], ['lowerArm_R', 'RightForeArm'], ['hand_R', 'RightHand'],
    ['upperLeg_L', 'LeftUpLeg'], ['lowerLeg_L', 'LeftLeg'], ['foot_L', 'LeftFoot'],
    ['upperLeg_R', 'RightUpLeg'], ['lowerLeg_R', 'RightLeg'], ['foot_R', 'RightFoot'],
  ];

  console.log('--- Croqui 16ボーンへのマッピング判定(Mixamo標準命名で検索) ---');
  let missing = 0;
  for (const [croquiName, mixamoName] of REQUIRED) {
    const found = findBone(mixamoName);
    if (found) {
      console.log(`  OK   ${croquiName.padEnd(22)} <- "${mixamoName}" → 実際のノード名 "${found.getName()}"`);
    } else {
      missing += 1;
      console.log(`  ✗見つからず ${croquiName.padEnd(22)} <- "${mixamoName}" 相当の名前なし`);
    }
  }
  console.log('');
  console.log(missing === 0
    ? '→ 全16ボーンがMixamo標準命名で解決できました(命名規則の追加対応は不要)。'
    : `→ ${missing}件、Mixamo標準命名では見つかりませんでした。実際のジョイント名一覧(上記world座標つき階層)と見比べて、`
      + '役割ベースでどのノードが該当するか確認してください(例: 前回のSpine02/Spine逆転のようなケース)。');
  console.log('');

  // 簡易レストポーズ診断: 上腕→前腕の方向がT/Aポーズ(横方向優勢)か、腕下げ(縦方向優勢)かの目安
  const armCheck = (upperKey, foreKey, label) => {
    const upper = findBone(upperKey);
    const fore = findBone(foreKey);
    if (!upper || !fore) return;
    const wp1 = new THREE.Vector3().setFromMatrixPosition(getWorld(upper));
    const wp2 = new THREE.Vector3().setFromMatrixPosition(getWorld(fore));
    const dir = wp2.clone().sub(wp1).normalize();
    const horizontal = Math.abs(dir.x);
    const vertical = Math.abs(dir.y);
    let stance = '判定不能';
    if (horizontal > vertical * 1.5) stance = 'Tポーズ寄り(横方向優勢)';
    else if (vertical > horizontal * 1.5) stance = '腕下げポーズ寄り(縦方向優勢)';
    else stance = 'Aポーズ寄り(斜め)';
    console.log(`  ${label}: 方向=(${fmt(dir.x)}, ${fmt(dir.y)}, ${fmt(dir.z)}) → ${stance}`);
  };
  console.log('--- レストポーズの簡易診断(Croquiマネキンは「腕下げ」がレスト) ---');
  armCheck('LeftArm', 'LeftForeArm', '左腕(Arm→ForeArm)');
  armCheck('RightArm', 'RightForeArm', '右腕(Arm→ForeArm)');
  console.log('');
}
