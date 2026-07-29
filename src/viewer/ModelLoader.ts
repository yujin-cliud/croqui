import * as THREE from 'three';
import { MANNEQUIN_DIMENSIONS, MANNEQUIN_COLOR, MANNEQUIN_JOINT_COLOR, TOE_SCALES } from '../constants/mannequin';
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
// お腹(腰): 面取りした長方形ブロック
function createBellyMesh(material: THREE.Material): THREE.Mesh {
  const d = MANNEQUIN_DIMENSIONS;
  const halfW = d.bellyWidth / 2;
  const halfH = d.bellyHeight / 2;

  const outline = [
  new THREE.Vector2( halfW,  halfH),
  new THREE.Vector2(-halfW,  halfH),
  new THREE.Vector2(-halfW, -halfH),
  new THREE.Vector2( halfW, -halfH),
];

const shape = createRoundedPolygonShape(
  outline,
  d.bellyHeight * 0.22
);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d.bellyDepth,
    bevelEnabled: true,
    bevelThickness: d.bellyBevel,
    bevelSize: d.bellyBevel,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geometry.center();

  const mesh = new THREE.Mesh(geometry, material);
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
  // 丸みが0なら純粋な4角形（直線のみ）にして、余分な角の分割を防ぐ。
  // 丸みがある場合だけ角を曲線でつなぐ。
  let shape: THREE.Shape;
  if (options.cornerRadius <= 0) {
    shape = new THREE.Shape();
    shape.moveTo(outline[0].x, outline[0].y);
    for (let i = 1; i < outline.length; i += 1) {
      shape.lineTo(outline[i].x, outline[i].y);
    }
    shape.closePath();
  } else {
    shape = createRoundedPolygonShape(outline, options.cornerRadius);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: options.depth,
    bevelEnabled: options.bevel > 0,
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

  const halfHeight = d.pelvisSize[1] / 2;
  const halfTop = d.pelvisTopWidth / 2;
  const halfBottom = d.pelvisBottomWidth / 2;

  const cornerRadius = d.pelvisCornerRadius;
  const bottomCurveDepth = d.pelvisSize[1] * 0.35;

  // 台形の4頂点
  const topLeft = new THREE.Vector2(-halfTop, halfHeight);
  const topRight = new THREE.Vector2(halfTop, halfHeight);
  const bottomRight = new THREE.Vector2(halfBottom, -halfHeight);
  const bottomLeft = new THREE.Vector2(-halfBottom, -halfHeight);

  // 下のお椀カーブの制御点
  const bottomControl = new THREE.Vector2(
    0,
    -halfHeight - bottomCurveDepth
  );

  // 頂点から隣の点へ、指定距離だけ進んだ位置を求める
  const moveToward = (
    from: THREE.Vector2,
    to: THREE.Vector2,
    distance: number
  ): THREE.Vector2 => {
    const direction = to.clone().sub(from);
    const safeDistance = Math.min(distance, direction.length() * 0.45);

    return from
      .clone()
      .add(direction.normalize().multiplyScalar(safeDistance));
  };

  // 下のお椀カーブ上の座標
  const bottomCurvePoint = (t: number): THREE.Vector2 => {
    const oneMinusT = 1 - t;

    return new THREE.Vector2(
      oneMinusT * oneMinusT * bottomRight.x
        + 2 * oneMinusT * t * bottomControl.x
        + t * t * bottomLeft.x,

      oneMinusT * oneMinusT * bottomRight.y
        + 2 * oneMinusT * t * bottomControl.y
        + t * t * bottomLeft.y
    );
  };

  // 下カーブの接続部分だけ少し内側へずらす
  const trimT = THREE.MathUtils.clamp(
    cornerRadius / halfBottom,
    0.06,
    0.18
  );

  const bottomCurveStart = bottomCurvePoint(trimT);
  const bottomCurveEnd = bottomCurvePoint(1 - trimT);

  // 切り取った中央部分のカーブを、元のお椀形状のまま維持する
  const derivativeAtStart = new THREE.Vector2(
    2 * (
      (1 - trimT) * (bottomControl.x - bottomRight.x)
      + trimT * (bottomLeft.x - bottomControl.x)
    ),
    2 * (
      (1 - trimT) * (bottomControl.y - bottomRight.y)
      + trimT * (bottomLeft.y - bottomControl.y)
    )
  );

  const middleCurveControl = bottomCurveStart
    .clone()
    .add(
      derivativeAtStart.multiplyScalar(
        (1 - trimT * 2) / 2
      )
    );

  // 各角の接続位置
  const topLeftOnTop = moveToward(
    topLeft,
    topRight,
    cornerRadius
  );

  const topLeftOnSide = moveToward(
    topLeft,
    bottomLeft,
    cornerRadius
  );

  const topRightOnTop = moveToward(
    topRight,
    topLeft,
    cornerRadius
  );

  const topRightOnSide = moveToward(
    topRight,
    bottomRight,
    cornerRadius
  );

  const bottomRightOnSide = moveToward(
    bottomRight,
    topRight,
    cornerRadius
  );

  const bottomLeftOnSide = moveToward(
    bottomLeft,
    topLeft,
    cornerRadius
  );

  const shape = new THREE.Shape();

  // 左上の上辺側から開始
  shape.moveTo(
    topLeftOnTop.x,
    topLeftOnTop.y
  );

  // 上辺
  shape.lineTo(
    topRightOnTop.x,
    topRightOnTop.y
  );

  // 右上角
  shape.quadraticCurveTo(
    topRight.x,
    topRight.y,
    topRightOnSide.x,
    topRightOnSide.y
  );

  // 右斜辺
  shape.lineTo(
    bottomRightOnSide.x,
    bottomRightOnSide.y
  );

  // 右下角
  shape.quadraticCurveTo(
    bottomRight.x,
    bottomRight.y,
    bottomCurveStart.x,
    bottomCurveStart.y
  );

  // 元のお椀型カーブを維持
  shape.quadraticCurveTo(
    middleCurveControl.x,
    middleCurveControl.y,
    bottomCurveEnd.x,
    bottomCurveEnd.y
  );

  // 左下角
  shape.quadraticCurveTo(
    bottomLeft.x,
    bottomLeft.y,
    bottomLeftOnSide.x,
    bottomLeftOnSide.y
  );

  // 左斜辺
  shape.lineTo(
    topLeftOnSide.x,
    topLeftOnSide.y
  );

  // 左上角
  shape.quadraticCurveTo(
    topLeft.x,
    topLeft.y,
    topLeftOnTop.x,
    topLeftOnTop.y
  );

  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d.pelvisDepth,
    bevelEnabled: true,
    bevelThickness: d.pelvisBevel,
    bevelSize: d.pelvisBevel,
    bevelSegments: 3,
    curveSegments: 12,
  });

  geometry.center();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = d.pelvisOffsetY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}
// 胸：木製デッサン人形のような、上が広く下へ丸く絞られる形
// 胸：左右対称の木製デッサン人形型
function createChestMesh(material: THREE.Material): THREE.Mesh {
  const d = MANNEQUIN_DIMENSIONS;

  const halfHeight = d.chestSize[1] / 2;
  const halfTop = d.chestTopWidth / 2;
  const halfBottom = d.chestBottomWidth / 2;

  /*
   * 右側と左側を完全な鏡写しにしている。
   * 上部は狭く、肩付近で広がり、
   * 胸の下側へ向かって緩やかに絞る形。
   */
  // シンプルな4点の台形（上が広く、下がすぼまる）。反時計回り。
  const outline = [
    new THREE.Vector2(halfTop, halfHeight),      // 右上
    new THREE.Vector2(-halfTop, halfHeight),     // 左上
    new THREE.Vector2(-halfBottom, -halfHeight), // 左下
    new THREE.Vector2(halfBottom, -halfHeight),  // 右下
  ];

  // 上辺をカーブさせた台形。左右の肩の角も丸めてなめらかにつなぐ。
  // ▼▼▼ 上辺カーブの深さ（マイナス=山/膨らむ、プラス=谷/へこむ、0=まっすぐ）▼▼▼
  const topCurveDepth = d.chestSize[1] * -0.18;
  // ▲▲▲ 肩の角の丸み（大きいほど丸い）▼▼▼
  const shoulderCorner = d.chestTopWidth * 0.18;
  // ▲▲▲ ここまで ▲▲▲
  // ▼▼▼ 下の角の丸み（大きいほど丸い。下辺はまっすぐのまま角だけ丸める）▼▼▼
  const bottomCorner = d.chestBottomWidth * 0.02;
  // ▲▲▲ ここまで ▲▲▲
  const shape = new THREE.Shape();
  // 右肩の角の内側から開始 → 右斜辺 → 右下の角の手前
  shape.moveTo(halfTop, halfHeight - shoulderCorner);
  shape.lineTo(halfBottom, -halfHeight + bottomCorner);
  // 右下の角を丸める
  shape.quadraticCurveTo(halfBottom, -halfHeight, halfBottom - bottomCorner, -halfHeight);
  // 下辺（まっすぐ）→ 左下の角の手前
  shape.lineTo(-halfBottom + bottomCorner, -halfHeight);
  // 左下の角を丸める
  shape.quadraticCurveTo(-halfBottom, -halfHeight, -halfBottom, -halfHeight + bottomCorner);
  // 左斜辺 → 左肩の角の手前
  shape.lineTo(-halfTop, halfHeight - shoulderCorner);
  // 左肩の角を丸める
  shape.quadraticCurveTo(-halfTop, halfHeight, -halfTop + shoulderCorner, halfHeight);
  // 上辺のカーブ（中央が topCurveDepth ぶん上下）
  shape.quadraticCurveTo(0, halfHeight - topCurveDepth, halfTop - shoulderCorner, halfHeight);
  // 右肩の角を丸めて閉じる
  shape.quadraticCurveTo(halfTop, halfHeight, halfTop, halfHeight - shoulderCorner);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d.chestDepth,
    bevelEnabled: d.chestBevel > 0,
    bevelThickness: d.chestBevel,
    bevelSize: d.chestBevel,
    bevelSegments: 3,
    curveSegments: 16,
  });

  geometry.center();

  const mesh = new THREE.Mesh(geometry, material);
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

// 手: 平たいヘラ型（デッサン人形の手）。指なし・親指なしのシンプルな一枚板。
// lowerArmの末端に固定し、関節は追加しない。
// sign: 体の中心から見てどちら側の腕か(L=-1, R=+1)。今回は左右対称なので未使用。
function createHandGroup(_sign: 1 | -1, material: THREE.Material): THREE.Group {
  const d = MANNEQUIN_DIMENSIONS;

  const hand = new THREE.Group();
  hand.name = 'handDecoration';

  // ▼▼▼ ここの数字を変えると手の形が変わります ▼▼▼
  const handLength = d.handRadius * 3.0;   // 手の長さ（大きいほど長い手）
  const handWidth = d.handRadius * 1.7;    // 手の幅（大きいほど幅広）
  const handThickness = d.handRadius * 0.5; // 手の厚み（大きいほど分厚い）
  const wristWidth = d.handRadius * 1.1;   // 手首側の幅（指先側より細くするとヘラっぽい）
  const cornerRadius = d.handRadius * 0.45; // 角の丸み（大きいほど丸い先端）
  // ▲▲▲ ここまで ▲▲▲

  // 手首側が細く、指先側が広がる「ヘラ」の輪郭を作る（反時計回り）
  const halfTop = handWidth / 2;      // 指先側の幅（広い）
  const halfBottom = wristWidth / 2;  // 手首側の幅（細い）
  // 手首を原点にして、下へ向かって指先が広がる輪郭
const outline = [
  new THREE.Vector2(halfBottom, 0),          // 手首側 右
  new THREE.Vector2(-halfBottom, 0),         // 手首側 左
  new THREE.Vector2(-halfTop, -handLength),  // 指先側 左
  new THREE.Vector2(halfTop, -handLength),   // 指先側 右
];
  const shape = createRoundedPolygonShape(outline, cornerRadius);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: handThickness,
    bevelEnabled: true,
    bevelThickness: handThickness * 0.25,
    bevelSize: handThickness * 0.25,
    bevelSegments: 2,
    curveSegments: 8,
  });
  // 押し出しの厚みを中心に揃える（手首を原点に置くため）
  geometry.center();

  const palm = new THREE.Mesh(geometry, material);
  // 輪郭を「手首が原点・指先が下」に配置したので、中心を下へずらす
  palm.position.set(0, -handLength / 2, 0);
  palm.castShadow = true;
  palm.receiveShadow = true;
  hand.add(palm);

  return hand;
}// 足: 平たいヘラ型（手と同じ作り）。かかと側が細く、つま先側が広がる一枚板を
// 水平に寝かせて前(+Z)へ向ける。足指なし。footボーンの末端に固定。
function createFootGroup(_sign: 1 | -1, material: THREE.Material): THREE.Group {
  const d = MANNEQUIN_DIMENSIONS;

  const foot = new THREE.Group();
  foot.name = 'footDecoration';

  // ▼▼▼ ここの数字を変えると足の形が変わります ▼▼▼
  const footLength = d.footSize[2];          // 足の長さ(前後、大きいほど長い)
  const toeWidth = d.footSize[0] * 1.2;      // つま先側の幅(広い)
  const heelWidth = d.footSize[0] * 0.65;    // かかと側の幅(細くするとヘラっぽい)
  const footThickness = d.footSize[1] * 0.65;// 足の厚み(甲の高さ)
  const cornerRadius = d.footSize[0] * 0.28; // 角の丸み(つま先の丸さ・かかと幅の半分未満に)
  // ▲▲▲ ここまで ▲▲▲

  const halfToe = toeWidth / 2;      // つま先側(広い)
  const halfHeel = heelWidth / 2;    // かかと側(細い)
  // かかとを原点にして、前へ向かってつま先が広がる輪郭
  const outline = [
  new THREE.Vector2(halfHeel, 0),            // かかと 右
  new THREE.Vector2(-halfHeel, 0),           // かかと 左
  new THREE.Vector2(-halfToe, -footLength),  // つま先 左
  new THREE.Vector2(halfToe, -footLength),   // つま先 右
];
  const shape = createRoundedPolygonShape(outline, cornerRadius);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: footThickness,
    bevelEnabled: true,
    bevelThickness: footThickness * 0.25,
    bevelSize: footThickness * 0.25,
    bevelSegments: 2,
    curveSegments: 8,
  });

  const sole = new THREE.Mesh(geometry, material);
  // 平らな板を水平に寝かせて、つま先を前(+Z)へ向ける
  sole.rotation.x = -Math.PI / 2;
  sole.castShadow = true;
  sole.receiveShadow = true;
  foot.add(sole);

  return foot;
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
  material: THREE.Material,
  startGap = 0,
  endGap = 0
): THREE.Group {
  const bone = new THREE.Group();
  bone.name = boneName;
  bone.userData.bone = boneName;

  // 関節の丸がある側だけ棒を短くする
  const meshLength = Math.max(
    length - startGap - endGap,
    0.01
  );

  const radiusBottom = radius * MANNEQUIN_DIMENSIONS.limbTaperRatio;

  // 直線の円柱ではなく、中央がふくらむ紡錘形(スピンドル)にして丸みを出す。
  // 上端(y=0)→下端(y=-meshLength)の輪郭を回転体(Lathe)にする。両端は平らなフタ付き。
  const BULGE = 0.12; // 中央のふくらみ量(0=円柱と同じ / 上げると樽型で丸く)
  const SEG = 14;
  const profile: THREE.Vector2[] = [new THREE.Vector2(0, 0)]; // 上フタの中心
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;                                  // 0=上, 1=下
    const base = radius + (radiusBottom - radius) * t;  // 直線テーパ
    const round = 1 + BULGE * Math.sin(Math.PI * t);    // 中央で最大にふくらむ
    profile.push(new THREE.Vector2(base * round, -meshLength * t));
  }
  profile.push(new THREE.Vector2(0, -meshLength));      // 下フタの中心

  const limbMaterial = (material as THREE.MeshStandardMaterial).clone();
  limbMaterial.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), limbMaterial);
  mesh.position.y = -startGap;                          // 上端を付け根側の隙間ぶん下げる
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

  const hipHeight = d.footHeight + d.lowerLegLength + d.upperLegLength + d.pelvisSize[1] / 2;

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
  const spineMesh = createBellyMesh(bodyMaterial);
  spineMesh.position.y = d.spineLength * 0.45;
  spine.add(spineMesh);

  const chest = new THREE.Group();
  chest.name = 'chest';
  chest.userData.bone = 'chest';
  chest.position.set(0, d.spineLength, 0);
  spine.add(chest);

  const chestMesh = createChestMesh(bodyMaterial);
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

  // 頭は skull グループにまとめ、非一様スケールで卵型(楕円)にする。
  // 顔の十字(縦=顔の中心線 / 横=目のライン)も skull 内に入れ、同じスケールで
  // 頭表面にピタッと沿わせる(顔の向きが分かる目印)。前方向 = +Z。
  const skull = new THREE.Group();
  skull.position.y = d.headRadius;            // 頭の中心
  skull.scale.set(0.9, 1.15, 1.02);           // x=やや細く / y=縦長 / z=わずかに前後長 → 卵型
  head.add(skull);

  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(d.headRadius, 24, 18), bodyMaterial);
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  skull.add(headMesh);

  // 顔の十字(前面 +Z のみ・表面のわずか外側に沿わせる)
  const faceLineMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.75 });
  const rSurf = d.headRadius * 1.006;         // 表面のちょい外(めり込み/チラつき防止)
  const tubeR = d.headRadius * 0.05;
  const faceArc = (pts: THREE.Vector3[]) => {
    const m = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, tubeR, 6, false),
      faceLineMaterial,
    );
    m.castShadow = true;
    return m;
  };
  // 縦線: 前面の子午線(下→前→上)
  const vPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = THREE.MathUtils.degToRad(-78 + (156 * i) / 24);
    vPts.push(new THREE.Vector3(0, rSurf * Math.sin(a), rSurf * Math.cos(a)));
  }
  skull.add(faceArc(vPts));
  // 横線: 目のライン(前面の水平半円・中心よりわずか下)
  const hy = -d.headRadius * 0.12;
  const hr = Math.sqrt(Math.max(0, rSurf * rSurf - hy * hy));
  const hPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const b = THREE.MathUtils.degToRad(-70 + (140 * i) / 24);
    hPts.push(new THREE.Vector3(hr * Math.sin(b), hy, hr * Math.cos(b)));
  }
  skull.add(faceArc(hPts));

  // Arms
  const sides: Array<{ side: Side; sign: 1 | -1 }> = [
    { side: 'L', sign: -1 },
    { side: 'R', sign: 1 },
  ];

  for (const { side, sign } of sides) {
    const shoulderPosition = new THREE.Vector3(
  (d.shoulderWidth / 2 + d.jointRadius * 0.7) * sign,
  d.chestSize[1] * 0.70,
  0
);
    const shoulderJoint = createJointSphere(
  d.jointRadius* 1.45,
  jointMaterial
);
    shoulderJoint.position.copy(shoulderPosition);
    chest.add(shoulderJoint);

    const upperArmName = `upperArm_${side}` as BoneName;
    const upperArm = createLimbBone(
  upperArmName,
  d.upperArmLength,
  d.armRadius,
  bodyMaterial,
  d.jointRadius * 0.8,
  d.jointRadius * 0.55
);
    upperArm.position.copy(shoulderPosition);
    chest.add(upperArm);

    const elbowJoint = createJointSphere(
  d.jointRadius,
  jointMaterial
);
    elbowJoint.position.set(0, -d.upperArmLength, 0);
    upperArm.add(elbowJoint);

    const lowerArmName = `lowerArm_${side}` as BoneName;
    const lowerArm = createLimbBone(
  lowerArmName,
  d.lowerArmLength,
  d.armRadius * 0.75,
  bodyMaterial,
  d.jointRadius * 0.55,
  0
);
    lowerArm.position.set(0, -d.upperArmLength, 0);
    upperArm.add(lowerArm);

    // 手首の関節ボール（肘・膝と同じ見た目の丸）を前腕の先に置く
    const wristJoint = createJointSphere(d.jointRadius * 0.85, jointMaterial);
    wristJoint.position.set(0, -d.lowerArmLength, 0);
    lowerArm.add(wristJoint);

    // 手首ボーン(hand_L / hand_R): ここが「回転する関節」。
    // ポーズJSONの手首データはこのグループのrotationに書き込まれる。
    // 初期回転はゼロ（applyPoseが上書きしても破綻しないように、90°回転は子側で持つ）。
    const handName = `hand_${side}` as BoneName;
    const handBone = new THREE.Group();
    handBone.name = handName;
    handBone.userData.bone = handName;
    handBone.position.set(0, -d.lowerArmLength, 0);
    lowerArm.add(handBone);

    // 見た目のヘラ型の手。90°回転はこちら（手首ボーンの子）に固定するので、
    // ポーズで手首が動いても手のひらの向きは保たれる。
    const handMesh = createHandGroup(sign, bodyMaterial);
    handMesh.rotation.y = sign * (Math.PI / 2);
    handBone.add(handMesh);
  }

  // Legs
  for (const { side, sign } of sides) {
    const hipJointPosition = new THREE.Vector3(
  (d.hipWidth / 2 + d.jointRadius * 0.4) * sign,
  -d.pelvisSize[1] / 2,
  0
);

    const hipJoint = createJointSphere(
  d.jointRadius,
  jointMaterial
);
    hipJoint.position.copy(hipJointPosition);
    hips.add(hipJoint);

    const upperLegName = `upperLeg_${side}` as BoneName;
    const upperLeg = createLimbBone(
  upperLegName,
  d.upperLegLength,
  d.legRadius,
  bodyMaterial,
  d.jointRadius * 1.1,
  d.jointRadius * 0.8
);
    upperLeg.position.copy(hipJointPosition);
    hips.add(upperLeg);

    const kneeJoint = createJointSphere(
  d.jointRadius *1.2,
  jointMaterial
);
    kneeJoint.position.set(0, -d.upperLegLength, 0);
    upperLeg.add(kneeJoint);

    const lowerLegName = `lowerLeg_${side}` as BoneName;
    const lowerLeg = createLimbBone(
  lowerLegName,
  d.lowerLegLength,
  d.legRadius * 0.75,
  bodyMaterial,
  d.jointRadius * 0.5,
  d.jointRadius * 0.6    // ← 足首ボールの分だけすねを短く
);
    lowerLeg.position.set(0, -d.upperLegLength, 0);
    upperLeg.add(lowerLeg);
    const ankleJoint = createJointSphere(
  d.jointRadius * 0.95,   // 膝(1.2)より小さめ、手首(0.85)よりちょい大きめ
  jointMaterial
);
    ankleJoint.position.set(0, -d.lowerLegLength, 0);  // すねの下端＝足の付け根
    lowerLeg.add(ankleJoint);
    const footName = `foot_${side}` as BoneName;
    const foot = new THREE.Group();
    foot.name = footName;
    foot.userData.bone = footName;
    foot.position.set(0, -d.lowerLegLength, 0);
    lowerLeg.add(foot);

    const footMesh = createFootGroup(sign, bodyMaterial);
    footMesh.rotation.y = sign * (Math.PI / 180) * 8;  // ← 追加：8°外向き
    // 足首の真下に、かかとを少し後ろへ引いて配置(数値で微調整OK)
    footMesh.position.set(0, -d.footHeight, -d.legRadius * 0.65);  // 約22%まで後退
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