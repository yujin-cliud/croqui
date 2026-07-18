import { useFavoriteStore } from '../stores/FavoriteStore';
import { storageService } from '../services/IndexedDBStorageService';

// お気に入りの読み込み・切り替えを担当する。IndexedDBへのアクセスは
// 必ずStorageService経由で行う(docs/08)。
export class FavoriteManager {
  async init(): Promise<void> {
    const store = useFavoriteStore.getState();
    store.setLoading(true);
    try {
      const favoriteIds = await storageService.loadFavorites();
      store.setFavoriteIds(favoriteIds);
    } catch {
      store.setFavoriteIds([]);
    } finally {
      useFavoriteStore.getState().setLoading(false);
    }
  }

  isFavorite(poseId: string): boolean {
    return useFavoriteStore.getState().favoriteIds.includes(poseId);
  }

  async toggle(poseId: string): Promise<void> {
    const store = useFavoriteStore.getState();
    const isFavorite = store.favoriteIds.includes(poseId);
    const nextIds = isFavorite
      ? store.favoriteIds.filter((id) => id !== poseId)
      : [...store.favoriteIds, poseId];

    // docs/12: 保存に失敗してもアプリを止めない。表示状態は先に更新する。
    store.setFavoriteIds(nextIds);

    try {
      if (isFavorite) {
        await storageService.removeFavorite(poseId);
      } else {
        await storageService.saveFavorite(poseId);
      }
    } catch {
      // 保存失敗は一時状態のみとして許容する(docs/08)。
    }
  }
}

export const favoriteManager = new FavoriteManager();
