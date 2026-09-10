// InlineError.jsx
// A compact inline failure notice, Heritage Institutional: a white card with a
// hairline error-tinted border, the message in Inter body type, and an olive
// retry action. Used wherever an API call can fail without taking over the
// whole screen.

import { INLINE_ERROR_COPY } from '../../brand/brand-copy.js';

function InlineError({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-error/40 bg-surface-container-lowest px-4 py-3">
      <p className="font-body text-[14px] leading-[22px] text-on-surface">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-pill bg-olive-accent px-4 py-1.5 font-body text-[12px] font-bold uppercase tracking-label-caps text-on-tertiary active:scale-[0.98]"
        >
          {INLINE_ERROR_COPY.retry}
        </button>
      ) : null}
    </div>
  );
}

export default InlineError;
