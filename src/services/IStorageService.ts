import type { Settings } from '../types/Settings';
import type { DownloadInfo } from '../types/DownloadInfo';

export interface IStorageService {
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  loadFavorites(): Promise<string[]>;
  saveFavorite(poseId: string): Promise<void>;
  removeFavorite(poseId: string): Promise<void>;
  loadDownloads(): Promise<DownloadInfo[]>;
  saveDownload(download: DownloadInfo): Promise<void>;
  clearAll(): Promise<void>;
}
