import { useMemo, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSettingsStore } from '../stores/SettingsStore';

// 線画モードの「内側の線」(筋肉の溝・顎・膝など)を描くポストプロセス。
// 背面法アウトライン(LineArt.ts)はシルエットの線しか出せないため、
// ここでは法線エッジ検出を使う:
//   ①マネキンだけを法線マテリアルで裏バッファに描く(深度も取る)
//   ②通常の描画をそのまま画面へ
//   ③法線/深度が急に変わるピクセルに黒インクを重ねる=内側の起伏に沿った線
// 線画モードOFFのときは通常描画のみ。床・グリッドには線を出さない(マネキンのみ対象)。

const NORMAL_THRESHOLD = 99.0; // 内側の線の出やすさ(小さいほど線が増える。0.5〜1.5で調整)
const DEPTH_THRESHOLD = 99.0; // 前後の段差の線(輪郭の補強)
const INK_COLOR = new THREE.Color(0x1f1f1f);
const INK_ALPHA = 0.9;

export function LineArtEffect() {
  const lineArtMode = useSettingsStore((state) => state.lineArtMode);
  const { gl, scene, camera } = useThree();

  const fx = useMemo(() => {
    const depthTexture = new THREE.DepthTexture(1, 1);
    const normalTarget = new THREE.WebGLRenderTarget(1, 1, { depthTexture });
    const normalMaterial = new THREE.MeshNormalMaterial();
    const quadScene = new THREE.Scene();
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tNormal: { value: normalTarget.texture },
        tDepth: { value: depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        normalThreshold: { value: NORMAL_THRESHOLD },
        depthThreshold: { value: DEPTH_THRESHOLD },
        inkColor: { value: INK_COLOR },
        inkAlpha: { value: INK_ALPHA },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tNormal;
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float normalThreshold;
        uniform float depthThreshold;
        uniform vec3 inkColor;
        uniform float inkAlpha;
        varying vec2 vUv;
        void main() {
          vec2 px = 1.0 / resolution;
          vec3 n0 = texture2D(tNormal, vUv).rgb;
          float d0 = texture2D(tDepth, vUv).r;
          if (d0 >= 1.0) discard; // 背景
          vec3 nx1 = texture2D(tNormal, vUv + vec2(px.x, 0.0)).rgb;
          vec3 nx2 = texture2D(tNormal, vUv - vec2(px.x, 0.0)).rgb;
          vec3 ny1 = texture2D(tNormal, vUv + vec2(0.0, px.y)).rgb;
          vec3 ny2 = texture2D(tNormal, vUv - vec2(0.0, px.y)).rgb;
          float nEdge = length(n0 - nx1) + length(n0 - nx2) + length(n0 - ny1) + length(n0 - ny2);
          float dx1 = texture2D(tDepth, vUv + vec2(px.x, 0.0)).r;
          float dx2 = texture2D(tDepth, vUv - vec2(px.x, 0.0)).r;
          float dy1 = texture2D(tDepth, vUv + vec2(0.0, px.y)).r;
          float dy2 = texture2D(tDepth, vUv - vec2(0.0, px.y)).r;
          float dEdge = abs(d0 - dx1) + abs(d0 - dx2) + abs(d0 - dy1) + abs(d0 - dy2);
          float nStrength = smoothstep(normalThreshold, normalThreshold + 1.0, nEdge);
          float dStrength = step(depthThreshold, dEdge);
          float strength = max(nStrength, dStrength);
          if (strength < 0.05) discard;
          gl_FragColor = vec4(inkColor, strength * inkAlpha);
        }
      `,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMaterial);
    quad.frustumCulled = false;
    quadScene.add(quad);
    return { normalTarget, normalMaterial, quadScene, quadCamera, quadMaterial };
  }, []);

  useEffect(() => () => {
    fx.normalTarget.dispose();
    fx.quadMaterial.dispose();
  }, [fx]);

  useFrame(() => {
    if (!lineArtMode) {
      gl.render(scene, camera);
      return;
    }
    // 解像度追従
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    if (fx.normalTarget.width !== size.x || fx.normalTarget.height !== size.y) {
      fx.normalTarget.setSize(size.x, size.y);
    }
    (fx.quadMaterial.uniforms.resolution.value as THREE.Vector2).copy(size);

    // ① マネキンだけ法線パスへ(トップレベルの他要素は一時非表示)
    const hidden: THREE.Object3D[] = [];
    for (const child of scene.children) {
      const isMannequin = child.userData.isMannequin === true;
      if (!isMannequin && child.visible) {
        child.visible = false;
        hidden.push(child);
      }
    }
    const prevClearColor = gl.getClearColor(new THREE.Color());
    const prevClearAlpha = gl.getClearAlpha();
    scene.overrideMaterial = fx.normalMaterial;
    gl.setRenderTarget(fx.normalTarget);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(scene, camera);
    scene.overrideMaterial = null;
    gl.setClearColor(prevClearColor, prevClearAlpha);
    for (const child of hidden) child.visible = true;

    // ② 通常描画 → ③ インクを重ねる
    gl.setRenderTarget(null);
    gl.render(scene, camera);
    const prevAutoClear = gl.autoClear;
    gl.autoClear = false;
    gl.render(fx.quadScene, fx.quadCamera);
    gl.autoClear = prevAutoClear;
  }, 1);

  return null;
}
