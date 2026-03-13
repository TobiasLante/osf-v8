"use client";
import { Component, ReactNode } from "react";

interface Props { children: ReactNode; fallback?: ReactNode; name?: string }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error(`[ErrorBoundary:${this.props.name || 'unknown'}]`, error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 rounded-lg border border-red-500/30 bg-red-500/5 text-center">
          <p className="text-red-400 font-medium">Something went wrong</p>
          <p className="text-text-muted text-sm mt-1">{this.state.error?.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 text-sm text-accent hover:text-accent-hover"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
