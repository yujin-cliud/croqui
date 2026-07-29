import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useViewerStore } from '../stores/ViewerStore';
import type { BackgroundColor } from '../types/Settings';

// docs/04, docs/08: 背景3色 (white/gray/black)。
const BACKGROUND_COLORS: Record<BackgroundColor, string> = {
  white: '#f2f2f2',
  gray: '#7d7d7d',
  black: '#161616',
};

export function Environment() {
  const { scene } = useThree();
  const backgroundColor = useViewerStore((state) => state.backgroundColor);

  useEffect(() => {
    scene.background = new THREE.Color(BACKGROUND_COLORS[backgroundColor]);
  }, [scene, backgroundColor]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
      <circleGeometry args={[6, 48]} />
      <shadowMaterial opacity={0.25} />
    </mesh>
  );
}
