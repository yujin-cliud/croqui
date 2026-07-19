import * as THREE from 'three';
import { MANNEQUIN_DIMENSIONS, MANNEQUIN_COLOR, MANNEQUIN_JOINT_COLOR, FINGER_LENGTH_SCALES, TOE_SCALES } from '../constants/mannequin';
import type { BoneName } from '../types/Pose';

export type MannequinModel = {
  root: THREE.Group;
};

type Side = 'L' | 'R';

// 配布物にモデル資産（glTF等）が含まれていないため、Three.jsのプリミティブ形状を
// 組み合わせてデッサン用の木製アーティストマネキンを生成する。
// 各関節はTHREE.Groupとして表現し、`userData.bone`にPose JSONと対応する
// ボーン名を持たせることで、BoneMapperが後から機械的に収集できるようにする。

function createJointSphere(radius: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 10), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 角を丸めた多角形のShapeを作る(頂点列は反時計回り)。各角は隣接辺方向へ
// cornerRadiusぶん手前から曲線でつなぐことで、木製マネキンらしい丸みを出す。
function createRoundedPolygonShape(points: THREE.Vector2[], cornerRadius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const count = points.length;

  const edgePoint = (from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2 => {
    const direction = to.clone().sub(from);
    const distance = Math.min(cornerRadius, direction.length() / 2);
    return from.clone().add(direction.normalize().multiplyScalar(distance));
  };

  for (let i = 0; i < count; i += 1) {
    const previous = points[(i + count - 1) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    const start = edgePoint(current, previous);
    const end = edgePoint(current, next);

    if (i === 0) {
      shape.moveTo(start.x, start.y);
    } else {
      shape.lineTo(start.x, start.y);
    }
    // 角そのものを制御点にした2次曲線で丸める
    shape.quadraticCurveTo(current.x, current.y, end.x, end.y);
  }
  shape.closePath();
  return shape;
}

// 上下で幅の異なる、角を丸めた台形ブロックのジオメトリを作る(中心が原点)。
// 骨盤(逆三角形)と胸(下すぼまりの台形)の両方で使う。
function createTaperedBlockGeometry(options: {
  topWidth: number;
  bottomWidth: number;
  height: number;
  depth: number;
  bevel: number;
  cornerRadius: number;
}): THREE.ExtrudeGeometry {
  const halfTop = options.topWidth / 2;
  const halfBottom = options.bottomWidth / 2;
  const halfHeight = options.height / 2;

  // 反時計回り: 右上 → 左上 → 左下 → 右下
  const outline = [
    new THREE.Vector2(halfTop, halfHeight),
    new THREE.Vector2(-halfTop, halfHeight),
    new THREE.Vector2(-halfBottom, -halfHeight),
    new THREE.Vector2(halfBottom, -halfHeight),
  ];
  const shape = createRoundedPolygonShape(outline, options.cornerRadius);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: options.depth,
    bevelEnabled: true,
    bevelThickness: options.bevel,
    bevelSize: options.bevel,
    bevelSegments: 3,
    curveSegments: 8,
  });
  // 押し出しはZ+方向へ伸びるため、中心を原点へ揃える(X/Yは元々対称)
  geometry.center();
  return geometry;
}

// 骨盤: 上辺が広く下へ向かって細くなる、丸みのある逆三角形の立体。
// グループの原点・回転軸は従来のまま(メッシュのみ僅かに下へオフセット)。
function createPelvisMesh(material: THREE.Material): THREE.Mesh {
  const d = MANNEQUIN_DIMENSIONS;
  const geometry = createTaperedBlockGeometry({
    topWidth: d.pelvisTopWidth,
    bottomWidth: d.pelvisBottomWidth,
    height: d.pelvisSize[1],
    depth: d.pelvisDepth,
    bevel: d.pelvisBevel,
    cornerRadius: d.pelvisCornerRadius,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = d.pelvisOffsetY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 指1本(Capsule)。ポーズ用ボーンは持たない固定の飾りで、親(手/足)に追従するだけ。
function createDigitMesh(
  radius: number,
  length: number,
  material: THREE.Material
): THREE.Mesh {
  const capsuleLength = Math.max(length - radius * 2, 0.004);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, capsuleLength, 3, 6), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 手: 手のひらの球 + 4本指 + 親指。lowerArmの末端に固定し、関節は追加しない。
// sign: 体の中心から見てどちら側の腕か(L=-1, R=+1)。親指は体の内側に付く。
function createHandGroup(sign: 1 | -1, material: THREE.Material): THREE.Group {
  const d = MANNEQUIN_DIMENSIONS;
  const hand = new THREE.Group();
  hand.name = 'handDecoration';

  const palm = createJointSphere(d.handRadius, material);
  hand.add(palm);

  // 4本指: 手のひら下端からさらに下(-Y)へ、X方向に扇状に並べる
  const fingerCount = FINGER_LENGTH_SCALES.length;
  for (let i = 0; i < fingerCount; i += 1) {
    // 内側(親指側)から順に長さ比率を適用する。内側は左手で+X、右手で-X
    const scaleIndex = sign === 1 ? i : fingerCount - 1 - i;
    const length = d.fingerLength * FINGER_LENGTH_SCALES[scaleIndex];
    const finger = createDigitMesh(d.fingerRadius, length, material);
    const offsetX = (i - (fingerCount - 1) / 2) * d.fingerGap;
    finger.position.set(offsetX, -(d.handRadius + length / 2 - d.fingerRadius), 0);
    hand.add(finger);
  }

  // 親指: 体の内側へ、少し外向きに傾けて付ける
  const thumbSign = -sign;
  const thumb = createDigitMesh(d.thumbRadius, d.thumbLength, material);
  thumb.position.set(thumbSign * d.handRadius * 0.85, -d.handRadius * 0.55, 0);
  thumb.rotation.z = thumbSign * d.thumbAngle;
  hand.add(thumb);

  return hand;
}

// 足指5本を足の甲メッシュへ追加する。関節は追加しない固定の飾り。
// sign: L=-1, R=+1。親指(太い指)は体の内側に来る。
function addToes(footMesh: THREE.Mesh, sign: 1 | -1, material: THREE.Material): void {
  const d = MANNEQUIN_DIMENSIONS;
  const toeCount = TOE_SCALES.length;

  for (let i = 0; i < toeCount; i += 1) {
    // iはX-側→X+側の並び。内側から順に太さ/長さ比率を適用する(内側は左足で+X、右足で-X)
    const scaleIndex = sign === 1 ? i : toeCount - 1 - i;
    const scale = TOE_SCALES[scaleIndex];
    const radius = d.toeRadius * scale;
    const length = d.toeLength * scale;

    const toe = createDigitMesh(radius, length, material);
    // Capsuleは+Y向きなのでX軸90°回転で前方(+Z)へ向ける
    toe.rotation.x = Math.PI / 2;
    const offsetX = (i - (toeCount - 1) / 2) * d.toeGap;
    toe.position.set(
      offsetX,
      -d.footSize[1] / 2 + radius,
      d.footSize[2] / 2 + length / 2 - radius
    );
    footMesh.add(toe);
  }
}

function createLimbBone(
  boneName: BoneName,
  length: number,
  radius: number,
  material: THREE.Material
): THREE.Group {
  const bone = new THREE.Group();
  bone.name = boneName;
  bone.userData.bone = boneName;

  // 付け根側が太く末端側が細い、先細りの円柱。両端の関節球やパーツが継ぎ目を隠す
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * MANNEQUIN_DIMENSIONS.limbTaperRatio, length, 10),
    material
  );
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  bone.add(mesh);

  return bone;
}

export function createMannequin(): MannequinModel {
  const d = MANNEQUIN_DIMENSIONS;
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: MANNEQUIN_COLOR,
    roughness: 0.85,
    metalness: 0.05,
  });
  const jointMaterial = new THREE.MeshStandardMaterial({
    color: MANNEQUIN_JOINT_COLOR,
    roughness: 0.7,
    metalness: 0.1,
  });

  const root = new THREE.Group();
  root.name = 'mannequinRoot';

  const hipHeight = d.footHeight + d.lowerLegLength + d.upperLegLength;

  // Hips: ルートボーン（骨盤）。カメラの注視点もここを基準にする。
  const hips = new THREE.Group();
  hips.name = 'hips';
  hips.userData.bone = 'hips';
  hips.position.set(0, hipHeight, 0);
  root.add(hips);

  const pelvisMesh = createPelvisMesh(bodyMaterial);
  hips.add(pelvisMesh);

  // Spine -> Chest -> Head
  const spine = new THREE.Group();
  spine.name = 'spine';
  spine.userData.bone = 'spine';
  spine.position.set(0, d.pelvisSize[1] / 2, 0);
  hips.add(spine);

  // 腰の球: 胸と骨盤の間のくびれ部分。スパイン関節に追従して曲がる
  const spineMesh = createJointSphere(d.waistRadius, bodyMaterial);
  spineMesh.position.y = d.spineLength / 2;
  spine.add(spineMesh);

  const chest = new THREE.Group();
  chest.name = 'chest';
  chest.userData.bone = 'chest';
  chest.position.set(0, d.spineLength, 0);
  spine.add(chest);

  const chestMesh = new THREE.Mesh(
    createTaperedBlockGeometry({
      topWidth: d.chestTopWidth,
      bottomWidth: d.chestBottomWidth,
      height: d.chestSize[1],
      depth: d.chestDepth,
      bevel: d.chestBevel,
      cornerRadius: d.chestCornerRadius,
    }),
    bodyMaterial
  );
  chestMesh.position.y = d.chestSize[1] / 2;
  chestMesh.castShadow = true;
  chestMesh.receiveShadow = true;
  chest.add(chestMesh);

  const head = new THREE.Group();
  head.name = 'head';
  head.userData.bone = 'head';
  head.position.set(0, d.chestSize[1] + d.neckLength, 0);
  chest.add(head);

  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, d.neckLength, 8), bodyMaterial);
  neckMesh.position.y = -d.neckLength / 2;
  neckMesh.castShadow = true;
  head.add(neckMesh);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(d.headRadius, 16, 12), bodyMaterial);
  headMesh.position.y = d.headRadius;
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  head.add(headMesh);

  // Arms
  const sides: Array<{ side: Side; sign: 1 | -1 }> = [
    { side: 'L', sign: -1 },
    { side: 'R', sign: 1 },
  ];

  for (const { side, sign } of sides) {
    const shoulderPosition = new THREE.Vector3((d.shoulderWidth / 2) * sign, d.chestSize[1] * 0.85, 0);

    const shoulderJoint = createJointSphere(d.jointRadius, jointMaterial);
    shoulderJoint.position.copy(shoulderPosition);
    chest.add(shoulderJoint);

    const upperArmName = `upperArm_${side}` as BoneName;
    const upperArm = createLimbBone(upperArmName, d.upperArmLength, d.armRadius, bodyMaterial);
    upperArm.position.copy(shoulderPosition);
    chest.add(upperArm);

    const elbowJoint = createJointSphere(d.jointRadius * 0.85, jointMaterial);
    elbowJoint.position.set(0, -d.upperArmLength, 0);
    upperArm.add(elbowJoint);

    const lowerArmName = `lowerArm_${side}` as BoneName;
    const lowerArm = createLimbBone(lowerArmName, d.lowerArmLength, d.armRadius * 0.85, bodyMaterial);
    lowerArm.position.set(0, -d.upperArmLength, 0);
    upperArm.add(lowerArm);

    const hand = createHandGroup(sign, bodyMaterial);
    hand.position.set(0, -d.lowerArmLength, 0);
    lowerArm.add(hand);
  }

  // Legs
  for (const { side, sign } of sides) {
    const hipJointPosition = new THREE.Vector3((d.hipWidth / 2) * sign, -d.pelvisSize[1] / 2, 0);

    const hipJoint = createJointSphere(d.jointRadius, jointMaterial);
    hipJoint.position.copy(hipJointPosition);
    hips.add(hipJoint);

    const upperLegName = `upperLeg_${side}` as BoneName;
    const upperLeg = createLimbBone(upperLegName, d.upperLegLength, d.legRadius, bodyMaterial);
    upperLeg.position.copy(hipJointPosition);
    hips.add(upperLeg);

    const kneeJoint = createJointSphere(d.jointRadius * 0.9, jointMaterial);
    kneeJoint.position.set(0, -d.upperLegLength, 0);
    upperLeg.add(kneeJoint);

    const lowerLegName = `lowerLeg_${side}` as BoneName;
    const lowerLeg = createLimbBone(lowerLegName, d.lowerLegLength, d.legRadius * 0.85, bodyMaterial);
    lowerLeg.position.set(0, -d.upperLegLength, 0);
    upperLeg.add(lowerLeg);

    const footName = `foot_${side}` as BoneName;
    const foot = new THREE.Group();
    foot.name = footName;
    foot.userData.bone = footName;
    foot.position.set(0, -d.lowerLegLength, 0);
    lowerLeg.add(foot);

    const footMesh = new THREE.Mesh(new THREE.BoxGeometry(...d.footSize), bodyMaterial);
    footMesh.position.set(0, -d.footSize[1] / 2, d.footSize[2] / 2 - d.legRadius);
    footMesh.castShadow = true;
    footMesh.receiveShadow = true;
    addToes(footMesh, sign, bodyMaterial);
    foot.add(footMesh);
  }

  return { root };
}

// Viewerからは非同期のロードとして扱う。実際は同期生成だが、将来glTF等の
// 実ファイル読み込みに差し替えても呼び出し側のインターフェースが変わらないようにするため、
// また失敗時の再読み込みUI（docs/05, docs/12）と挙動を揃えるためPromise化している。
export function loadMannequin(): Promise<MannequinModel> {
  return new Promise((resolve, reject) => {
    try {
      const model = createMannequin();
      resolve(model);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('モデルの読み込みに失敗しました'));
    }
  });
}
