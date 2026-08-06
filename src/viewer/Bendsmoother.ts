import * as THREE from 'three';
import type { BoneName } from '../types/Pose';
import type { BoneMap } from './BoneMapper';

// 深い曲げ(膝・肘)のベンド分散。
// 関節を100°超まで畳むと、リニアブレンドスキニングでは折り目1点に変形が集中し、
// メッシュが潰れて膨らむ。分割骨リグ(例: 女性ボディの thigh_stretch=モモ中間骨)では、
// 曲げの超過分の一部を中間骨に分担させることで折り目が2段になり、潰れが大幅に減る。
//  ・発動条件: 曲げ角が THRESH(100°)を超えたときだけ。通常ポーズは一切変えない。
//  ・分担後も末端(すね/前腕)の向きは元のまま保つ(中間で曲げた分を関節で戻す)。
//  ・中間骨が分離していないリグ(標準ボディ=同位置の枝)は自動スキップ。
const THRESH = (100 * Math.PI) / 180;
const FRACTION_ABOVE = 0;  // モモ側を減らす(支点のズレが減る)
const FRACTION_BELOW = 0.4;  // すね側に多めに逃がす(膝は動かない)

type Limb = [BoneName, BoneName, BoneName];
const LIMBS: Limb[] = [
  ['upperLeg_L' as BoneName, 'lowerLeg_L' as BoneName, 'foot_L' as BoneName],
  ['upperLeg_R' as BoneName, 'lowerLeg_R' as BoneName, 'foot_R' as BoneName],
  ['upperArm_L' as BoneName, 'lowerArm_L' as BoneName, 'hand_L' as BoneName],
  ['upperArm_R' as BoneName, 'lowerArm_R' as BoneName, 'hand_R' as BoneName],
];

export function applyBendSmoothing(boneMap: BoneMap): void {
  for (const [uRole, lRole, eRole] of LIMBS) {
    const upper = boneMap[uRole];
    const lower = boneMap[lRole];
    const end = boneMap[eRole];
    if (!upper || !lower || !end) continue;

    // upper と lower の間の中間骨を集め、毎回バインド姿勢へ戻す。
    // applyPoseはrole対応ボーンしかリセットしないため、リセットを怠ると
    // 前回の分散回転が中間骨に残り、ポーズ切替のたびに蓄積して体が沈む
    // (male2実機で発生した「ぐにゃり沈み込み」の真因)。
    const midsAbove: THREE.Object3D[] = [];
    let p = lower.parent;
    let reachedUpper = false;
    while (p) {
      if (p === upper) { reachedUpper = true; break; }
      midsAbove.push(p);
      p = p.parent;
    }
    if (!reachedUpper) continue;
    const midsBelow: THREE.Object3D[] = [];
    p = end.parent;
    let reachedLower = false;
    while (p) {
      if (p === lower) { reachedLower = true; break; }
      midsBelow.push(p);
      p = p.parent;
    }
    if (!reachedLower) continue;
    for (const m of [...midsAbove, ...midsBelow]) {
      const mud = m.userData as { bendBind?: THREE.Quaternion };
      if (!mud.bendBind) mud.bendBind = m.quaternion.clone();
      m.quaternion.copy(mud.bendBind);
    }
    const midAbove = midsAbove.find((m) => m.position.length() > 0.03) ?? null;
    const midBelow = midsBelow.find((m) => m.position.length() > 0.03) ?? null;
    if (!midAbove && !midBelow) continue; // 分離した中間骨が無いリグ(標準ボディ)はスキップ

    upper.updateWorldMatrix(true, false);
    lower.updateWorldMatrix(true, false);
    end.updateWorldMatrix(true, false);
    const S = upper.getWorldPosition(new THREE.Vector3());
    const K = lower.getWorldPosition(new THREE.Vector3());
    const E = end.getWorldPosition(new THREE.Vector3());
    const d1 = K.clone().sub(S).normalize();
    const d2 = E.clone().sub(K).normalize();
    const bend = d1.angleTo(d2);
    if (bend <= THRESH) continue;

    const axis = new THREE.Vector3().crossVectors(d1, d2);
    if (axis.lengthSq() < 1e-8) continue;
    axis.normalize();
    // 折れ目を「上の中間骨・関節・下の中間骨」の3段に配分し、1箇所あたりの曲がりを
    // 小さくする(1点集中の尖り・上側だけの分散によるモモの折れ、の両方を緩和)
    const excess = bend - THRESH;
    const alpha = midAbove ? excess * FRACTION_ABOVE : 0;
    const beta = midBelow ? excess * FRACTION_BELOW : 0;
    const endWorldQ = end.getWorldQuaternion(new THREE.Quaternion());
    const rot = (obj: THREE.Object3D, angle: number) => {
      const parent = obj.parent;
      if (!parent || Math.abs(angle) < 1e-6) return;
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      const worldNew = q.multiply(obj.getWorldQuaternion(new THREE.Quaternion()));
      obj.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldNew));
      obj.updateWorldMatrix(true, false);
    };
    // 上側: 中間骨を+α → 関節で-α(すね/前腕の向きを保つ)
    if (midAbove) {
      rot(midAbove, alpha);
      rot(lower, -alpha);
    }
    // 下側: 関節を-β(曲げを減らす) → 下の中間骨で+β(足/手方向を戻す=膝下に折れ目)
    if (midBelow) {
      rot(lower, -beta);
      rot(midBelow, beta);
    }
    // 末端の向きは元のまま(親が動いた分を逆補正)
    const endParent = end.parent;
    if (!endParent) continue;
    end.quaternion.copy(endParent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(endWorldQ));
  }
}