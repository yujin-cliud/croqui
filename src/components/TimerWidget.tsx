import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTimer } from '../hooks/useTimer';

// ドラッグ時にタイマーがビューア領域の端から食み出さないよう確保する余白(px)
const DRAG_BOUNDS_MARGIN = 4;
// これ未満の移動は「タップ(メニュー開閉)」、超えたら「ドラッグ(移動)」扱い
const TAP_THRESHOLD = 4;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  moved: boolean;
};

export function TimerWidget() {
  const { formattedRemaining, isRunning, isPaused, start, pause, resume, reset } = useTimer();
  const widgetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [menuOpen, setMenuOpen] = useState(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // ボタン操作はドラッグ/開閉の対象にしない
    if ((event.target as HTMLElement).closest('button')) return;
    const widget = widgetRef.current;
    if (!widget) return;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
      moved: false,
    };
    widget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const widget = widgetRef.current;
    if (!drag || !widget || event.pointerId !== drag.pointerId) return;

    // 少しでも動いたら「ドラッグ」とみなす(タップ開閉を抑制)
    if (
      Math.abs(event.clientX - drag.startX) > TAP_THRESHOLD ||
      Math.abs(event.clientY - drag.startY) > TAP_THRESHOLD
    ) {
      drag.moved = true;
    }

    let nextX = drag.baseX + (event.clientX - drag.startX);
    let nextY = drag.baseY + (event.clientY - drag.startY);

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

  const cleanupDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const widget = widgetRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (widget && widget.hasPointerCapture(event.pointerId)) {
      widget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    // 動かさずに離した = タップ → メニュー開閉
    const wasTap = !!drag && !drag.moved && event.pointerId === drag.pointerId;
    cleanupDrag(event);
    if (wasTap) setMenuOpen((open) => !open);
  };

  return (
    <div
      ref={widgetRef}
      className="timer-widget"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cleanupDrag}
    >
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
        <span className="timer-widget-time" style={{ cursor: 'pointer' }}>
          {formattedRemaining} {menuOpen ? '◂' : '▸'}
        </span>
        {menuOpen && (
          <div
            className="timer-widget-actions"
            style={{
              position: 'absolute',
              left: '100%',
              top: '50%',
              transform: 'translateY(-50%)',
              marginLeft: 8,
              display: 'flex',
              gap: 8,
              whiteSpace: 'nowrap',
            }}
          >
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
        )}
      </div>
    </div>
  );
}