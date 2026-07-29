import { useSettingsStore } from '../stores/SettingsStore';
import { useViewerStore } from '../stores/ViewerStore';
import { useTimerStore } from '../stores/TimerStore';
import { storageService } from '../services/IndexedDBStorageService';
import { defaultSettings } from '../types/Settings';
import type { Settings } from '../types/Settings';

// 設定の読み込み・保存と、関連するStore(Viewer/Timer)への反映を担当する。
export class SettingsManager {
  async init(): Promise<void> {
    let settings: Settings;
    try {
      settings = await storageService.loadSettings();
    } catch {
      // docs/12: 設定読み込み失敗時は初期設定にフォールバックする。
      settings = defaultSettings;
    }

    this.applyToStores(settings);
  }

  async update(partial: Partial<Settings>): Promise<void> {
    const current = useSettingsStore.getState();
    const next: Settings = {
      backgroundColor: partial.backgroundColor ?? current.backgroundColor,
      defaultTimer: partial.defaultTimer ?? current.defaultTimer,
      autoNext: partial.autoNext ?? current.autoNext,
      showGrid: partial.showGrid ?? current.showGrid,
      lightAzimuth: partial.lightAzimuth ?? current.lightAzimuth,
      lightElevation: partial.lightElevation ?? current.lightElevation,
      lightIntensity: partial.lightIntensity ?? current.lightIntensity,
      ambientIntensity: partial.ambientIntensity ?? current.ambientIntensity,
      cameraFov: partial.cameraFov ?? current.cameraFov,
    };

    this.applyToStores(next);

    try {
      await storageService.saveSettings(next);
    } catch {
      // docs/08, docs/12: 保存失敗はアプリを止めず、現在セッションの表示のみ維持する。
    }
  }

  private applyToStores(settings: Settings): void {
    useSettingsStore.getState().setSettings(settings);
    useViewerStore.getState().setBackgroundColor(settings.backgroundColor);
    useViewerStore.getState().setShowGrid(settings.showGrid);
    useTimerStore.getState().setAutoNext(settings.autoNext);
    useTimerStore.getState().setDuration(settings.defaultTimer);
    if (!useTimerStore.getState().isRunning) {
      useTimerStore.getState().setRemaining(settings.defaultTimer);
    }
  }
}

export const settingsManager = new SettingsManager();
