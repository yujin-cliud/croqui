import { create } from 'zustand';
import type { Settings } from '../types/Settings';
import { defaultSettings } from '../types/Settings';

type SettingsState = Settings & {
  setSettings: (settings: Settings) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaultSettings,
  setSettings: (settings) => set(settings),
}));
