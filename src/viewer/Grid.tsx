import { Grid as DreiGrid } from '@react-three/drei';
import { useViewerStore } from '../stores/ViewerStore';
import type { BackgroundColor } from '../types/Settings';

// 背景色ごとにグリッド線の視認性を保つための配色。
const GRID_COLORS: Record<BackgroundColor, { cell: string; section: string }> = {
  white: { cell: '#c9c9c9', section: '#9a9a9a' },
  gray: { cell: '#e0e0e0', section: '#f2f2f2' },
  black: { cell: '#3a3a3a', section: '#5a5a5a' },
};

export function Grid() {
  const showGrid = useViewerStore((state) => state.showGrid);
  const backgroundColor = useViewerStore((state) => state.backgroundColor);

  if (!showGrid) return null;

  const colors = GRID_COLORS[backgroundColor];

  return (
    <DreiGrid
      args={[10, 10]}
      cellSize={0.25}
      cellThickness={0.5}
      sectionSize={1}
      sectionThickness={1}
      cellColor={colors.cell}
      sectionColor={colors.section}
      fadeDistance={12}
      fadeStrength={1}
      infiniteGrid
    />
  );
}
