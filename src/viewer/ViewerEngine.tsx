import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { useViewerStore } from '../stores/ViewerStore';
import { useSettingsStore } from '../stores/SettingsStore';
import { usePoseStore } from '../stores/PoseStore';
import { loadMannequin } from './ModelLoader';
import { buildBoneMap, type BoneMap } from './BoneMapper';
import { applyPose } from './PoseApplier';
import { Lighting } from './Lighting';
import { Grid } from './Grid';
import { Environment } from './Environment';
import { CameraController } from './CameraController';

// Scene全体の組み立て（マネキン生成・ボーン収集・ポーズ適用・照明・グリッド・
// 背景・カメラ）を担当する。Three.js操作はviewer層に閉じ込め、
// UIやManagerからはPoseStore/ViewerStoreの状態を通じてのみ影響を与える。
export function ViewerEngine() {
  const [root, setRoot] = useState<THREE.Group | null>(null);
  const boneMapRef = useRef<BoneMap>({});
  const reloadToken = useViewerStore((state) => state.reloadToken);
  const setModelLoading = useViewerStore((state) => state.setModelLoading);
  const setViewerError = useViewerStore((state) => state.setViewerError);
  const currentPose = usePoseStore((state) => state.currentPose);
  const modelId = useSettingsStore((state) => state.modelId);

  useEffect(() => {
    let cancelled = false;
    setModelLoading(true);
    setViewerError(null);
    setRoot(null);

    loadMannequin(modelId)
      .then((model) => {
        if (cancelled) return;
        boneMapRef.current = buildBoneMap(model.root);
        const pose = usePoseStore.getState().currentPose;
        if (pose) {
          applyPose(boneMapRef.current, pose);
        }
        setRoot(model.root);
        setModelLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setViewerError('マネキンの表示に失敗しました。再読み込みしてください。');
        setModelLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken, modelId, setModelLoading, setViewerError]);

  useEffect(() => {
    if (!root || !currentPose) return;
    applyPose(boneMapRef.current, currentPose);
    }, [root, currentPose]);
  return (
    <>
      <Environment />
      <Lighting />
      <Grid />
      {root && <primitive object={root} />}
      <CameraController />
    </>
  );
}
