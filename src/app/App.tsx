import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AppProvider } from './AppProvider';
import { AppShell } from './AppShell';
import { DisclaimerModal } from './DisclaimerModal';

/** Surfaces render errors in the existing loading overlay instead of a blank page. */
class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }

  render() {
    return this.state.error ? <div className="loading">{this.state.error.message}</div> : this.props.children;
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <AppProvider>
        <AppShell />
        <DisclaimerModal />
      </AppProvider>
    </AppErrorBoundary>
  );
}
