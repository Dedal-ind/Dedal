// InlineError.jsx
// A compact inline failure notice on dedal tokens: a card with a hairline
// border, the message in body type, and a primary retry action. Used wherever an API call can fail without taking over the
// whole screen.

import { INLINE_ERROR_COPY } from '../../brand/brand-copy.js';

function InlineError({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--divider)] bg-[var(--surface-card)] px-4 py-3">
      <p className="font-[family-name:var(--font)] text-[14px] leading-[22px] text-[var(--ink)]">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-pill bg-[var(--primary)] px-4 py-1.5 font-[family-name:var(--font)] text-[12px] font-bold text-white active:scale-[0.98]"
        >
          {INLINE_ERROR_COPY.retry}
        </button>
      ) : null}
    </div>
  );
}

export default InlineError;
