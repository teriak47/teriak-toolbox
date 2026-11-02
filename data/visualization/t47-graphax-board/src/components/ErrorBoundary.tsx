import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches any render error so the app never collapses into a blank black screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Graphax] Erreur de rendu interceptée :', error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="h-screen w-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl bg-zinc-900 border border-rose-500/40 p-5 shadow-2xl space-y-3">
          <p className="text-sm font-semibold text-rose-300">Une erreur inattendue est survenue</p>
          <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap break-words max-h-48 overflow-auto bg-zinc-950 rounded-lg p-3 border border-zinc-800">
            {this.state.error.message}
            {'\n'}
            {this.state.error.stack?.split('\n').slice(1, 6).join('\n')}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-zinc-950"
            >
              Réinitialiser la vue
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              Recharger la page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
