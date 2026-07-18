import { useState } from 'react';
import { SettingsPanel } from './SettingsPanel';

// docs/04: ヘッダーはアプリ名と設定ボタンのみ。設定パネルの開閉状態のみUIが持つ。
export function Header() {
  const [isSettingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="app-header">
      <strong className="app-title">Croqui</strong>
      <button type="button" className="header-settings-button" onClick={() => setSettingsOpen(true)}>
        設定
      </button>

      {isSettingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
