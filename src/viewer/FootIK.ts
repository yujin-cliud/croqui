import * as THREE from 'three';
import type { Pose } from '../types/Pose';
import type { BoneName } from '../types/Pose';
import type { BoneMap } from './BoneMapper';

type Side = 'L' | 'R';

// 足首(footボーン原点)をこの高さに置くと足の裏が床(y=0)に接する。footHeight相当・調整可。
const ANKLE_HEIGHT = 0.05;
// 全体シフト後、床からこの範囲内にある足を「接地」とみなして脚IKで貼り付ける。
// これより高い足は遊脚(上げ足)とみなしFKのまま残す。
const PLANT_THRESHOLD = 0.10;
// Croqui共通の正面方向。バインド姿勢(直立)はこの向きを向いているという前提で、
// footボーンの「甲の上方向」「つま先方向」をバインドの向きから逆算する。
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * applyPose の直後・applyArmIK の前に呼ぶ。Mixamoの脚長とマネキンの脚長の差で足が床に
 * めり込む/浮く問題を、(1)体全体の上下シフトで最低足を接地させ、(2)床付近の足を脚2ボーンIKで
 * 床へ貼り付けて直す。上げ足(遊脚)は位置(高さ)こそFKのまま保つが、向きの計算(2ボーンIK)は
 * 常時行う。upperLeg/footともバインド回転が非常に大きい(179°/107°)リグでは、bind×delta
 * (ローカル合成)のFK結果自体が信頼できず、遊脚でもねじれてしまうため。
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

  // 両足とも脚IKで向きを解き直す。床付近(接地)ならY座標をANKLE_HEIGHTへ、
  // 上げ足(遊脚)ならFKのY座標のまま(=位置は動かさず向きだけ補正)。x,zはFKのまま保持。
  for (const side of ['L', 'R'] as Side[]) {
    const foot = side === 'L' ? footL : footR;
    const p = foot.getWorldPosition(new THREE.Vector3());
    const grounded = p.y <= ANKLE_HEIGHT + PLANT_THRESHOLD;
    solveLegIK(boneMap, side, new THREE.Vector3(p.x, grounded ? ANKLE_HEIGHT : p.y, p.z));
  }
}

/**
 * 「上方向」と「前方向」の2ベクトルから、この2軸をその通りに向けるワールド回転を作る。
 * up・forwardが直交していなくても、forwardをupに直交する成分だけ使って正規直交基底を組む。
 * (Croquiの`+X`=右手側の規約に合わせ、right = up × forward)
 */
function orientationFromUpAndForward(up: THREE.Vector3, forward: THREE.Vector3): THREE.Quaternion {
  const u = up.clone().normalize();
  const f = forward.clone();
  f.addScaledVector(u, -f.dot(u));
  if (f.lengthSq() < 1e-8) {
    f.set(0, 0, 1).addScaledVector(u, -u.z);
    if (f.lengthSq() < 1e-8) f.set(1, 0, 0).addScaledVector(u, -u.x);
  }
  f.normalize();
  const r = u.clone().cross(f).normalize();
  const m = new THREE.Matrix4().makeBasis(r, u, f);
  return new THREE.Quaternion().setFromRotationMatrix(m);
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
  // 各ボーンのバインド姿勢での「親→子」方向(リグにより -Y とは限らないため、
  // 子ボーンのローカル位置から実際の方向を都度求める)
  const upperLegAim = lowerLeg.position.clone().normalize();
  const lowerLegAim = foot.position.clone().normalize();

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

  // 太もも: バインド時の「股→膝」方向を 股→膝(IK) に向ける
  const dir1 = knee.clone().sub(S).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(upperLegAim, dir1);
  const parentInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  upperLeg.quaternion.copy(parentInv.multiply(q1));
  upperLeg.updateWorldMatrix(true, false);

  // すね: バインド時の「膝→足首」方向を 膝→target に向ける
  const dir2 = target.clone().sub(knee).normalize();
  const q2 = new THREE.Quaternion().setFromUnitVectors(lowerLegAim, dir2);
  const upperInv = upperLeg.getWorldQuaternion(new THREE.Quaternion()).invert();
  lowerLeg.quaternion.copy(upperInv.multiply(q2));
  lowerLeg.updateWorldMatrix(true, false);

  // 足の向き: FK(pose JSONのdelta)を復元するのではなく、接地している以上
  // 「足裏が床と水平・つま先がhipsの正面方向」になる向きを幾何学的に決め直す。
  // pose JSONのdelta値は旧マネキン骨格向けに焼かれたもので、バインド回転が
  // 恒等から遠いリグ(GLB)ではFK値自体が信頼できないため(FK値は遊脚時のみ使う)。
  // すね(lowerLeg→foot)の水平投影はpose deltaの副次的な回転(ねじれ)を拾ってしまい
  // ノイズが大きいため使わず、hipsの正面方向で統一する。
  const hips = boneMap['hips' as BoneName];
  const toeDir = WORLD_FORWARD.clone();
  if (hips) toeDir.applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion()));
  toeDir.y = 0;
  if (toeDir.lengthSq() < 1e-6) toeDir.copy(WORLD_FORWARD);
  toeDir.normalize();

  // footボーン自身の「つま先方向」は、実在すればtoe系の子ボーンの実測位置を正とする
  // (最も信頼できる)。無ければバインド姿勢(直立)からの逆算にフォールバックする。
  const bindWorld = (foot.userData.bindWorld as THREE.Quaternion | undefined) ?? new THREE.Quaternion();
  const toeRef = foot.children.find((c) => c.name.toLowerCase().includes('toe'));
  const localForward = toeRef
    ? toeRef.position.clone().normalize()
    : WORLD_FORWARD.clone().applyQuaternion(bindWorld.clone().invert());
  // 「甲の上方向」はバインド姿勢からの推定値だが、つま先方向(信頼できる方)に
  // 直交させてから使う(つま先方向を優先し、上方向側だけを調整する)。
  const localUp = WORLD_UP.clone().applyQuaternion(bindWorld.clone().invert());
  localUp.addScaledVector(localForward, -localUp.dot(localForward));
  localUp.normalize();

  const sourceQuat = orientationFromUpAndForward(localUp, localForward);
  const targetQuat = orientationFromUpAndForward(WORLD_UP, toeDir);
  const desiredWorldQuat = targetQuat.multiply(sourceQuat.invert());

  const lowerInvW = lowerLeg.getWorldQuaternion(new THREE.Quaternion()).invert();
  foot.quaternion.copy(lowerInvW.multiply(desiredWorldQuat));
  foot.updateWorldMatrix(true, false);
}