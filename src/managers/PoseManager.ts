import { usePoseStore } from '../stores/PoseStore';
import { useSettingsStore } from '../stores/SettingsStore';
import { loadPoseIndex, loadPose } from '../viewer/PoseLoader';
import type { Pose, PoseIndexItem } from '../types/Pose';

const PRELOAD_COUNT = 5;

// ポーズ一覧・現在ポーズ・タグ検索(AND)・先読みを管理する。
// UIやViewerからPose JSONを直接読ませず、必ずこのManagerを経由させる(docs/06)。
export class PoseManager {
constructor() {
    // モデル(体型)が変わったら、現在ポーズをそのモデル用データで読み直す。
    // 設定の非同期読み込みが初回ポーズ選択より後に完了する起動時の競合もこれで吸収する。
    useSettingsStore.subscribe((state, prev) => {
      if (state.modelId !== prev.modelId) void this.reloadForModelChange();
    });
  }  
  private poseCache = new Map<string, Pose>();
  private lastRandomId: string | null = null;

  async init(): Promise<void> {
    const store = usePoseStore.getState();
    store.setLoading(true);
    store.setError(null);

    try {
      const poses = loadPoseIndex().filter((item) => !item.hidden);
      store.setPoses(poses);
      store.setFilteredPoseIds(poses.map((item) => item.id));

      if (poses.length > 0) {
        await this.selectPoseById(poses[0].id);
      }
    } catch {
      store.setError('ポーズ一覧の読み込みに失敗しました。');
    } finally {
      usePoseStore.getState().setLoading(false);
    }
  }

  setSelectedTags(tags: string[]): void {
    const store = usePoseStore.getState();
    const filteredIds = this.computeFilteredIds(store.poses, tags);
    store.setSelectedTags(tags);
    store.setFilteredPoseIds(filteredIds);
    // docs/10: 検索結果が0件でも現在のポーズは維持する（ここでは currentPose を変更しない）。
  }

  clearFilters(): void {
    this.setSelectedTags([]);
  }

  async next(): Promise<void> {
    await this.step(1);
  }

  async previous(): Promise<void> {
    await this.step(-1);
  }

  async random(): Promise<void> {
    const store = usePoseStore.getState();
    const ids = store.filteredPoseIds;
    if (ids.length === 0) return;

    if (ids.length === 1) {
      await this.selectPoseById(ids[0]);
      return;
    }

    let candidate = ids[Math.floor(Math.random() * ids.length)];
    let guard = 0;
    // docs/06: ランダムは連続同一を避ける。
    while (candidate === this.lastRandomId && guard < 10) {
      candidate = ids[Math.floor(Math.random() * ids.length)];
      guard += 1;
    }

    await this.selectPoseById(candidate);
  }

  private async step(direction: 1 | -1): Promise<void> {
    const store = usePoseStore.getState();
    const ids = store.filteredPoseIds;
    if (ids.length === 0) return;

    const currentId = store.currentPose?.id ?? null;
    const currentIndexInFiltered = currentId ? ids.indexOf(currentId) : -1;

    const targetIndex =
      currentIndexInFiltered === -1
        ? direction === 1
          ? 0
          : ids.length - 1
        : (currentIndexInFiltered + direction + ids.length) % ids.length;

    await this.selectPoseById(ids[targetIndex]);
  }

  private computeFilteredIds(poses: PoseIndexItem[], tags: string[]): string[] {
    if (tags.length === 0) return poses.map((item) => item.id);
    return poses.filter((item) => tags.every((tag) => item.tags.includes(tag))).map((item) => item.id);
  }

  private async selectPoseById(id: string): Promise<void> {
    const store = usePoseStore.getState();
    const indexItem = store.poses.find((item) => item.id === id);
    if (!indexItem) return;

    try {
      const pose = await this.loadPoseCached(indexItem);
      const positionInFiltered = store.filteredPoseIds.indexOf(id);
      store.setCurrentPose(pose, positionInFiltered === -1 ? 0 : positionInFiltered);
      store.setError(null);
      this.lastRandomId = id;
      void this.preloadNext(id);
    } catch {
      // docs/06, docs/12: 個別ポーズの読み込み失敗時は前ポーズを維持する。
      store.setError('ポーズの読み込みに失敗しました。前のポーズを表示しています。');
    }
  }

  private async loadPoseCached(indexItem: PoseIndexItem): Promise<Pose> {
    const modelId = useSettingsStore.getState().modelId;
    const key = `${modelId}:${indexItem.id}`;
    const cached = this.poseCache.get(key);
    if (cached) return cached;

    const pose = await loadPose(indexItem.file, modelId);
    this.poseCache.set(key, pose);
    return pose;
  }

  // モデル(体型)切替時に呼ぶ。現在のポーズを新モデル用データで読み直す。
  async reloadForModelChange(): Promise<void> {
    const id = usePoseStore.getState().currentPose?.id;
    if (id) await this.selectPoseById(id);
  }

  private async preloadNext(fromId: string): Promise<void> {
    const store = usePoseStore.getState();
    const ids = store.filteredPoseIds;
    if (ids.length === 0) return;

    const startIndex = ids.indexOf(fromId);
    if (startIndex === -1) return;

    const preloadIds: string[] = [];
    for (let offset = 1; offset <= PRELOAD_COUNT && offset < ids.length; offset += 1) {
      preloadIds.push(ids[(startIndex + offset) % ids.length]);
    }

    await Promise.all(
      preloadIds.map(async (id) => {
        if (this.poseCache.has(`${useSettingsStore.getState().modelId}:${id}`)) return;
        const indexItem = store.poses.find((item) => item.id === id);
        if (!indexItem) return;
        try {
          const modelId = useSettingsStore.getState().modelId;
          const pose = await loadPose(indexItem.file, modelId);
          this.poseCache.set(`${modelId}:${id}`, pose);
        } catch {
          // 先読み失敗はUXに影響しないため無視する。
        }
      })
    );

    usePoseStore.getState().setPreloadedPoseIds(preloadIds);
  }
}

export const poseManager = new PoseManager();