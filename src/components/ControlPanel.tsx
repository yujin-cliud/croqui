import { useState } from 'react';
import { usePoseStore } from '../stores/PoseStore';
import { useFavoriteStore } from '../stores/FavoriteStore';
import { poseManager } from '../managers/PoseManager';
import { favoriteManager } from '../managers/FavoriteManager';
import { viewerManager } from '../managers/ViewerManager';
import { TagSearchPanel } from './TagSearchPanel';

// docs/04: 前ポーズ・次ポーズ・ランダム・タグ検索・お気に入り・カメラリセットのみ。
// UIは表示と操作受付のみで、実処理は各Manager経由で行う。
export function ControlPanel() {
  const [isTagSearchOpen, setTagSearchOpen] = useState(false);
  const poses = usePoseStore((state) => state.poses);
  const currentPose = usePoseStore((state) => state.currentPose);
  const favoriteIds = useFavoriteStore((state) => state.favoriteIds);
  const isFavorite = currentPose ? favoriteIds.includes(currentPose.id) : false;
  const displayName = currentPose
    ? poses.find((p) => p.id === currentPose.id)?.name ?? currentPose.name
    : 'ポーズ未読み込み';
  return (
    <section className="control-panel">
      <div className="control-panel-info">
        <span>{displayName}</span>
      </div>

      <div className="control-panel-buttons">
        <button type="button" onClick={() => void poseManager.previous()}>
          前
        </button>
        <button type="button" onClick={() => void poseManager.next()}>
          次
        </button>
        <button type="button" onClick={() => void poseManager.random()}>
          ランダム
        </button>
        <button
          type="button"
          className={isFavorite ? 'control-button-active' : ''}
          disabled={!currentPose}
          onClick={() => currentPose && void favoriteManager.toggle(currentPose.id)}
        >
          {isFavorite ? '★ お気に入り' : '☆ お気に入り'}
        </button>
        <button type="button" onClick={() => setTagSearchOpen(true)}>
          タグ検索
        </button>
        <button type="button" onClick={() => viewerManager.resetCamera()}>
          カメラリセット
        </button>
      </div>

      {isTagSearchOpen && <TagSearchPanel onClose={() => setTagSearchOpen(false)} />}
    </section>
  );
}
