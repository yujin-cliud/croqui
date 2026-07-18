import { Viewer } from '../components/Viewer';
import { DrawingCanvas } from '../components/DrawingCanvas';
import { ControlPanel } from '../components/ControlPanel';
import { Header } from '../components/Header';
import { ErrorBoundary } from '../components/ErrorBoundary';

// docs/04: Header / Workspace(3Dビューア+描画キャンバスの左右2分割) / Control Panel。
// 狭い画面では上下配置(3Dが上、描画が下)になる(styles.cssのメディアクエリ)。
// docs/12: Viewer・DrawingCanvas・ControlPanelはそれぞれ個別に保護し、
// どれかの不具合が他を巻き込まないようにする。DrawingCanvasはポーズ状態に
// 依存しないため、ポーズを切り替えても描いた内容は消えない。
export function HomePage() {
  return (
    <main className="home-page">
      <Header />
      <div className="workspace">
        <ErrorBoundary fallbackMessage="3D表示の読み込みに失敗しました。">
          <Viewer />
        </ErrorBoundary>
        <ErrorBoundary fallbackMessage="描画スペースの表示に失敗しました。">
          <DrawingCanvas />
        </ErrorBoundary>
      </div>
      <ErrorBoundary fallbackMessage="操作パネルの表示に失敗しました。">
        <ControlPanel />
      </ErrorBoundary>
    </main>
  );
}
