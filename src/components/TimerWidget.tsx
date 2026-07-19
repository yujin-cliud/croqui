import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTimer } from '../hooks/useTimer';

// ドラッグ時にタイマーがビューア領域の端から食み出さないよう確保する余白(px)
const DRAG_BOUNDS_MARGIN = 4;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
};

// docs/04: タイマーはViewer上にオーバーレイ表示する。UIは表示と操作受付のみ。
// ウィジェット自体をドラッグして好きな位置へ動かせる(位置は既定位置からの
// 移動量としてtransformで表現し、ビューア領域の内側に収まるよう制限する)。
export function TimerWidget() {
  const { formattedRemaining, isRunning, isPaused, start, pause, resume, reset } = useTimer();
  const widgetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // ボタン(開始/一時停止/リセット等)の操作はドラッグ開始にしない
    if ((event.target as HTMLElement).closest('button')) return;
    const widget = widgetRef.current;
    if (!widget) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
    widget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const widget = widgetRef.current;
    if (!drag || !widget || event.pointerId !== drag.pointerId) return;

    let nextX = drag.baseX + (event.clientX - drag.startX);
    let nextY = drag.baseY + (event.clientY - drag.startY);

    // ビューア領域の内側に収める(現在の描画位置から今回の移動差分で予測位置を算出)
    const area = widget.closest('.viewer-area');
    if (area) {
      const areaRect = area.getBoundingClientRect();
      const rect = widget.getBoundingClientRect();
      const predictedLeft = rect.left + (nextX - offset.x);
      const predictedTop = rect.top + (nextY - offset.y);
      const predictedRight = predictedLeft + rect.width;
      const predictedBottom = predictedTop + rect.height;

      if (predictedLeft < areaRect.left + DRAG_BOUNDS_MARGIN) {
        nextX += areaRect.left + DRAG_BOUNDS_MARGIN - predictedLeft;
      }
      if (predictedRight > areaRect.right - DRAG_BOUNDS_MARGIN) {
        nextX -= predictedRight - (areaRect.right - DRAG_BOUNDS_MARGIN);
      }
      if (predictedTop < areaRect.top + DRAG_BOUNDS_MARGIN) {
        nextY += areaRect.top + DRAG_BOUNDS_MARGIN - predictedTop;
      }
      if (predictedBottom > areaRect.bottom - DRAG_BOUNDS_MARGIN) {
        nextY -= predictedBottom - (areaRect.bottom - DRAG_BOUNDS_MARGIN);
      }
    }

    setOffset({ x: nextX, y: nextY });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const widget = widgetRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (widget && widget.hasPointerCapture(event.pointerId)) {
      widget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  return (
    <div
      ref={widgetRef}
      className="timer-widget"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
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
