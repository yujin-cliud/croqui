// Viteのbase設定(GitHub Pagesのサブディレクトリ等)に追従してsw.jsを解決する
const SERVICE_WORKER_URL = `${import.meta.env.BASE_URL}sw.js`;

type UpdateHandler = () => void;

// docs/11: Service Workerの登録・更新検知・更新反映のみを担当する。
// Push通知やインストール強制は行わない(docs/11のInstall Policy)。
export class PWAService {
  private registration: ServiceWorkerRegistration | null = null;

  register(onUpdateAvailable: UpdateHandler): void {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(SERVICE_WORKER_URL)
        .then((registration) => {
          this.registration = registration;

          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;

            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                onUpdateAvailable();
              }
            });
          });
        })
        .catch(() => {
          // docs/12: PWA登録に失敗しても通常のWebアプリとして動作させる。
        });
    });
  }

  applyUpdate(): void {
    if (!this.registration?.waiting) {
      window.location.reload();
      return;
    }

    this.registration.waiting.postMessage('SKIP_WAITING');
    window.location.reload();
  }
}

export const pwaService = new PWAService();
