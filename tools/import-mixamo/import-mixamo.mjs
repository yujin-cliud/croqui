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
function resolveSides(skeleton, restWorld) {
  const leftArmX = restWorld[findBone(skeleton, 'LeftArm')].position.x;
  const rightArmX = restWorld[findBone(skeleton, 'RightArm')].position.x;
  // マネキンの _R は +X 側。Mixamo 側で +X にある方を R に割り当てる
  return leftArmX > rightArmX ? { R: 'Left', L: 'Right' } : { R: 'Right', L: 'Left' };
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
};
const arpBindWorld = (role) => new THREE.Quaternion(...ARP_BIND_WORLD[role]);

const MX_BONE = {
  hips: 'Hips', spine: 'Spine', chest: 'Spine2', head: 'Head',
  neck: 'Neck', shoulder_L: 'LeftShoulder', shoulder_R: 'RightShoulder',
  upperArm_L: 'LeftArm', lowerArm_L: 'LeftForeArm', hand_L: 'LeftHand',
  upperArm_R: 'RightArm', lowerArm_R: 'RightForeArm', hand_R: 'RightHand',
  upperLeg_L: 'LeftUpLeg',  lowerLeg_L: 'LeftLeg',  foot_L: 'LeftFoot',
  upperLeg_R: 'RightUpLeg', lowerLeg_R: 'RightLeg', foot_R: 'RightFoot',
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
    targetWorld[role] = mxDelta.multiply(arpBindWorld(role));
  }
  // 肩(shoulder)は動きが繊細で、delta=なで肩/aim=怒り肩になるため、
  // バインド姿勢のまま固定する(人間の肩は立ち・歩きではほぼ動かない)。
  targetWorld.shoulder_L = arpBindWorld('shoulder_L');
  targetWorld.shoulder_R = arpBindWorld('shoulder_R');
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
  hipsToHead: 0.55,        // hips原点→頭のおおよその縦長。Mixamo体長との正規化スケール合わせ用
  handRadius: 0.055,       // handRadius … 手首をこのぶん表面から離すと手のひらが面に乗る
  // 下胴の断面半径。低い所(骨盤)は広く、高い所(腰くびれ)は細い。高さで補間する。
  pelvisHalfWidth: 0.15,   // = pelvisBottomWidth(0.30) / 2
  pelvisHalfDepth: 0.035,  // = pelvisDepth(0.07) / 2
  waistHalfWidth: 0.085,   // = bellyWidth(0.17) / 2
  waistHalfDepth: 0.0375,  // = bellyDepth(0.075) / 2
  // 骨盤↔腰くびれの補間に使う hips ローカルの高さ(マネキン尺)
  pelvisY: -0.05,
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
  const t = clamp01((y - MANNEQUIN.pelvisY) / (MANNEQUIN.waistY - MANNEQUIN.pelvisY));
  const halfW = lerp(MANNEQUIN.pelvisHalfWidth, MANNEQUIN.waistHalfWidth, t);
  const halfD = lerp(MANNEQUIN.pelvisHalfDepth, MANNEQUIN.waistHalfDepth, t);
  return { ax: halfW + MANNEQUIN.handRadius, az: halfD + MANNEQUIN.handRadius };
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
  const toMannequin = MANNEQUIN.hipsToHead / mixamoTorso;

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

    // 手を hips ローカル→マネキン尺へ
    const local = handP.clone().sub(hipsPos).applyQuaternion(hipsQuatInv).multiplyScalar(toMannequin);

    // (2) 高さ帯(骨盤〜腰)。頭上/肩上や低く前で組む手を除外
    if (local.y < CONTACT.yMin || local.y > CONTACT.yMax) continue;

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
          const contacts = {}; // TODO: ARP寸法に合わせて再有効化するまで一旦オフ
          const id = toId(baseName, k + 1);
          const existing = byId.get(id);
          const pose = {
            id,
            name: existing?.name ?? (FRAMES === 1 ? baseName : `${baseName} ${k + 1}`),
            tags: existing?.tags ?? tags,
            bones: eulersToPoseBones(eulers),
          };
          // 既存ポーズJSONに手書きした手動フラグ(noIk/noFootIk)を引き継ぐ(--force で消さない)。
          // 座り→noIk、ジャンプ等→noFootIk。焼き直しても崩れ対策のvetoが残る。
          const posePath = path.join(POSES_DIR, `${id}.json`);
          if (fs.existsSync(posePath)) {
            try {
              const prev = JSON.parse(fs.readFileSync(posePath, 'utf8'));
              if (prev.noIk) pose.noIk = true;
              if (prev.noFootIk) pose.noFootIk = true;
            } catch {
              // 既存JSONが壊れていても無視して新規に焼く
            }
          }
          // 接触があれば手首IKの目標点を焼く(なければ ik 自体を出さない=従来ポーズと同一形式)
          if (Object.keys(contacts).length) {
            pose.ik = contacts;
            contactCount++;
            const desc = Object.entries(contacts)
              .map(([b, v]) => `${b}=(${v.join(', ')})`).join(' / ');
            process.stdout.write(`\n  ↳ 接触検出 [${id}]: ${desc} `);
          }
          fs.writeFileSync(path.join(POSES_DIR, `${id}.json`), JSON.stringify(pose, null, 2) + '\n');
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

  fs.writeFileSync(INDEX_PATH, JSON.stringify([...byId.values()], null, 2) + '\n');
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(`\n完了: 追加 ${added} / スキップ ${skipped} / 合計 ${byId.size} ポーズ(うち接触 ${contactCount} 手)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
