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
function resolveSides(skeleton, restWorld) {
  const leftArmX = restWorld[findBone(skeleton, 'LeftArm')].position.x;
  const rightArmX = restWorld[findBone(skeleton, 'RightArm')].position.x;
  // マネキンの _R は +X 側。Mixamo 側で +X にある方を R に割り当てる
  return leftArmX > rightArmX ? { R: 'Left', L: 'Right' } : { R: 'Right', L: 'Left' };
}

const DOWN = new THREE.Vector3(0, -1, 0); // マネキンの手足はローカル -Y 方向に伸びる

/**
 * 1フレーム分のリターゲットを解く。
 * 返り値: { boneName: THREE.Euler(XYZ) } — PoseApplier がそのまま適用できるローカル回転
 */
function solveFrame(skeleton, restWorld, animWorld, sides) {
  const B = (name) => findBone(skeleton, name);

  /** [Δ方式] ワールド回転差分(マネキンのレストワールド回転は全ボーン単位行列) */
  const delta = (name) => {
    const i = B(name);
    return animWorld[i].quaternion.clone().multiply(restWorld[i].quaternion.clone().invert());
  };
  /** [方向方式] from→to のワールド方向に -Y を向ける回転(捻りなし) */
  const aim = (fromName, toName) => {
    const d = animWorld[B(toName)].position.clone().sub(animWorld[B(fromName)].position).normalize();
    return new THREE.Quaternion().setFromUnitVectors(DOWN, d);
  };

  // --- 各ボーンの「目標ワールド回転」 ---
  const world = {
    hips: delta('Hips'),
    spine: delta('Spine'),
    chest: delta('Spine2'),
    head: delta('Head'),
  };
  for (const side of ['L', 'R']) {
    const mx = sides[side]; // 'Left' | 'Right'
    world[`upperArm_${side}`] = aim(`${mx}Arm`, `${mx}ForeArm`);
    world[`lowerArm_${side}`] = aim(`${mx}ForeArm`, `${mx}Hand`);
    world[`upperLeg_${side}`] = delta(`${mx}UpLeg`);
    world[`lowerLeg_${side}`] = delta(`${mx}Leg`);
    world[`foot_${side}`] = delta(`${mx}Foot`);
    // 手首: Mixamoの「前腕→手」のローカル回転だけを取り出し、aimした前腕の上に乗せる
    // (deltaはT字レスト基準で腕の"下ろし"を二重に含み手が捻れるため)
    const wristLocal = animWorld[B(`${mx}ForeArm`)].quaternion.clone().invert()
      .multiply(animWorld[B(`${mx}Hand`)].quaternion);
    world[`hand_${side}`] = world[`lowerArm_${side}`].clone().multiply(wristLocal);
  }

  // --- ワールド → マネキン階層のローカル回転へ変換 ---
  // 階層: hips → spine → chest → upperArm → lowerArm / hips → upperLeg → lowerLeg → foot
  const PARENT = {
    hips: null, spine: 'hips', chest: 'spine', head: 'chest',
    upperArm_L: 'chest', lowerArm_L: 'upperArm_L', hand_L: 'lowerArm_L',
    upperArm_R: 'chest', lowerArm_R: 'upperArm_R', hand_R: 'lowerArm_R',
    upperLeg_L: 'hips', lowerLeg_L: 'upperLeg_L', foot_L: 'lowerLeg_L',
    upperLeg_R: 'hips', lowerLeg_R: 'upperLeg_R', foot_R: 'lowerLeg_R',
  };
  const eulers = {};
  for (const [bone, parent] of Object.entries(PARENT)) {
    const local = parent
      ? world[parent].clone().invert().multiply(world[bone])
      : world[bone].clone();
    eulers[bone] = new THREE.Euler().setFromQuaternion(local, 'XYZ');
  }

  // --- 自己検証: ローカル回転を Euler 経由で合成し直し、目標ワールド回転と一致するか ---
  const rebuilt = {};
  for (const [bone, parent] of Object.entries(PARENT)) {
    const q = new THREE.Quaternion().setFromEuler(eulers[bone]);
    rebuilt[bone] = parent ? rebuilt[parent].clone().multiply(q) : q;
    const err = rebuilt[bone].angleTo(world[bone]); if (err > 1e-3) {
      throw new Error(`検証失敗: ${bone} のワールド回転が再現できません (誤差 ${err.toFixed(6)} rad)`);
    }
  }
  return eulers;
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
  let added = 0, skipped = 0;

  const tagDirs = fs.readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);

  for (const tagDir of tagDirs) {
    const tags = tagDir.split(',').map((t) => t.trim()).filter(Boolean);
    const dir = path.join(SRC_DIR, tagDir);

    for (const fbx of fs.readdirSync(dir).filter((f) => /\.fbx$/i.test(f))) {
      const baseName = path.basename(fbx, path.extname(fbx));
      const firstId = toId(baseName, 1);

      // 差分ビルド: 1フレーム目の JSON があればスキップ
      if (!FORCE && byId.has(firstId) && fs.existsSync(path.join(POSES_DIR, `${firstId}.json`))) {
        skipped += FRAMES;
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
        const times = FRAMES === 1
          ? [skeleton.duration / 2]
          : Array.from({ length: FRAMES }, (_, k) => (skeleton.duration * (k + 0.5)) / FRAMES);

        times.forEach((t, k) => {
          const animWorld = computeWorld(skeleton, t);
          const eulers = solveFrame(skeleton, restWorld, animWorld, sides);
          const id = toId(baseName, k + 1);
          const existing = byId.get(id);
          const pose = {
            id,
            name: existing?.name ?? (FRAMES === 1 ? baseName : `${baseName} ${k + 1}`),
            tags: existing?.tags ?? tags,
            bones: eulersToPoseBones(eulers),
          };
          fs.writeFileSync(path.join(POSES_DIR, `${id}.json`), JSON.stringify(pose, null, 2) + '\n');
          byId.set(id, {
            id,
            name: pose.name,
            file: `${id}.json`,
            tags: pose.tags,
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

  fs.writeFileSync(INDEX_PATH, JSON.stringify([...byId.values()], null, 2) + '\n');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\n完了: 追加 ${added} / スキップ ${skipped} / 合計 ${byId.size} ポーズ`);
}

main().catch((e) => { console.error(e); process.exit(1); });
