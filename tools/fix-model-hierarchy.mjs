// モデルGLBの骨階層を、Croquiが前提とする「意味的な連鎖」に修正するツール。
// ARPリグはBlender内では拘束で動くため、エクスポート設定によっては変形ボーンが
// フラット(親子が切れた状態)で出てしまう。フラットのままだと bind×delta のFKも
// FootIK/ArmIK(親を回して子を追従させる)も成立しない。
//
// v2: 標準ボディをテンプレにする方式をやめ、意味ベースの連鎖仕様に変更。
//   ・ARPには「捻れ骨が四肢の付け根側の分割骨になる」流儀(例: c_arm_twist_offset が
//     真の肩関節、arm_stretch は上腕の先半分)と「同位置の補助骨」の流儀がある。
//   ・各連鎖の中間骨は「付け根からの距離」で順序を決めるため、どちらの流儀でも
//     正しい鎖になる。存在しない骨はスキップする。
//   ・各ボーンのワールド姿勢は一切変えず(ローカル=parentWorld^-1×world で再計算)、
//     親子だけを繋ぎ直す。
// 使い方: node tools/fix-model-hierarchy.mjs public/models/female.glb
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const target = process.argv[2];
if (!target) { console.error('使い方: node tools/fix-model-hierarchy.mjs <対象.glb>'); process.exit(1); }

const io = new NodeIO();
const norm = (s) => (s || '').replace(/\./g, '').replace(/^c_/, '');

const doc = await io.read(target);
const nodes = doc.getRoot().listNodes();
const parentsOf = () => {
  const par = new Array(nodes.length).fill(-1);
  for (const n of nodes) for (const c of n.listChildren()) par[nodes.indexOf(c)] = nodes.indexOf(n);
  return par;
};
function worlds(par) {
  const order = [];
  { const seen = new Array(nodes.length).fill(false);
    const vis = (i) => { if (seen[i]) return; if (par[i] >= 0) vis(par[i]); seen[i] = true; order.push(i); };
    for (let i = 0; i < nodes.length; i++) vis(i); }
  const W = new Array(nodes.length);
  for (const i of order) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...nodes[i].getTranslation()),
      new THREE.Quaternion(...nodes[i].getRotation()),
      new THREE.Vector3(...nodes[i].getScale()));
    W[i] = par[i] >= 0 ? new THREE.Matrix4().multiplyMatrices(W[par[i]], m) : m;
  }
  return W;
}

const par0 = parentsOf();
const W = worlds(par0);
// 名前照合は2段: まずピリオド除去の完全一致、次に先頭c_を剥がした照合。
// フルリグ書き出しでは c_spine_01.x(コントロール)と spine_01.x(変形)が共存するため、
// 一段照合だとコントロール骨を誤って掴む危険がある。変形骨(素の名前)を必ず優先する。
const byNorm = new Map();
nodes.forEach((n, i) => { const k = (n.getName() || '').replace(/\./g, ''); if (!byNorm.has(k)) byNorm.set(k, i); });
nodes.forEach((n, i) => { const k = norm(n.getName()); if (!byNorm.has(k)) byNorm.set(k, i); });
const pos = (i) => new THREE.Vector3().setFromMatrixPosition(W[i]);

// --- 連鎖仕様 ---
// [固定親, [位置で並べ替える中間メンバー(存在するものだけ)], 固定子...]
function limbChains(side) {
  const s = side; // 'l' / 'r'
  const chains = [];
  // 腕: shoulder → (arm_twist_offset?/arm_twist?/arm_stretch を付け根から順に) → (forearm系) → hand
  chains.push({
    root: `shoulder${s}`,
    sorted: [`arm_twist_offset${s}`, `arm_twist${s}`, `arm_stretch${s}`, `forearm_stretch${s}`, `forearm_twist${s}`],
    tail: [`hand${s}`],
  });
  // 脚: rootx → (thigh系) → (leg系) → foot → toes
  chains.push({
    root: 'rootx',
    sorted: [`thigh_twist${s}`, `thigh_stretch${s}`, `leg_stretch${s}`, `leg_twist${s}`],
    tail: [`foot${s}`, `toes_01${s}`],
  });
  // 指: hand → base? → 1 → 2 → 3
  for (const fg of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    const chain = { root: `hand${s}`, sorted: [], tail: [] };
    if (fg !== 'thumb' && byNorm.has(`${fg}1_base${s}`)) chain.tail.push(`${fg}1_base${s}`);
    chain.tail.push(`${fg}1${s}`, `${fg}2${s}`, `${fg}3${s}`);
    chains.push(chain);
  }
  return chains;
}
const CHAINS = [
  // 胴: rig直下の root.x はそのまま。spine連鎖+首+頭。
  { root: 'rootx', sorted: [], tail: ['spine_01x', 'spine_02x', 'spine_03x'] },
  { root: 'spine_03x', sorted: [], tail: ['neckx'] },
  { root: 'neckx', sorted: [], tail: ['headx'] },
  { root: 'spine_03x', sorted: [], tail: ['shoulderl'] },
  { root: 'spine_03x', sorted: [], tail: ['shoulderr'] },
  ...limbChains('l'),
  ...limbChains('r'),
];

let fixed = 0, kept = 0;
function reparent(childIdx, parentIdx) {
  if (par0[childIdx] === parentIdx) { kept++; return; }
  const cur = par0[childIdx] >= 0 ? nodes[par0[childIdx]] : null;
  if (cur) cur.removeChild(nodes[childIdx]);
  nodes[parentIdx].addChild(nodes[childIdx]);
  const local = new THREE.Matrix4().copy(W[parentIdx]).invert().multiply(W[childIdx]);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  local.decompose(p, q, sc);
  nodes[childIdx].setTranslation(p.toArray());
  nodes[childIdx].setRotation([q.x, q.y, q.z, q.w]);
  nodes[childIdx].setScale(sc.toArray());
  par0[childIdx] = parentIdx;
  fixed++;
}
// 同位置(2cm未満)の補助骨(例: 標準ボディの arm_twist は arm_stretch と同位置)は
// 鎖の本流に挟まず、直前の本流ボーンの「枝」として親付けする。
// 離れた位置にある分割骨(例: 女性の c_arm_twist_offset は真の肩関節)は本流に入れる。
const COLOCATE = 0.02;
for (const spec of CHAINS) {
  const rootIdx = byNorm.get(spec.root);
  if (rootIdx == null) continue;
  const rootP = pos(rootIdx);
  const members = spec.sorted
    .map((n) => byNorm.get(n))
    .filter((i) => i != null)
    .sort((a, b) => {
      const d = pos(a).distanceTo(rootP) - pos(b).distanceTo(rootP);
      if (Math.abs(d) > 1e-6) return d;
      // 同距離なら stretch を本流側(先)に
      const an = norm(nodes[a].getName()), bn = norm(nodes[b].getName());
      return (an.includes('twist') ? 1 : 0) - (bn.includes('twist') ? 1 : 0);
    });
  let lastMain = rootIdx;
  for (const m of members) {
    if (pos(m).distanceTo(pos(lastMain)) < COLOCATE) {
      reparent(m, lastMain); // 枝(本流は進めない)
    } else {
      reparent(m, lastMain);
      lastMain = m;
    }
  }
  for (const n of spec.tail) {
    const i = byNorm.get(n);
    if (i == null) continue;
    reparent(i, lastMain);
    lastMain = i;
  }
}
console.log(`親子を修正: ${fixed} 本 / 既に正しい: ${kept} 本`);

// 検証: ワールド位置が保存されているか
const W2 = worlds(parentsOf());
let maxErr = 0;
nodes.forEach((_, i) => {
  maxErr = Math.max(maxErr, new THREE.Vector3().setFromMatrixPosition(W[i])
    .distanceTo(new THREE.Vector3().setFromMatrixPosition(W2[i])));
});
console.log(`ワールド位置の保存誤差(最大): ${maxErr.toExponential(2)} m`);
await io.write(target, doc);
console.log(`書き出し: ${target}`);
