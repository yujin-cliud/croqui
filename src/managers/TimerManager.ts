import { useTimerStore } from '../stores/TimerStore';
import { poseManager } from './PoseManager';

const TICK_INTERVAL_MS = 200;

// docs/09: TimerStoreにsetIntervalを書かず、実時間(Date.now())ベースで
// 残り時間を計算する。setIntervalの管理はこのManagerに閉じ込める。
export class TimerManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private endAt = 0;
  private pausedRemainingMs = 0;

  start(durationSeconds: number): void {
    this.clearTick();

    const store = useTimerStore.getState();
    store.setDuration(durationSeconds);
    store.setRemaining(durationSeconds);
    store.setPaused(false);
    store.setRunning(true);

    this.endAt = Date.now() + durationSeconds * 1000;
    this.tick();
    this.intervalId = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  pause(): void {
    const store = useTimerStore.getState();
    if (!store.isRunning || store.isPaused) return;

    this.pausedRemainingMs = Math.max(this.endAt - Date.now(), 0);
    this.clearTick();
    store.setPaused(true);
  }

  resume(): void {
    const store = useTimerStore.getState();
    if (!store.isRunning || !store.isPaused) return;

    this.endAt = Date.now() + this.pausedRemainingMs;
    store.setPaused(false);
    this.tick();
    this.intervalId = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  reset(): void {
    const store = useTimerStore.getState();
    this.clearTick();
    store.setRunning(false);
    store.setPaused(false);
    store.setRemaining(store.duration);
  }

  setAutoNext(autoNext: boolean): void {
    useTimerStore.getState().setAutoNext(autoNext);
  }

  setDefaultDuration(durationSeconds: number): void {
    const store = useTimerStore.getState();
    store.setDuration(durationSeconds);
    if (!store.isRunning) {
      store.setRemaining(durationSeconds);
    }
  }

  dispose(): void {
    this.clearTick();
  }

  private tick(): void {
    const store = useTimerStore.getState();
    const remainingMs = Math.max(this.endAt - Date.now(), 0);
    store.setRemaining(Math.ceil(remainingMs / 1000));

    if (remainingMs <= 0) {
      this.clearTick();
      store.setRunning(false);
      store.setPaused(false);

      if (store.autoNext) {
        const duration = store.duration;
        void poseManager.next().then(() => {
          this.start(duration);
        });
      }
    }
  }

  private clearTick(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const timerManager = new TimerManager();
