import { useSettingsStore } from '../stores/SettingsStore';

// docs/05_Viewer.md: 柔らかい影・マット素材・スタジオ環境。光の向きは設定から可変。
export function Lighting() {
  const azimuth = useSettingsStore((s) => s.lightAzimuth);
  const elevation = useSettingsStore((s) => s.lightElevation);
  const intensity = useSettingsStore((s) => s.lightIntensity);
  const ambient = useSettingsStore((s) => s.ambientIntensity);

  // 方位角・高度(度)から光源のワールド位置を求める。距離7で固定。
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const r = 7;
  const x = r * Math.cos(el) * Math.sin(az);
  const y = r * Math.sin(el);
  const z = r * Math.cos(el) * Math.cos(az);

  return (
    <>
      <ambientLight intensity={ambient} />
      <directionalLight
        position={[x, y, z]}
        intensity={intensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-radius={2}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-x, Math.max(y * 0.5, 1), -z]} intensity={0.2} />
    </>
  );
}