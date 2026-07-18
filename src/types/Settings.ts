import { DEFAULT_TIMER_SECONDS } from '../constants/timer';

export type BackgroundColor = 'white' | 'gray' | 'black';

export type Settings = {
  backgroundColor: BackgroundColor;
  defaultTimer: number;
  autoNext: boolean;
  showGrid: boolean;
};

export const defaultSettings: Settings = {
  backgroundColor: 'white',
  defaultTimer: DEFAULT_TIMER_SECONDS,
  autoNext: true,
  showGrid: true,
};
