import { Canvas } from '@react-three/fiber';
import { ViewerEngine } from '../viewer/ViewerEngine';
import { useViewerStore } from '../stores/ViewerStore';
import { VIEWER_CAMERA } from '../constants/viewer';
import { viewerManager } from '../managers/ViewerManager';
import { TimerWidget } from './TimerWidget';

// UIは表示と操作受付のみを行う。Three.js自体の操作はviewer層(ViewerEngine)に閉じ込める。
export function Viewer() {
  const isModelLoading = useViewerStore((state) => state.isModelLoading);
  const viewerError = useViewerStore((state) => state.viewerError);

  return (
    <section className="viewer-area">
      <Canvas
        shadows
        camera={{
          fov: VIEWER_CAMERA.fov,
          near: VIEWER_CAMERA.near,
          far: VIEWER_CAMERA.far,
          position: [VIEWER_CAMERA.position[0], VIEWER_CAMERA.position[1], VIEWER_CAMERA.position[2]],
        }}
      >
        <ViewerEngine />
      </Canvas>

      <div className="viewer-overlay-top">
        <TimerWidget />
      </div>

      {isModelLoading && !viewerError && (
        <div className="viewer-status-layer">
          <p>読み込み中です…</p>
        </div>
      )}

      {viewerError && (
        <div className="viewer-status-layer">
          <p>{viewerError}</p>
          <button type="button" onClick={() => viewerManager.reloadModel()}>
            再読み込み
          </button>
        </div>
      )}
    </section>
  );
}
