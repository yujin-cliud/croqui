import * as THREE from 'three';
import type { Pose } from '../types/Pose';
import type { BoneName } from '../types/Pose';
import type { BoneMap } from './BoneMapper';

// 手足のボーンはローカル -Y 方向へ伸びる(ModelLoader の createLimbBone と同じ規約)。
const DOWN = new THREE.Vector3(0, -1, 0);
type Side = 'L' | 'R';

// 足首(footボーン原点)をこの高さに置くと足の裏が床(y=0)に接する。footHeight相当・調整可。
const ANKLE_HEIGHT = 0.05;
// 全体シフト後、床からこの範囲内にある足を「接地」とみなして脚IKで貼り付ける。
// これより高い足は遊脚(上げ足)とみなしFKのまま残す。
const PLANT_THRESHOLD = 0.10;

/**
 * applyPose の直後・applyArmIK の前に呼ぶ。Mixamoの脚長とマネキンの脚長の差で足が床に
 * めり込む/浮く問題を、(1)体全体の上下シフトで最低足を接地させ、(2)床付近の足を脚2ボーンIKで
 * 床へ貼り付けて直す。上げ足(遊脚)には触らないので歩き・アクションも自然に接地する。
 *
 * pose.noFootIk === true のポーズはスキップ(ジャンプ等の空中ポーズ用の手動veto)。
 * hips.position.y を動かすため、初回の基準高を userData.baseY に記録し毎回そこへ戻して累積を防ぐ。
 */
export function applyFootIK(boneMap: BoneMap, pose: Pose): void {
  const hips = boneMap['hips' as BoneName];
  const footL = boneMap['foot_L' as BoneName];
  const footR = boneMap['foot_R' as BoneName];
  if (!hips || !footL || !footR) return;

  // 基準の腰高を初回に記録し、毎回そこへ戻す(シフトの累積を防ぐ)
  const ud = hips.userData as { baseY?: number };
  if (ud.baseY === undefined) ud.baseY = hips.position.y;
  hips.position.y = ud.baseY;

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
  hips.position.y += ANKLE_HEIGHT - lowest;
  hips.updateWorldMatrix(true, true);

  // 床付近の足だけ脚IKで足首をANKLE_HEIGHTへ(x,zはFKのまま保持)
  for (const side of ['L', 'R'] as Side[]) {
    const foot = side === 'L' ? footL : footR;
    const p = foot.getWorldPosition(new THREE.Vector3());
    if (p.y > ANKLE_HEIGHT + PLANT_THRESHOLD) continue; // 上げ足(遊脚)は接地させない
    solveLegIK(boneMap, side, new THREE.Vector3(p.x, ANKLE_HEIGHT, p.z));
  }
}

/** 股→膝→足首の2ボーン解析IKで、足首を target(ワールド)へ届かせる。腕IKと同型。 */
function solveLegIK(boneMap: BoneMap, side: Side, target: THREE.Vector3): void {
  const upperLeg = boneMap[`upperLeg_${side}` as BoneName];
  const lowerLeg = boneMap[`lowerLeg_${side}` as BoneName];
  const foot = boneMap[`foot_${side}` as BoneName];
  if (!upperLeg || !lowerLeg || !foot) return;
  const parent = upperLeg.parent; // hips
  if (!parent) return;

  const L1 = lowerLeg.position.length(); // 股→膝(太もも)
  const L2 = foot.position.length();     // 膝→足首(すね)

  const S = upperLeg.getWorldPosition(new THREE.Vector3());        // 股関節
  const kneeHint = lowerLeg.getWorldPosition(new THREE.Vector3()); // FK膝(pole)

  const n = target.clone().sub(S);
  const dist = THREE.MathUtils.clamp(n.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  n.normalize();
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));

  // 膝の曲がる向き = FK膝のヒントを S→target 直線に直交させた成分
  const pole = kneeHint.sub(S);
  pole.addScaledVector(n, -pole.dot(n));
  if (pole.lengthSq() < 1e-8) {
    pole.set(0, 0, 1).addScaledVector(n, -n.z); // ヒントが直線上なら前方向へ逃がす
    if (pole.lengthSq() < 1e-8) pole.set(1, 0, 0).addScaledVector(n, -n.x);
  }
  pole.normalize();

  const knee = S.clone().addScaledVector(n, a).addScaledVector(pole, h);

  // 太もも: ローカル -Y を 股→膝 に向ける
  const dir1 = knee.clone().sub(S).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(DOWN, dir1);
  const parentInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  upperLeg.quaternion.copy(parentInv.multiply(q1));
  upperLeg.updateWorldMatrix(true, false);

  // すね: ローカル -Y を 膝→target に向ける
  const dir2 = target.clone().sub(knee).normalize();
  const q2 = new THREE.Quaternion().setFromUnitVectors(DOWN, dir2);
  const upperInv = upperLeg.getWorldQuaternion(new THREE.Quaternion()).invert();
  lowerLeg.quaternion.copy(upperInv.multiply(q2));
  lowerLeg.updateWorldMatrix(true, false);
}