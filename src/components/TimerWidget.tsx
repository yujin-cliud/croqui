import { useTimer } from '../hooks/useTimer';

// docs/04: タイマーはViewer上にオーバーレイ表示する。UIは表示と操作受付のみ。
export function TimerWidget() {
  const { formattedRemaining, isRunning, isPaused, start, pause, resume, reset } = useTimer();

  return (
    <div className="timer-widget">
      <span className="timer-widget-time">{formattedRemaining}</span>
      <div className="timer-widget-actions">
        {!isRunning && (
          <button type="button" onClick={start}>
            開始
          </button>
        )}
        {isRunning && !isPaused && (
          <button type="button" onClick={pause}>
            一時停止
          </button>
        )}
        {isRunning && isPaused && (
          <button type="button" onClick={resume}>
            再開
          </button>
        )}
        <button type="button" onClick={reset}>
          リセット
        </button>
      </div>
    </div>
  );
}
