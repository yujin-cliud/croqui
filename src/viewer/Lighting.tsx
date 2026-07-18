// docs/05_Viewer.md: 柔らかい影・マット素材・スタジオ環境を満たすための照明構成。
export function Lighting() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[3, 5, 4]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-2}
        shadow-camera-right={2}
        shadow-camera-top={2}
        shadow-camera-bottom={-2}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
        shadow-radius={4}
      />
      <directionalLight position={[-3, 2, -2]} intensity={0.3} />
    </>
  );
}
