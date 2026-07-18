import { create } from 'zustand';
import type { BackgroundColor } from '../types/Settings';

type ViewerState = {
  backgroundColor: BackgroundColor;
  showGrid: boolean;
  cameraResetRequested: boolean;
  isModelLoading: boolean;
  viewerError: string | null;
  reloadToken: number;
  setBackgroundColor: (backgroundColor: BackgroundColor) => void;
  setShowGrid: (showGrid: boolean) => void;
  requestCameraReset: () => void;
  clearCameraReset: () => void;
  setModelLoading: (isModelLoading: boolean) => void;
  setViewerError: (viewerError: string | null) => void;
  incrementReloadToken: () => void;
};

export const useViewerStore = create<ViewerState>((set) => ({
  backgroundColor: 'white',
  showGrid: true,
  cameraResetRequested: false,
  isModelLoading: false,
  viewerError: null,
  reloadToken: 0,
  setBackgroundColor: (backgroundColor) => set({ backgroundColor }),
  setShowGrid: (showGrid) => set({ showGrid }),
  requestCameraReset: () => set({ cameraResetRequested: true }),
  clearCameraReset: () => set({ cameraResetRequested: false }),
  setModelLoading: (isModelLoading) => set({ isModelLoading }),
  setViewerError: (viewerError) => set({ viewerError }),
  incrementReloadToken: () => set((state) => ({ reloadToken: state.reloadToken + 1 })),
}));
