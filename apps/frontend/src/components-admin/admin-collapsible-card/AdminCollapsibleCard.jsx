// AdminCollapsibleCard.jsx
// A titled card whose body collapses, animated with GSAP at 240ms.
//
// STARTS EXPANDED. A dashboard that opens closed is a dashboard that shows
// nothing — the admin would have to open five cards before seeing a number, and
// the collapse exists to get sections OUT of the way once they have been read,
// not to hide them on arrival.
//
// HEIGHT IS ANIMATED FROM A MEASUREMENT, NOT TO A CONSTANT. The body's height
// depends on how many bars a fest's data produces, so the tween reads
// scrollHeight at the moment it starts and clears the inline height when it
// finishes — leaving a fixed height behind would clip a section that later
// grows, and animating to `auto` is not something GSAP can interpolate.
//
// REDUCED MOTION SKIPS THE TWEEN ENTIRELY rather than shortening it. The
// content still appears; only the movement is dropped.

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ChevronDown } from 'lucide-react';
import { prefersReducedMotion } from '../../design/motion.js';

const TOGGLE_SECONDS = 0.24;

function AdminCollapsibleCard({ title, action = null, children }) {
  const [isOpen, setIsOpen] = useState(true);
  const bodyRef = useRef(null);
  /* The first render must not animate: a card that tweens open on arrival makes
     the whole dashboard shuffle as five of them land. */
  const hasMountedRef = useRef(false);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return undefined;
    }
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return undefined;
    }
    if (prefersReducedMotion()) {
      body.style.height = isOpen ? 'auto' : '0px';
      body.style.overflow = isOpen ? '' : 'hidden';
      return undefined;
    }

    const tween = gsap.to(body, {
      height: isOpen ? body.scrollHeight : 0,
      duration: TOGGLE_SECONDS,
      ease: 'power2.inOut',
      onStart: () => {
        body.style.overflow = 'hidden';
      },
      onComplete: () => {
        /* Cleared so the section can grow with its data afterwards. */
        if (isOpen) {
          body.style.height = 'auto';
          body.style.overflow = '';
        }
      },
    });
    return () => tween.kill();
  }, [isOpen]);

  return (
    <section className="rounded-lg border border-admin-slate-200 bg-admin-surface-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setIsOpen((wasOpen) => !wasOpen)}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            size={16}
            strokeWidth={2}
            className={[
              'shrink-0 text-admin-slate-600 transition-transform duration-200',
              isOpen ? '' : '-rotate-90',
            ].join(' ')}
            aria-hidden="true"
          />
          <span className="truncate font-admin-body text-[15px] font-semibold text-admin-neutral-ink">
            {title}
          </span>
        </button>
        {action}
      </div>

      <div ref={bodyRef}>
        <div className="border-t border-admin-slate-100 px-4 py-4">{children}</div>
      </div>
    </section>
  );
}

export default AdminCollapsibleCard;
