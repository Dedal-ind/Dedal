// AppErrorBoundary.jsx
// The last thing between a render crash and a white screen.
//
// A CLASS COMPONENT, and it has to be: componentDidCatch and
// getDerivedStateFromError have no hook equivalent. This is the one place in
// the app where a class is not a style choice.
//
// WHAT IT DOES NOT CATCH, so nobody is surprised later: errors thrown inside
// event handlers, in async callbacks, or in timers. React only routes RENDER,
// lifecycle and constructor errors to a boundary. Those other paths already
// have their own handling (apiClient rejects, screens set an error state).
//
// The report is fire-and-forget to /errors/client. A reporter that could itself
// throw, or that blocked the fallback from rendering, would turn one crash into
// two — so the send is wrapped and its failure is swallowed.

import { Component } from 'react';
import apiClient from '../../api-client/api-client.js';
import { ERROR_BOUNDARY_COPY as COPY } from '../../brand/brand-copy.js';

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    // Only flips the switch. The reporting happens in componentDidCatch, which
    // is the lifecycle allowed to have side effects.
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Kept in the browser console too: a developer with the tab open should not
    // have to query the server to see what just happened.
    console.error('Render error caught by AppErrorBoundary:', error, errorInfo);
    try {
      apiClient
        .post('/errors/client', {
          message: String(error?.message ?? error ?? 'Unknown render error'),
          // The component stack is far more useful than the JS stack for a
          // render crash: it names the screen, not the minified frame.
          stack: `${error?.stack ?? ''}\n\nComponent stack:${errorInfo?.componentStack ?? ''}`,
          url: window.location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        })
        .catch(() => {});
    } catch {
      // Reporting is best-effort. The fallback below still renders.
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <div className="w-full max-w-[420px] rounded-xl border border-outline-variant bg-surface-container-lowest p-6 shadow-subtle">
          <h1 className="font-display text-[24px] font-bold leading-[32px] text-on-surface">
            {COPY.title}
          </h1>
          <p className="mt-2 font-body text-[14px] leading-[22px] text-on-surface-variant">
            {COPY.subtext}
          </p>
          {/*
            A full reload, not a state reset. The boundary caught a crash from a
            render tree whose state is now unknown; clearing the flag and
            re-rendering the same tree usually just crashes again immediately.
          */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 flex h-[48px] w-full items-center justify-center rounded-pill bg-olive-accent font-body text-[13px] font-bold uppercase tracking-label-caps text-on-tertiary transition-transform active:scale-[0.98]"
          >
            {COPY.reload}
          </button>
          <p className="mt-3 font-body text-[12px] font-bold uppercase leading-4 tracking-label-caps text-on-surface-variant">
            {COPY.reportedNote}
          </p>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
