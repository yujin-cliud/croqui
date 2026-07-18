import { create } from 'zustand';
import { DEFAULT_TIMER_SECONDS } from '../constants/timer';

type TimerState = {
  duration: number;
  remaining: number;
  isRunning: boolean;
  isPaused: boolean;
  autoNext: boolean;
  setDuration: (duration: number) => void;
  setRemaining: (remaining: number) => void;
  setRunning: (isRunning: boolean) => void;
  setPaused: (isPaused: boolean) => void;
  setAutoNext: (autoNext: boolean) => void;
};

export const useTimerStore = create<TimerState>((set) => ({
  duration: DEFAULT_TIMER_SECONDS,
  remaining: DEFAULT_TIMER_SECONDS,
  isRunning: false,
  isPaused: false,
  autoNext: true,
  setDuration: (duration) => set({ duration }),
  setRemaining: (remaining) => set({ remaining }),
  setRunning: (isRunning) => set({ isRunning }),
  setPaused: (isPaused) => set({ isPaused }),
  setAutoNext: (autoNext) => set({ autoNext }),
}));
