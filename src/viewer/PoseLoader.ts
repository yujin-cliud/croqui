import type { Pose, PoseIndexItem } from '../types/Pose';
import poseIndexRaw from '../data/poses/pose-index.json';

// オフライン起動（docs/11_PWA.md）を確実にするため、ポーズJSONはfetchではなく
// ビルド時にバンドルする。import.meta.globはpose-index.jsonにも一致するが、
// Pose形式ではないためファイル名で呼び出された時にのみ解決する。
const poseModules = import.meta.glob('../data/poses/**/*.json', { eager: true }) as Record<
  string,
  { default: unknown }
>;

// ポーズはモデル(体型)ごとにバインド姿勢が違うため、src/data/poses/<modelId>/ に
// モデル別で焼き分けてある。モデル別ファイルを優先し、無ければ旧ルート直下(後方互換)。
function findPoseModule(fileName: string, modelId: string): Pose | null {
  for (const [path, module] of Object.entries(poseModules)) {
    if (path.endsWith(`/${modelId}/${fileName}`)) {
      return module.default as Pose;
    }
  }
  for (const [path, module] of Object.entries(poseModules)) {
    if (path.endsWith(`/poses/${fileName}`)) {
      return module.default as Pose;
    }
  }
  return null;
}

export function loadPoseIndex(): PoseIndexItem[] {
  return poseIndexRaw as PoseIndexItem[];
}

export function loadPose(fileName: string, modelId: string): Promise<Pose> {
  return new Promise((resolve, reject) => {
    const pose = findPoseModule(fileName, modelId);
    if (pose) {
      resolve(pose);
    } else {
      reject(new Error(`ポーズデータが見つかりません: ${fileName}`));
    }
  });
}