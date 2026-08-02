import * as THREE from 'three';
import type { Pose } from '../types/Pose';
import type { BoneName } from '../types/Pose';
import type { BoneMap } from './BoneMapper';

type Side = 'L' | 'R';

// pose.ik の型。import-mixamo が接触ポーズにだけ焼く、手首IKの目標点(hipsローカル・マネキン尺)。
// ※ types/Pose.ts の Pose に `ik?: IkTargets;` と `noIk?: boolean;` を足すと下のキャストは不要(任意)。
type IkTargets = Partial<Record<`hand_${Side}`, [number, number, number]>>;

/**
 * applyPose の直後に呼ぶ。上腕・前腕を2ボーン解析IK(余弦定理)で回し、手首を目標点へ
 * 届かせる。バインド回転が大きい(upperArm/handとも50°弱)リグではbind×delta(ローカル合成)
 * の結果が信頼できないため、脚・足と同じく「子ボーンの実測位置から求めた向き」で
 * 幾何学的に解き直す。目標位置はpose.ikに接触点があればそれを、無ければFK(bind×delta)の
 * 現在の手首ワールド位置をそのまま使う(位置はpose JSONの意図をある程度保っているため
 * 動かさず、向きだけ再計算する)。
 *
 * pose.noIk === true のポーズは丸ごとスキップ。座り等、自動判定や幾何補正が
 * 誤爆しやすいポーズを個別に手動でオフにするための安全弁(元のFK表示に戻る)。
 *
 * pose.ikのある腕は接触点を hips ローカル→ワールドへ変換して使う。これによりポーズで
 * 胴が回っていても接触点が体に追従する。
 * 骨の長さはリグ実体(子ボーンのローカル位置)から取るので、寸法定数には依存しない。
 * 肘の曲がる向きは、IK前(FK)の肘位置をヒントに使い、元のポーズらしい自然な向きを保つ。
 */
export function applyArmIK(boneMap: BoneMap, pose: Pose): void {
  if ((pose as { noIk?: boolean }).noIk) return;

  const hips = boneMap['hips' as BoneName];
  if (!hips) return;
  // applyPose 後の姿勢を確定(以降の getWorld* が正しい値を返すように)
  hips.updateWorldMatrix(true, true);

  const ik = (pose as { ik?: IkTargets }).ik;

  for (const side of ['L', 'R'] as Side[]) {
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

    // 目標: pose.ikに接触点があれば hips ローカル→ワールドへ変換して使い、
    // 無ければFK(bind×delta)が今示している手首のワールド位置をそのまま使う。
    const ikTarget = ik?.[`hand_${side}`];
    const T = ikTarget
      ? hips.localToWorld(new THREE.Vector3(ikTarget[0], ikTarget[1], ikTarget[2]))
      : hand.getWorldPosition(new THREE.Vector3());
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

    // --- 手首: pose.bones の delta をそのまま前腕ローカルとして使う ---
    // handはbind回転が47°と大きく、bind×delta(PoseApplierの一律処理)では信頼できない
    // (旧マネキンはbind≈恒等だったため、pose JSONのdeltaは「前腕からの相対回転」を
    // ほぼそのままローカル値として表していた)。上のIKで前腕(lowerArm)は正しい向きに
    // 解き直し済みなので、そのローカル子として同じdeltaをそのまま使えば、旧マネキンと
    // 同じ意味(前腕から見た相対回転)を再現でき、handボーン自体の大きなbindを経由しない。
    const handBoneData = pose.bones[`hand_${side}`];
    hand.quaternion.copy(
      handBoneData
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...handBoneData.rotation))
        : new THREE.Quaternion(),
    );
  }
}