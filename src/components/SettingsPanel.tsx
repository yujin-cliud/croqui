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
  const lightAzimuth = useSettingsStore((state) => state.lightAzimuth);
  const lightElevation = useSettingsStore((state) => state.lightElevation);
  const lightIntensity = useSettingsStore((state) => state.lightIntensity);
  const ambientIntensity = useSettingsStore((state) => state.ambientIntensity);
  const cameraFov = useSettingsStore((state) => state.cameraFov);
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
        <fieldset className="settings-group">
          <legend>光源</legend>

          <label className="settings-slider">
            光の向き（左右）
            <input type="range" min={0} max={360} step={5}
              value={lightAzimuth}
              onChange={(e) => void settingsManager.update({ lightAzimuth: Number(e.target.value) })} />
          </label>

          <label className="settings-slider">
            光の高さ（上下）
            <input type="range" min={10} max={90} step={5}
              value={lightElevation}
              onChange={(e) => void settingsManager.update({ lightElevation: Number(e.target.value) })} />
          </label>

          <label className="settings-slider">
            光の強さ
            <input type="range" min={0} max={2} step={0.1}
              value={lightIntensity}
              onChange={(e) => void settingsManager.update({ lightIntensity: Number(e.target.value) })} />
          </label>

          <label className="settings-slider">
            陰影の強さ（環境光）
            <input type="range" min={0} max={1} step={0.05}
              value={ambientIntensity}
              onChange={(e) => void settingsManager.update({ ambientIntensity: Number(e.target.value) })} />
          </label>
        </fieldset>
        <fieldset className="settings-group">
          <legend>遠近感（パース）</legend>
          <label className="settings-slider">
            弱い（望遠）〜 強い（広角）
            <input type="range" min={20} max={70} step={1}
              value={cameraFov}
              onChange={(e) => void settingsManager.update({ cameraFov: Number(e.target.value) })} />
          </label>
        </fieldset>
      </div>
    </div>
  );
}
