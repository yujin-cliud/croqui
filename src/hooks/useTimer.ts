import { useTimerStore } from '../stores/TimerStore';
import { timerManager } from '../managers/TimerManager';
import { formatTime } from '../utils/time';

// UIコンポーネントがTimerStoreの読み取りとTimerManagerへの操作依頼をまとめて
// 行うためのフック。UIは表示と操作受付のみで、実処理はManagerに委ねる。
export function useTimer() {
  const duration = useTimerStore((state) => state.duration);
  const remaining = useTimerStore((state) => state.remaining);
  const isRunning = useTimerStore((state) => state.isRunning);
  const isPaused = useTimerStore((state) => state.isPaused);
  const autoNext = useTimerStore((state) => state.autoNext);

  return {
    duration,
    remaining,
    isRunning,
    isPaused,
    autoNext,
    formattedRemaining: formatTime(remaining),
    start: () => timerManager.start(duration),
    pause: () => timerManager.pause(),
    resume: () => timerManager.resume(),
    reset: () => timerManager.reset(),
    setAutoNext: (value: boolean) => timerManager.setAutoNext(value),
  };
}
