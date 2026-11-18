import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, ErrorNote } from './ui';

/**
 * Catches a crash in the page below it and shows what went wrong, instead of
 * React's default of removing everything and leaving a blank screen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; /** Changing this clears the error (for example on navigation). */ resetKey?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(previous: { resetKey?: string }): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto w-full max-w-3xl p-4">
        <ErrorNote
          title="This page ran into a problem"
          message={`${error.message || 'Unknown error'}. Reloading usually fixes it. If it keeps happening, this message says where to look.`}
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      </div>
    );
  }
}
