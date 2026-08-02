import * as THREE from 'three';
import type { Pose } from '../types/Pose';
import type { BoneName } from '../types/Pose';
import type { BoneMap } from './BoneMapper';

type Side = 'L' | 'R';

// pose.ik の型。import-mixamo が接触ポーズにだけ焼く、手首IKの目標点(hipsローカル・マネキン尺)。
type IkTargets = Partial<Record<`hand_${Side}`, [number, number, number]>>;

/**
 * applyPose の直後に呼ぶ。pose.ik に接触目標のある腕だけを、2ボーン解析IK(余弦定理)で
 * 手首が目標点に届くよう調整する。目標の無い腕には一切触れない(FK表示のまま)。
 *
 * ★ ARPリグ版の設計: FKの姿勢を作り直すのではなく、FKの上腕・前腕の回転に
 *   「最小の差分回転(shortestArc)」だけを乗せる。これによりFKが持つ腕のひねり
 *   (ロール)がそのまま保たれ、ひねりに敏感な解剖学メッシュの肩が捻れない。
 *   手はFKのワールド向きを維持する(前腕が動いたぶんローカルを逆補正)。
 *
 * pose.noIk === true のポーズは丸ごとスキップ(誤爆ポーズの個別オフ用の安全弁)。
 * 骨の長さはリグ実体(子ボーンのローカル位置)から取るので、寸法定数には依存しない。
 * 肘の曲がる向きは、IK前(FK)の肘位置をヒントに使い、元のポーズらしい向きを保つ。
 */
export function applyArmIK(boneMap: BoneMap, pose: Pose): void {
  if ((pose as { noIk?: boolean }).noIk) return;

  const ik = (pose as { ik?: IkTargets }).ik;
  if (!ik) return; // 接触ポーズ以外は何もしない

  const hips = boneMap['hips' as BoneName];
  if (!hips) return;
  // applyPose 後の姿勢を確定(以降の getWorld* が正しい値を返すように)
  hips.updateWorldMatrix(true, true);

  for (const side of ['L', 'R'] as Side[]) {
    const ikTarget = ik[`hand_${side}`];
    if (!ikTarget) continue; // 目標の無い腕はFKのまま

    const upperArm = boneMap[`upperArm_${side}` as BoneName];
    const lowerArm = boneMap[`lowerArm_${side}` as BoneName];
    const hand = boneMap[`hand_${side}` as BoneName];
    if (!upperArm || !lowerArm || !hand) continue;
    const parent = upperArm.parent;
    if (!parent) continue;

    // 骨の長さ(肩→肘 / 肘→手首)をリグから取得
    const L1 = lowerArm.position.length();
    const L2 = hand.position.length();

    // FKの現在ワールド状態を控える
    const S = upperArm.getWorldPosition(new THREE.Vector3());
    const elbowFK = lowerArm.getWorldPosition(new THREE.Vector3());
    const wristFK = hand.getWorldPosition(new THREE.Vector3());
    const handWorldFK = hand.getWorldQuaternion(new THREE.Quaternion());

    // 目標を hips ローカル→ワールドへ(胴が回っていても接触点が体に追従)
    const T = hips.localToWorld(new THREE.Vector3(ikTarget[0], ikTarget[1], ikTarget[2]));

    // --- 平面内2ボーンIK ---
    const n = T.clone().sub(S);
    const dist = THREE.MathUtils.clamp(n.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    n.normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));

    // 肘のふくらむ向き = FK肘の、S→T直線に対して垂直な成分
    const pole = elbowFK.clone().sub(S);
    pole.addScaledVector(n, -pole.dot(n));
    if (pole.lengthSq() < 1e-8) {
      pole.set(0, 0, 1).addScaledVector(n, -n.z);
      if (pole.lengthSq() < 1e-8) pole.set(1, 0, 0).addScaledVector(n, -n.x);
    }
    pole.normalize();
    const elbow = S.clone().addScaledVector(n, a).addScaledVector(pole, h);

    // --- 上腕: FKの向きに「FK肘方向→新肘方向」の最小回転を乗せる(ひねり温存) ---
    const arc1 = new THREE.Quaternion().setFromUnitVectors(
      elbowFK.clone().sub(S).normalize(),
      elbow.clone().sub(S).normalize(),
    );
    const upperWorldNew = arc1.clone().multiply(upperArm.getWorldQuaternion(new THREE.Quaternion()));
    const parentWorldInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    upperArm.quaternion.copy(parentWorldInv.multiply(upperWorldNew));
    upperArm.updateWorldMatrix(true, false);

    // --- 前腕: 同様に「現在の手首方向→新手首方向」の最小回転を乗せる ---
    const elbowNow = lowerArm.getWorldPosition(new THREE.Vector3());
    const wristNow = hand.getWorldPosition(new THREE.Vector3());
    const arc2 = new THREE.Quaternion().setFromUnitVectors(
      wristNow.clone().sub(elbowNow).normalize(),
      T.clone().sub(elbowNow).normalize(),
    );
    const lowerWorldNew = arc2.clone().multiply(lowerArm.getWorldQuaternion(new THREE.Quaternion()));
    const upperWorldInv = upperArm.getWorldQuaternion(new THREE.Quaternion()).invert();
    lowerArm.quaternion.copy(upperWorldInv.multiply(lowerWorldNew));
    lowerArm.updateWorldMatrix(true, false);

    // --- 手首: FKのワールド向きを維持(前腕が動いたぶんローカルを逆補正) ---
    const lowerWorldInv = lowerArm.getWorldQuaternion(new THREE.Quaternion()).invert();
    hand.quaternion.copy(lowerWorldInv.multiply(handWorldFK));
  }
}