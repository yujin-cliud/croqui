import { useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UpdateNotice } from './components/UpdateNotice';
import { pwaService } from './services/PWAService';
import { settingsManager } from './managers/SettingsManager';
import { favoriteManager } from './managers/FavoriteManager';
import { poseManager } from './managers/PoseManager';
import { timerManager } from './managers/TimerManager';

export default function App() {
  const [isUpdateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    void settingsManager.init();
    void favoriteManager.init();
    void poseManager.init();
    pwaService.register(() => setUpdateAvailable(true));

    return () => {
      timerManager.dispose();
    };
  }, []);

  return (
    <ErrorBoundary fallbackMessage="アプリの表示に問題が発生しました。再読み込みしてください。">
      {isUpdateAvailable && <UpdateNotice onReload={() => pwaService.applyUpdate()} />}
      <HomePage />
    </ErrorBoundary>
  );
}
