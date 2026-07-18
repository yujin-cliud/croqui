import type { IStorageService } from './IStorageService';
import type { Settings } from '../types/Settings';
import { defaultSettings } from '../types/Settings';
import type { DownloadInfo } from '../types/DownloadInfo';

const DB_NAME = 'croqui-db';
const DB_VERSION = 1;

export class IndexedDBStorageService implements IStorageService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'poseId' });
        if (!db.objectStoreNames.contains('downloads')) db.createObjectStore('downloads', { keyPath: 'poseId' });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  async loadSettings(): Promise<Settings> {
    try {
      const db = await this.open();
      return await new Promise((resolve) => {
        const tx = db.transaction('settings', 'readonly');
        const req = tx.objectStore('settings').get('settings');
        req.onsuccess = () => resolve(req.result ?? defaultSettings);
        req.onerror = () => resolve(defaultSettings);
      });
    } catch {
      return defaultSettings;
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(settings, 'settings');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadFavorites(): Promise<string[]> {
    try {
      const db = await this.open();
      return await new Promise((resolve) => {
        const tx = db.transaction('favorites', 'readonly');
        const req = tx.objectStore('favorites').getAll();
        req.onsuccess = () => resolve((req.result as Array<{ poseId: string }>).map((item) => item.poseId));
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async saveFavorite(poseId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('favorites', 'readwrite');
      tx.objectStore('favorites').put({ poseId });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async removeFavorite(poseId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('favorites', 'readwrite');
      tx.objectStore('favorites').delete(poseId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadDownloads(): Promise<DownloadInfo[]> {
    try {
      const db = await this.open();
      return await new Promise((resolve) => {
        const tx = db.transaction('downloads', 'readonly');
        const req = tx.objectStore('downloads').getAll();
        req.onsuccess = () => resolve(req.result as DownloadInfo[]);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async saveDownload(download: DownloadInfo): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('downloads', 'readwrite');
      tx.objectStore('downloads').put(download);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.open();
    await Promise.all(['settings', 'favorites', 'downloads'].map((storeName) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    })));
  }
}

export const storageService = new IndexedDBStorageService();
