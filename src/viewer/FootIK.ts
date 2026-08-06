import * as THREE from 'three';
import type { Pose } from '../types/Pose';
import type { BoneName } from '../types/Pose';
import type { BoneMap } from './BoneMapper';

type Side = 'L' | 'R';

// 足首(footボーン原点)をこの高さに置くと足の裏が床(y=0)に接する。
// モデル読込時に自動計測した値(hips.userData.ankleHeight)を優先し、無ければこの実測既定値。
const DEFAULT_ANKLE_HEIGHT = 0.093;
// 全体シフト後、床からこの範囲内にある足を「接地」とみなして脚IKで床へ寄せる。
// これより高い足は遊脚(上げ足)とみなしFKのまま一切触らない。
const PLANT_THRESHOLD = 0.1;
// 足を動かす必要があるとみなす最小ズレ。これ未満ならFKのまま(無駄な微調整をしない)。
const MIN_ADJUST = 0.005;

/**
 * applyPose の直後・applyArmIK の前に呼ぶ。Mixamoとマネキンの脚長差や、腰の高さが
 * バインド固定なことで足が床から浮く/めり込む問題を直す:
 *   (1) 体全体を上下シフトして最低の足首を接地高(ANKLE_HEIGHT)に合わせる
 *   (2) 床付近の足だけ、脚2ボーンIKで床へ貼り付ける
 *
 * ★ ARPリグ版の設計(ArmIKと同型): FKの脚を作り直すのではなく、FKの股・すねの回転に
 *   「最小の差分回転(shortestArc)」だけを乗せる。FKが持つ脚のひねりが保たれ、
 *   ひねりに敏感な解剖学メッシュの腿が捻れない。足はFKのワールド向きを維持する。
 *   動かす必要のない足(遊脚・既に接地)には一切触れない。
 *
 * pose.noFootIk === true のポーズはスキップ(ジャンプ等の空中ポーズ。importerが
 * Mixamoデータから自動で焼くほか、個別JSONへの手書きも可)。
 * hips.position.y を動かすため、初回の基準高を userData.baseY に記録し毎回そこへ戻して累積を防ぐ。
 */
export function applyFootIK(boneMap: BoneMap, pose: Pose): void {
  const hips = boneMap['hips' as BoneName];
  const footL = boneMap['foot_L' as BoneName];
  const footR = boneMap['foot_R' as BoneName];
  if (!hips || !footL || !footR) return;

  // 基準の腰位置を初回に記録し、毎回そこへ戻す(シフトの累積を防ぐ)
  const ud = hips.userData as { basePos?: THREE.Vector3; ankleHeight?: number };
  if (ud.basePos === undefined) ud.basePos = hips.position.clone();
  hips.position.copy(ud.basePos);
  const ankleHeight = ud.ankleHeight ?? DEFAULT_ANKLE_HEIGHT;

  // veto指定なら、基準高に戻すだけで何もしない(FK表示)
  if ((pose as { noFootIk?: boolean }).noFootIk) {
    hips.updateWorldMatrix(true, true);
    return;
  }

  hips.updateWorldMatrix(true, true);

  // FKでの両足首の高さ → 低い方を接地高に合わせるよう全体を上下シフト
  const lowest = Math.min(
    footL.getWorldPosition(new THREE.Vector3()).y,
    footR.getWorldPosition(new THREE.Vector3()).y,
  );
  // 接地シフトはワールド空間で計算し、腰の親空間へ変換して加算する。
  // フルリグ書き出しでは腰の親が回転を持つコントロール骨(c_root.x等=X軸180°回転)のことがあり、
  // ローカルYへの単純加算では補正が逆向きに効いて体が宙に浮く(male2で発生した真因)。
  const dyWorld = ankleHeight - lowest;
  const hipsParent = hips.parent;
  if (hipsParent) {
    const invQ = hipsParent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const parentScale = hipsParent.getWorldScale(new THREE.Vector3());
    const dLocal = new THREE.Vector3(0, dyWorld, 0).applyQuaternion(invQ).divide(parentScale);
    hips.position.add(dLocal);
  } else {
    hips.position.y += dyWorld;
  }
  hips.updateWorldMatrix(true, true);

  // 床付近の足だけ、Y座標を ANKLE_HEIGHT へ寄せる(x,zはFKのまま)。
  for (const side of ['L', 'R'] as Side[]) {
    const foot = side === 'L' ? footL : footR;
    const p = foot.getWorldPosition(new THREE.Vector3());
    const grounded = p.y <= ankleHeight + PLANT_THRESHOLD;
    if (!grounded) continue; // 遊脚はFKのまま
    if (Math.abs(p.y - ankleHeight) < MIN_ADJUST) continue; // 既に接地
    solveLegIK(boneMap, side, new THREE.Vector3(p.x, ankleHeight, p.z));
  }
}

/**
 * 股→膝→足首の2ボーン解析IK。FKの股・すねに最小の差分回転を乗せて
 * 足首を target(ワールド)へ届かせる。足はFKのワールド向きを維持。ArmIKと同型。
 */
function solveLegIK(boneMap: BoneMap, side: Side, target: THREE.Vector3): void {
  const upperLeg = boneMap[`upperLeg_${side}` as BoneName];
  const lowerLeg = boneMap[`lowerLeg_${side}` as BoneName];
  const foot = boneMap[`foot_${side}` as BoneName];
  if (!upperLeg || !lowerLeg || !foot) return;
  const parent = upperLeg.parent;
  if (!parent) return;

  const S = upperLeg.getWorldPosition(new THREE.Vector3());
  const kneeFK = lowerLeg.getWorldPosition(new THREE.Vector3());
  const footWorldFK = foot.getWorldQuaternion(new THREE.Quaternion());

  // 骨の長さは実ワールド距離で取る(股と膝の間に分割骨が挟まるリグ対応)
  const L1 = S.distanceTo(kneeFK);              // 股→膝
  const L2 = kneeFK.distanceTo(foot.getWorldPosition(new THREE.Vector3())); // 膝→足首

  // 届かない接地はIKしない(FKのまま)。無理に伸ばすと膝が伸び切りロックされる。
  if (target.distanceTo(S) > (L1 + L2) * 0.96) return;

  // --- 平面内2ボーンIK ---
  const n = target.clone().sub(S);
  const dist = THREE.MathUtils.clamp(n.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  n.normalize();
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));

  // 膝のふくらむ向き = FK膝の、S→target直線に対して垂直な成分
  const pole = kneeFK.clone().sub(S);
  pole.addScaledVector(n, -pole.dot(n));
  if (pole.lengthSq() < 1e-8) {
    pole.set(0, 0, 1).addScaledVector(n, -n.z);
    if (pole.lengthSq() < 1e-8) pole.set(1, 0, 0).addScaledVector(n, -n.x);
  }
  pole.normalize();
  const knee = S.clone().addScaledVector(n, a).addScaledVector(pole, h);

  // --- 股: FKの向きに「FK膝方向→新膝方向」の最小回転を乗せる(ひねり温存) ---
  const arc1 = new THREE.Quaternion().setFromUnitVectors(
    kneeFK.clone().sub(S).normalize(),
    knee.clone().sub(S).normalize(),
  );
  const upperWorldNew = arc1.clone().multiply(upperLeg.getWorldQuaternion(new THREE.Quaternion()));
  const parentWorldInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  upperLeg.quaternion.copy(parentWorldInv.multiply(upperWorldNew));
  upperLeg.updateWorldMatrix(true, false);
  lowerLeg.updateWorldMatrix(true, false);
  foot.updateWorldMatrix(true, false);

  // --- すね: 「現在の足首方向→新足首方向」の最小回転を乗せる ---
  const kneeNow = lowerLeg.getWorldPosition(new THREE.Vector3());
  const ankleNow = foot.getWorldPosition(new THREE.Vector3());
  const arc2 = new THREE.Quaternion().setFromUnitVectors(
    ankleNow.clone().sub(kneeNow).normalize(),
    target.clone().sub(kneeNow).normalize(),
  );
  const lowerWorldNew = arc2.clone().multiply(lowerLeg.getWorldQuaternion(new THREE.Quaternion()));
  // ローカル変換は実際の親基準(分割骨が挟まるリグに対応)
  const lowerParent = lowerLeg.parent;
  if (!lowerParent) return;
  const lowerParentInv = lowerParent.getWorldQuaternion(new THREE.Quaternion()).invert();
  lowerLeg.quaternion.copy(lowerParentInv.multiply(lowerWorldNew));
  lowerLeg.updateWorldMatrix(true, false);
  foot.updateWorldMatrix(true, false);

  // --- 足: FKのワールド向きを維持(すねが動いたぶんローカルを逆補正) ---
  const lowerWorldInv = lowerLeg.getWorldQuaternion(new THREE.Quaternion()).invert();
  foot.quaternion.copy(lowerWorldInv.multiply(footWorldFK));
}
