import { useViewerStore } from '../stores/ViewerStore';
import type { BackgroundColor } from '../types/Settings';

// Viewer(Three.js)への操作要求の唯一の窓口。UIやSettingsManagerはViewerStoreや
// Three.jsを直接操作せず、このManagerを介して要求する(docs/02, docs/05)。
export class ViewerManager {
  resetCamera(): void {
    useViewerStore.getState().requestCameraReset();
  }

  setBackgroundColor(color: BackgroundColor): void {
    useViewerStore.getState().setBackgroundColor(color);
  }

  setShowGrid(showGrid: boolean): void {
    useViewerStore.getState().setShowGrid(showGrid);
  }

  reloadModel(): void {
    useViewerStore.getState().incrementReloadToken();
  }
}

export const viewerManager = new ViewerManager();
