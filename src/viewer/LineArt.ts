import * as THREE from 'three';

// 線画モード。ONにすると:
//   ① 体のマテリアルをトゥーン(段階的なベタ塗り)に差し替え
//   ② 背面法のアウトライン(メッシュ複製を法線方向に膨らませ、裏面だけ黒で描く)を重ねる
// OFFで元のマテリアルに完全復元する。スキンメッシュは骨格を共有するので全ポーズに追従する。
// モデル(体型)には依存しない。影(castShadow等)はトゥーンでもそのまま機能する。

const OUTLINE_THICKNESS = 0.005; // 輪郭線の太さ(m)。身長1.7m基準で約8mm
const OUTLINE_COLOR = 0x1f1f1f;
const BODY_COLOR = 0xf5f2ec; // 線画時の地の色(わずかに温かい白)
// 凹みインク(筋肉の筋)の調整ノブ: STARTから線が出はじめFULLで最濃
const CAVITY_START = 0.01;
const CAVITY_FULL = 0.8;
const CAVITY_INK = 0.12; // インクの暗さ(0=真っ黒)
const CAVITY_STRENGTH = 0.85; // 全体の濃さ(0〜1)

let toonMaterial: THREE.MeshToonMaterial | null = null;
function getToonMaterial(): THREE.MeshToonMaterial {
  if (toonMaterial) return toonMaterial;
  // 3段のグラデーションマップ(暗・中・明)。RGBA/NearestFilterでバンドをくっきり出す
  const levels = [140, 205, 255];
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((v, i) => {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  const gradient = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  toonMaterial = new THREE.MeshToonMaterial({ color: BODY_COLOR, gradientMap: gradient });
  // 古いthree(〜r150)はSkinnedMeshに使うマテリアルへ skinning フラグが必要(新しい版では無視される)
  (toonMaterial as unknown as { skinning?: boolean }).skinning = true;
  // 凹みインク: tools/bake-cavity.mjs がGLBへ焼いた _CAVITY 属性(筋肉の溝=1)を
  // インクとして描画する。属性が無いモデルでは0扱いで無害。
  toonMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _cavity;\nvarying float vCavity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCavity = _cavity;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCavity;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
	float inkLine = smoothstep(${CAVITY_START.toFixed(2)}, ${CAVITY_FULL.toFixed(2)}, vCavity);
	gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(${CAVITY_INK.toFixed(3)}), inkLine * ${CAVITY_STRENGTH.toFixed(2)});`,
      );
  };
  return toonMaterial;
}

function makeOutline(src: THREE.SkinnedMesh): THREE.SkinnedMesh {
  const mat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  (mat as unknown as { skinning?: boolean }).skinning = true;
  // 頂点シェーダに1行注入: スキニング前に法線方向へ膨らませる → 膨らんだ点ごと骨に追従
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n\ttransformed += objectNormal * ${OUTLINE_THICKNESS.toFixed(4)};`,
    );
  };
  const outline = new THREE.SkinnedMesh(src.geometry, mat);
  outline.bind(src.skeleton, src.bindMatrix);
  outline.position.copy(src.position);
  outline.quaternion.copy(src.quaternion);
  outline.scale.copy(src.scale);
  outline.frustumCulled = false;
  outline.userData.isOutline = true;
  return outline;
}

export function applyLineArt(root: THREE.Object3D, enabled: boolean): void {
  const targets: THREE.SkinnedMesh[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.visible && !mesh.userData.isOutline) targets.push(mesh);
  });
  for (const mesh of targets) {
    if (enabled) {
      if (!mesh.userData.origMaterial) {
        mesh.userData.origMaterial = mesh.material;
        mesh.material = getToonMaterial();
      }
      if (!mesh.userData.outlineObj && mesh.parent) {
        const outline = makeOutline(mesh);
        mesh.parent.add(outline);
        mesh.userData.outlineObj = outline;
      }
    } else {
      if (mesh.userData.origMaterial) {
        mesh.material = mesh.userData.origMaterial as THREE.Material;
        delete mesh.userData.origMaterial;
      }
      const outline = mesh.userData.outlineObj as THREE.Object3D | undefined;
      if (outline) {
        outline.parent?.remove(outline);
        delete mesh.userData.outlineObj;
      }
    }
  }
}