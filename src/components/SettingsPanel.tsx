import { useSettingsStore } from '../stores/SettingsStore';
import { settingsManager } from '../managers/SettingsManager';
import type { BackgroundColor } from '../types/Settings';

const BACKGROUND_OPTIONS: Array<{ value: BackgroundColor; label: string }> = [
  { value: 'white', label: '白' },
  { value: 'gray', label: 'グレー' },
  { value: 'black', label: '黒' },
];

const MIN_TIMER_SECONDS = 10;
const MAX_TIMER_SECONDS = 600;

type SettingsPanelProps = {
  onClose: () => void;
};

// docs/04: 設定変更は即時反映し、確認ダイアログは使わない。
export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const backgroundColor = useSettingsStore((state) => state.backgroundColor);
  const showGrid = useSettingsStore((state) => state.showGrid);
  const defaultTimer = useSettingsStore((state) => state.defaultTimer);
  const autoNext = useSettingsStore((state) => state.autoNext);

  return (
    <div className="panel-overlay" role="dialog" aria-label="設定">
      <div className="panel">
        <div className="panel-header">
          <h2>設定</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <fieldset className="settings-group">
          <legend>背景色</legend>
          {BACKGROUND_OPTIONS.map((option) => (
            <label key={option.value} className="settings-radio">
              <input
                type="radio"
                name="backgroundColor"
                checked={backgroundColor === option.value}
                onChange={() => void settingsManager.update({ backgroundColor: option.value })}
              />
              {option.label}
            </label>
          ))}
        </fieldset>

        <fieldset className="settings-group">
          <legend>グリッド</legend>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={(event) => void settingsManager.update({ showGrid: event.target.checked })}
            />
            グリッドを表示する
          </label>
        </fieldset>

        <fieldset className="settings-group">
          <legend>タイマー初期値（秒）</legend>
          <input
            type="number"
            min={MIN_TIMER_SECONDS}
            max={MAX_TIMER_SECONDS}
            value={defaultTimer}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isNaN(value)) return;
              const clamped = Math.min(Math.max(value, MIN_TIMER_SECONDS), MAX_TIMER_SECONDS);
              void settingsManager.update({ defaultTimer: clamped });
            }}
          />
        </fieldset>

        <fieldset className="settings-group">
          <legend>自動次ポーズ</legend>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(event) => void settingsManager.update({ autoNext: event.target.checked })}
            />
            タイマー終了時に自動で次のポーズへ進む
          </label>
        </fieldset>
      </div>
    </div>
  );
}
