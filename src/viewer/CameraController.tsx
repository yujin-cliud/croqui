import { useEffect, useRef } from 'react';
import type { ElementRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { MOUSE, Vector3 } from 'three';
import { VIEWER_CAMERA, VIEWER_WHEEL_ZOOM } from '../constants/viewer';
import { useViewerStore } from '../stores/ViewerStore';

// 補間係数(smoothing)の基準フレームレート。実フレーム時間に応じて換算する
const REFERENCE_FPS = 60;

// 毎フレームのベクトル計算用スクラッチ(GC負荷を避けるため使い回す)
const scratchDirection = new Vector3();

// カメラ操作とカメラリセット（docs/05, docs/04）を担当する。
// Three.jsのOrbitControls操作はこのファイルに閉じ込め、UIからは
// ViewerStore.requestCameraReset()経由でのみリセットを要求させる。
// refの型はdreiのOrbitControls自体から導出し、three-stdlibへの直接依存を避ける。
//
// ホイールズームはOrbitControlsに渡さず、このコンポーネントが
// 「目標距離を少しずつ更新し、毎フレーム補間で追いかける」方式で処理する
// (1ノッチの変化を小さく、かつ滑らかにするため。docs/04)。
// タッチのピンチズームは従来どおりOrbitControlsに任せる。
export function CameraController() {
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const gl = useThree((state) => state.gl);
  // ホイールで更新される「目標」カメラ距離。実距離は毎フレームこれへ補間される
  const targetDistanceRef = useRef(VIEWER_CAMERA.defaultDistance);
  // ドラッグ・ピンチ操作中は補間を止める(ピンチによる距離変更と喧嘩しないため)
  const isInteractingRef = useRef(false);
  const cameraResetRequested = useViewerStore((state) => state.cameraResetRequested);
  const clearCameraReset = useViewerStore((state) => state.clearCameraReset);

  useEffect(() => {
    if (!cameraResetRequested) return;

    const controls = controlsRef.current;
    if (controls) {
      controls.object.position.set(...VIEWER_CAMERA.position);
      controls.target.set(...VIEWER_CAMERA.target);
      controls.update();
      targetDistanceRef.current = VIEWER_CAMERA.defaultDistance;
    }
    clearCameraReset();
  }, [cameraResetRequested, clearCameraReset]);

  // ホイールイベントをcanvasの親要素にキャプチャ段階で登録し、
  // OrbitControls(canvas上のリスナー)へ届く前に横取りする
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return undefined;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const { wheelDeltaPerNotch, maxNotchesPerEvent, perNotchScale } = VIEWER_WHEEL_ZOOM;
      const notches = Math.max(
        -maxNotchesPerEvent,
        Math.min(maxNotchesPerEvent, event.deltaY / wheelDeltaPerNotch),
      );
      // deltaY > 0(手前へ回す)で引き、< 0(奥へ回す)で寄る
      const next = targetDistanceRef.current * Math.pow(perNotchScale, -notches);
      targetDistanceRef.current = Math.min(
        VIEWER_CAMERA.maxDistance,
        Math.max(VIEWER_CAMERA.minDistance, next),
      );
    };

    parent.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    return () => parent.removeEventListener('wheel', handleWheel, { capture: true });
  }, [gl]);

  // 実距離を目標距離へ毎フレーム補間する(指数減衰なので終端ほどゆっくり止まる)
  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls || isInteractingRef.current) return;

    const camera = controls.object;
    const current = camera.position.distanceTo(controls.target);
    const diff = targetDistanceRef.current - current;
    if (Math.abs(diff) < VIEWER_WHEEL_ZOOM.snapEpsilon) return;

    // フレームレートに依存しない補間係数(60fps時にsmoothingと一致)
    const t = 1 - Math.pow(1 - VIEWER_WHEEL_ZOOM.smoothing, delta * REFERENCE_FPS);
    const nextDistance = current + diff * t;
    scratchDirection.subVectors(camera.position, controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(scratchDirection, nextDistance);
  });

  const handleInteractionStart = () => {
    isInteractingRef.current = true;
  };

  const handleInteractionEnd = () => {
    isInteractingRef.current = false;
    // ピンチ等で実距離が変わっていた場合、目標距離を実距離に合わせ直す
    const controls = controlsRef.current;
    if (controls) {
      targetDistanceRef.current = controls.object.position.distanceTo(controls.target);
    }
  };

  return (
    <OrbitControls
      ref={controlsRef}
      target={[VIEWER_CAMERA.target[0], VIEWER_CAMERA.target[1], VIEWER_CAMERA.target[2]]}
      minDistance={VIEWER_CAMERA.minDistance}
      maxDistance={VIEWER_CAMERA.maxDistance}
      zoomSpeed={VIEWER_CAMERA.zoomSpeed}
      mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }}
      maxPolarAngle={Math.PI * 0.49}
      enableDamping
      dampingFactor={0.08}
      onStart={handleInteractionStart}
      onEnd={handleInteractionEnd}
    />
  );
}
