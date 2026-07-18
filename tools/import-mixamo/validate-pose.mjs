#!/usr/bin/env node
/**
 * validate-pose.mjs — 生成した Pose JSON をマネキンと同じ階層・寸法で順運動学計算し、
 * 正面/側面のスティックフィギュア SVG を出力する検証ツール。
 * 使い方: node tools/import-mixamo/validate-pose.mjs <poseId>...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSES_DIR = path.join(ROOT, 'src', 'data', 'poses');

// src/constants/mannequin.ts と同値(検証ツールなので複製を許容)
const d = {
  footHeight: 0.05, lowerLegLength: 0.42, upperLegLength: 0.42,
  pelvisSize: [0.26, 0.16, 0.16], chestSize: [0.32, 0.2, 0.16],
  spineLength: 0.18, shoulderWidth: 0.34, neckLength: 0.06, headRadius: 0.11,
  upperArmLength: 0.26, lowerArmLength: 0.24, hipWidth: 0.16, footSize: [0.09, 0.06, 0.22],
};
const hipHeight = d.footHeight + d.lowerLegLength + d.upperLegLength;

// ModelLoader.ts と同じ親子関係・オフセット(bone名 → [親, ローカル位置, 末端オフセット])
function buildSegments(pose) {
  const q = {};
  const get = (b) => {
    const r = pose.bones[b]?.rotation ?? [0, 0, 0];
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, 'XYZ'));
  };
  const world = {}; // bone → { p: 関節ワールド位置, q: ワールド回転 }
  const attach = (bone, parent, localPos) => {
    const pq = parent ? world[parent].q : new THREE.Quaternion();
    const pp = parent ? world[parent].p : new THREE.Vector3(0, 0, 0);
    const p = localPos.clone().applyQuaternion(pq).add(pp);
    world[bone] = { p, q: pq.clone().multiply(get(bone)) };
  };

  attach('hips', null, new THREE.Vector3(0, hipHeight, 0));
  attach('spine', 'hips', new THREE.Vector3(0, d.pelvisSize[1] / 2, 0));
  attach('chest', 'spine', new THREE.Vector3(0, d.spineLength, 0));
  attach('head', 'chest', new THREE.Vector3(0, d.chestSize[1] + d.neckLength, 0));
  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    attach(`upperArm_${side}`, 'chest', new THREE.Vector3((d.shoulderWidth / 2) * sign, d.chestSize[1] * 0.85, 0));
    attach(`lowerArm_${side}`, `upperArm_${side}`, new THREE.Vector3(0, -d.upperArmLength, 0));
    attach(`upperLeg_${side}`, 'hips', new THREE.Vector3((d.hipWidth / 2) * sign, -d.pelvisSize[1] / 2, 0));
    attach(`lowerLeg_${side}`, `upperLeg_${side}`, new THREE.Vector3(0, -d.upperLegLength, 0));
    attach(`foot_${side}`, `lowerLeg_${side}`, new THREE.Vector3(0, -d.lowerLegLength, 0));
  }

  const tip = (bone, offset) => world[bone].p.clone().add(offset.applyQuaternion(world[bone].q));
  const segs = [];
  const add = (a, b) => segs.push([a, b]);
  add(world.hips.p, world.spine.p);
  add(world.spine.p, world.chest.p);
  add(world.chest.p, world.head.p);
  add(world.head.p, tip('head', new THREE.Vector3(0, d.headRadius * 2, 0)));
  for (const side of ['L', 'R']) {
    add(world.chest.p, world[`upperArm_${side}`].p);
    add(world[`upperArm_${side}`].p, world[`lowerArm_${side}`].p);
    add(world[`lowerArm_${side}`].p, tip(`lowerArm_${side}`, new THREE.Vector3(0, -d.lowerArmLength, 0)));
    add(world.hips.p, world[`upperLeg_${side}`].p);
    add(world[`upperLeg_${side}`].p, world[`lowerLeg_${side}`].p);
    add(world[`lowerLeg_${side}`].p, world[`foot_${side}`].p);
    add(world[`foot_${side}`].p, tip(`foot_${side}`, new THREE.Vector3(0, -d.footSize[1], d.footSize[2])));
  }
  return { segs, head: world.head.p };
}

function toSvg(views) {
  const S = 130, W = 300, H = 320;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * views.length} ${H}" font-family="sans-serif" font-size="12">`;
  views.forEach(({ label, segs, head, axis }, i) => {
    const ox = W * i + W / 2, oy = H - 30;
    const px = (v) => ox + (axis === 'front' ? v.x : v.z) * S;
    const py = (v) => oy - v.y * S;
    out += `<text x="${W * i + 10}" y="20" fill="#888">${label}</text>`;
    out += `<line x1="${W * i + 20}" y1="${oy}" x2="${W * (i + 1) - 20}" y2="${oy}" stroke="#ddd"/>`;
    for (const [a, b] of segs) {
      out += `<line x1="${px(a)}" y1="${py(a)}" x2="${px(b)}" y2="${py(b)}" stroke="#c9a06a" stroke-width="6" stroke-linecap="round"/>`;
    }
    out += `<circle cx="${px(head)}" cy="${py(head) - d.headRadius * S}" r="${d.headRadius * S}" fill="#c9a06a"/>`;
  });
  return out + '</svg>';
}

for (const id of process.argv.slice(2)) {
  const pose = JSON.parse(fs.readFileSync(path.join(POSES_DIR, `${id}.json`), 'utf8'));
  const { segs, head } = buildSegments(pose);
  const svg = toSvg([
    { label: `${id} 正面(+Z視点)`, segs, head, axis: 'front' },
    { label: `側面(+X視点)`, segs, head, axis: 'side' },
  ]);
  const out = path.join(ROOT, 'tools', 'import-mixamo', `check_${id}.svg`);
  fs.writeFileSync(out, svg);
  console.log(`書き出し: ${out}`);
}
