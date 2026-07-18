import { Component } from 'react';
import type { ReactNode } from 'react';

type ErrorBoundaryProps = {
  fallbackMessage: string;
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

// docs/12: アプリ全体を止めず、技術的なエラー文をそのまま出さない。
// Viewer/ControlPanel/App全体を保護するために使う汎用境界。
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // 技術的な詳細はユーザーに見せないため、ここでは何も出力しない。
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <p>{this.props.fallbackMessage}</p>
          <button type="button" onClick={this.handleRetry}>
            再読み込み
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
