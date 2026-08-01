import * as THREE from 'three';
import type { Pose } from '../types/Pose';
import type { BoneName } from '../types/Pose';
import type { BoneMap } from './BoneMapper';

type Side = 'L' | 'R';

// pose.ik の型。import-mixamo が接触ポーズにだけ焼く、手首IKの目標点(hipsローカル・マネキン尺)。
// ※ types/Pose.ts の Pose に `ik?: IkTargets;` と `noIk?: boolean;` を足すと下のキャストは不要(任意)。
type IkTargets = Partial<Record<`hand_${Side}`, [number, number, number]>>;

/**
 * applyPose の直後に呼ぶ。pose.ik に目標のある腕だけ、上腕・前腕を2ボーン解析IK(余弦定理)で
 * 回して手首を目標点へ届かせる。目標のない腕は何もしない(=従来のFK表示のまま)。
 *
 * pose.noIk === true のポーズは丸ごとスキップ(=IK無効)。座り・ジェスチャー等、接触の自動判定が
 * 誤爆しやすいポーズを個別に手動でオフにするための安全弁。該当ポーズは元のFK表示に戻る。
 *
 * 目標は hips ローカル座標なので、実行時に生きている hips の行列でワールドへ戻す。
 * これによりポーズで胴が回っていても接触点が体に追従する。
 * 骨の長さはリグ実体(子ボーンのローカル位置)から取るので、寸法定数には依存しない。
 * 肘の曲がる向きは、IK前(FK)の肘位置をヒントに使い、元のポーズらしい自然な向きを保つ。
 */
export function applyArmIK(boneMap: BoneMap, pose: Pose): void {
  // オプトイン方式: useIk が明示的にtrueのポーズだけIKを効かせる(誤爆防止)
  if (!(pose as { useIk?: boolean }).useIk) return;

  const ik = (pose as { ik?: IkTargets }).ik;
  if (!ik) return;

  const hips = boneMap['hips' as BoneName];
  if (!hips) return;
  // applyPose 後の姿勢を確定(以降の getWorld* が正しい値を返すように)
  hips.updateWorldMatrix(true, true);

  for (const side of ['L', 'R'] as Side[]) {
    const target = ik[`hand_${side}`];
    if (!target) continue;

    const upperArm = boneMap[`upperArm_${side}` as BoneName];
    const lowerArm = boneMap[`lowerArm_${side}` as BoneName];
    const hand = boneMap[`hand_${side}` as BoneName];
    if (!upperArm || !lowerArm || !hand) continue;
    const parent = upperArm.parent; // chest
    if (!parent) continue;

    // 骨の長さ(肩→肘 / 肘→手首)をリグから取得
    const L1 = lowerArm.position.length();
    const L2 = hand.position.length();
    // 各ボーンのバインド姿勢での「親→子」方向(リグにより -Y とは限らないため、
    // 子ボーンのローカル位置から実際の方向を都度求める)
    const upperArmAim = lowerArm.position.clone().normalize();
    const lowerArmAim = hand.position.clone().normalize();

    // 目標を hips ローカル → ワールドへ
    const T = hips.localToWorld(new THREE.Vector3(target[0], target[1], target[2]));
    // 肩(上腕の原点)ワールド位置。自身の回転には依存しない
    const S = upperArm.getWorldPosition(new THREE.Vector3());
    // 肘の向きヒント = 現在(FK)の肘ワールド位置
    const elbowHint = lowerArm.getWorldPosition(new THREE.Vector3());

    // --- 平面内2ボーンIK ---
    const n = T.clone().sub(S);
    const dist = THREE.MathUtils.clamp(n.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    n.normalize();
    const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist); // 肩→(肘の投影足)
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));         // 肘の直線からの持ち上がり

    // 肘のふくらむ向き = ヒントの、S→T直線に対して垂直な成分
    const pole = elbowHint.sub(S);
    pole.addScaledVector(n, -pole.dot(n));
    if (pole.lengthSq() < 1e-8) {
      // ヒントが直線上に乗ってしまった場合は任意の垂直方向で代用
      pole.set(0, 0, 1).addScaledVector(n, -n.z);
      if (pole.lengthSq() < 1e-8) pole.set(1, 0, 0).addScaledVector(n, -n.x);
    }
    pole.normalize();

    const elbow = S.clone().addScaledVector(n, a).addScaledVector(pole, h);

    // --- 上腕: バインド時の「肩→肘」方向を S→肘 に向ける ---
    const dir1 = elbow.clone().sub(S).normalize();
    const q1 = new THREE.Quaternion().setFromUnitVectors(upperArmAim, dir1);
    const parentWorldInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    upperArm.quaternion.copy(parentWorldInv.multiply(q1));
    upperArm.updateWorldMatrix(true, false);

    // --- 前腕: バインド時の「肘→手首」方向を 肘→T に向ける ---
    const dir2 = T.clone().sub(elbow).normalize();
    const q2 = new THREE.Quaternion().setFromUnitVectors(lowerArmAim, dir2);
    const upperWorldInv = upperArm.getWorldQuaternion(new THREE.Quaternion()).invert();
    lowerArm.quaternion.copy(upperWorldInv.multiply(q2));
    lowerArm.updateWorldMatrix(true, false);
  }
}