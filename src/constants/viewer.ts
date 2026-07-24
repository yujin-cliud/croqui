const CAMERA_POSITION = [0, 1.4, 4] as const;
const CAMERA_TARGET = [0, 1, 0] as const;

// ズーム率100%の基準となる初期カメラ距離(position→target)
const CAMERA_DEFAULT_DISTANCE = Math.hypot(
  CAMERA_POSITION[0] - CAMERA_TARGET[0],
  CAMERA_POSITION[1] - CAMERA_TARGET[1],
  CAMERA_POSITION[2] - CAMERA_TARGET[2],
);

// ズーム範囲: 最小50%(引き=距離2倍)〜最大300%(寄り=距離1/3)
const ZOOM_MIN_RATIO = 0.5;
const ZOOM_MAX_RATIO = 3;

export const VIEWER_CAMERA = {
  fov: 35,
  near: 0.1,
  far: 100,
  position: CAMERA_POSITION,
  target: CAMERA_TARGET,
  defaultDistance: CAMERA_DEFAULT_DISTANCE,
  minDistance: CAMERA_DEFAULT_DISTANCE / ZOOM_MAX_RATIO,
  maxDistance: CAMERA_DEFAULT_DISTANCE / ZOOM_MIN_RATIO,
  // OrbitControls側のズーム係数。ホイールズームは CameraController の
  // 独自スムーズズームが担当するため、これはタッチのピンチ操作にのみ効く
  zoomSpeed: 1,
};

// ホイールズームの操作感(docs/04)。イラスト練習向けに1ノッチの変化を小さくし、
// 目標距離へ毎フレーム補間して滑らかに寄る/引く
export const VIEWER_WHEEL_ZOOM = {
  // 1ノッチあたりの距離倍率。0.987 = 約1.3%ずつ(従来5%の約26%)
  perNotchScale: 0.950,
  // ブラウザ標準(deltaMode=pixel)で1ノッチ相当のdeltaY
  wheelDeltaPerNotch: 100,
  // 1イベントで進める最大ノッチ数(高速ホイールや慣性スクロールの暴走防止)
  maxNotchesPerEvent: 3,
  // 60fps基準で1フレームに目標距離へ近づける割合(指数減衰の補間係数)
  smoothing: 0.18,
  // この距離差以下になったら補間を打ち切って目標値へスナップする
  snapEpsilon: 0.0005,
};
