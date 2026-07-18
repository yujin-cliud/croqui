import { useEffect, useRef, useState } from 'react';
import { DRAWING } from '../constants/drawing';

type Tool = 'pen' | 'eraser';

// 描画キャンバス(docs/04)。ペン・消しゴム・戻す・クリアのみを提供する。
// ポーズや3D表示の状態には一切依存しないため、ポーズを切り替えても
// このコンポーネントは再マウントされず、描いた内容は消えない。
// 描画内容はセッション内のみ保持し、保存はしない(MVP範囲、docs/01)。
export function DrawingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);

  const [tool, setTool] = useState<Tool>('pen');
  const [undoCount, setUndoCount] = useState(0);

  // キャンバスの実ピクセルサイズを表示サイズ×devicePixelRatioに合わせる。
  // リサイズ時は描画済みの内容を一時キャンバスへ退避して復元し、消えないようにする。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    contextRef.current = context;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(parent.clientWidth * ratio));
      const height = Math.max(1, Math.floor(parent.clientHeight * ratio));
      if (canvas.width === width && canvas.height === height) return;

      let saved: HTMLCanvasElement | null = null;
      if (canvas.width > 0 && canvas.height > 0) {
        saved = document.createElement('canvas');
        saved.width = canvas.width;
        saved.height = canvas.height;
        saved.getContext('2d')?.drawImage(canvas, 0, 0);
      }
      canvas.width = width;
      canvas.height = height;
      if (saved) {
        context.drawImage(saved, 0, 0);
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);
    return () => observer.disconnect();
  }, []);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const pushUndoSnapshot = () => {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (!canvas || !context || canvas.width === 0 || canvas.height === 0) return;
    const stack = undoStackRef.current;
    stack.push(context.getImageData(0, 0, canvas.width, canvas.height));
    if (stack.length > DRAWING.undoLimit) {
      stack.shift();
    }
    setUndoCount(stack.length);
  };

  const drawSegment = (to: { x: number; y: number }) => {
    const context = contextRef.current;
    const from = lastPointRef.current;
    if (!context || !from) return;
    const ratio = window.devicePixelRatio || 1;

    context.save();
    if (tool === 'eraser') {
      context.globalCompositeOperation = 'destination-out';
      context.lineWidth = DRAWING.eraserWidth * ratio;
    } else {
      context.globalCompositeOperation = 'source-over';
      context.strokeStyle = DRAWING.penColor;
      context.lineWidth = DRAWING.penWidth * ratio;
    }
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();

    lastPointRef.current = to;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    // マウスは左ボタンのみ描画(タッチ・ペン入力はそのまま)。docs/04
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = getPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pushUndoSnapshot();
    isDrawingRef.current = true;
    lastPointRef.current = point;
    // その場でタップしただけでも点が残るよう、極小の線分を描く
    drawSegment({ x: point.x + 0.01, y: point.y + 0.01 });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const point = getPoint(event);
    if (point) drawSegment(point);
  };

  const endStroke = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleUndo = () => {
    const context = contextRef.current;
    const snapshot = undoStackRef.current.pop();
    if (!context || !snapshot) return;
    context.putImageData(snapshot, 0, 0);
    setUndoCount(undoStackRef.current.length);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const context = contextRef.current;
    if (!canvas || !context) return;
    pushUndoSnapshot();
    context.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <section className="drawing-area">
      <div className="drawing-toolbar">
        <button
          type="button"
          className={tool === 'pen' ? 'control-button-active' : ''}
          onClick={() => setTool('pen')}
        >
          ペン
        </button>
        <button
          type="button"
          className={tool === 'eraser' ? 'control-button-active' : ''}
          onClick={() => setTool('eraser')}
        >
          消しゴム
        </button>
        <button type="button" disabled={undoCount === 0} onClick={handleUndo}>
          戻す
        </button>
        <button type="button" onClick={handleClear}>
          クリア
        </button>
      </div>
      <div className="drawing-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="drawing-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
      </div>
    </section>
  );
}
