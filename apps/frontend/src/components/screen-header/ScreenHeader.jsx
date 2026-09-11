// ScreenHeader.jsx
// The floating screen controls: a back affordance, and whatever single action
// the screen owns. Deliberately NOT a bar.
//
// This replaced 38 hand-rolled <header> blocks, and has now replaced itself.
// The bar it first standardised spent a full 56px band, a hairline and a
// background on two icons — on a phone that is the most valuable strip on the
// screen, and much of it was being used to say "this is Dedal" to someone who
// had already signed in. The controls now float over the content, so a screen
// starts at the top of the viewport and that band is returned to it.
//
// Why floating rather than merely shorter: these two controls are navigation
// chrome, not content. Pinning them over the scroll area keeps them reachable
// without reserving layout for them, and it lets a hero image, a QR pass or a
// camera feed run full-bleed to the top edge — which a bar can never allow.
//
// Contrast is the risk with any floating control, since it may sit over a
// photo, a dark scanner, or plain canvas. Each button therefore carries its own
// translucent surface and a blur, so it stays legible on all of them without
// the screen having to know what is underneath.
//
// The right slot is unchanged from the bar version: screens owning a real
// action (share a certificate, download a shift CSV, delete a round) pass it in
// and it lands top-right. The notification bell is NOT among them any more — it
// moved to the app header, where it is one destination in one place rather
// than the same destination repeated on every screen.

import { useEffect } from 'react';
import { BackIcon } from '../detail-icons/DetailIcons.jsx';
import { useNavigate } from 'react-router-dom';
import { useScreenTitleRegistration } from './screen-title-hooks.js';
import './screen-header.css';

const FLOATING_BUTTON_CLASS = [
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
  'text-on-surface transition-colors',
  'hover:bg-surface-container active:scale-95 active:bg-surface-container-high',
].join(' ');

/*
 * Shared chrome for a floating control: a 44px target — the minimum comfortable
 * touch size — on its own legible surface. Exported so screens do not re-derive
 * it; the hand-rolled copies this replaced ranged from 40px to 44px, and three
 * of them were not buttons at all.
 */
export function ScreenHeaderAction({ iconName, label, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className={FLOATING_BUTTON_CLASS}>
      <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
        {iconName}
      </span>
    </button>
  );
}

/**
 * @param {object} props
 * @param {string} [props.title] the screen's name, rendered BESIDE the back
 *   control as the page's <h1>. Screens that pass it must not also render a
 *   heading of their own — that duplication is what this replaced.
 */

/*
 * BACK, WHEN THERE IS NOTHING BEHIND.
 *
 * The default used to be a bare navigate(-1). On a screen reached normally that
 * is right — you go back where you came from. On a screen reached by a PASTED
 * URL it is not: history holds the browser's new-tab page, so the back control
 * walks the person out of the application entirely, which is what it appeared
 * to do on /fests/:slug/crew-directory opened in a fresh tab.
 *
 * react-router 7 numbers its own history entries in window.history.state.idx,
 * so `idx > 0` means there is an in-app entry behind this one. An entry the
 * router did not create has no idx, which is read as no history — the
 * conservative answer, because the fallback always lands somewhere real.
 *
 * The fallback is "/" and the navigation is a plain push, not a history delta,
 * so it works with an empty stack. A screen with a truer parent than home
 * passes its own `onBack` and overrides this entirely.
 */
function hasInAppHistory() {
  const historyIndex = window.history.state?.idx;
  return typeof historyIndex === 'number' && historyIndex > 0;
}

function ScreenHeader({ showBack = true, onBack, action = null, title = '' }) {
  const navigate = useNavigate();

  /*
   * Telling the layout that this screen carries its own bar, so the app header
   * stands down. Only when there IS a title: a bare back arrow floating over a
   * hero image is not a bar and does not replace one.
   */
  const registerScreenTitle = useScreenTitleRegistration();
  useEffect(() => {
    if (!title || !registerScreenTitle) {
      return undefined;
    }
    return registerScreenTitle();
  }, [title, registerScreenTitle]);

  // Nothing to render and nothing to reserve — the screen keeps the whole
  // viewport.
  if (!showBack && !action && !title) {
    return null;
  }

  /*
   * In normal flow, NOT fixed or sticky.
   *
   * The first version pinned these controls to the viewport so the back button
   * stayed reachable after scrolling. That traded one problem for a worse one:
   * a floating button parked over the scroll area sits on top of whatever
   * scrolls beneath it, clipping headings and body text as they pass under.
   *
   * Scrolling away is the correct behaviour here. Back is a one-tap escape you
   * reach for at the top of a screen, and the sticky app header above is always
   * present for everything else — so nothing is stranded by letting this row leave with
   * the content it belongs to.
   *
   * The row is transparent and unpainted: no background, no hairline, no title.
   * It occupies 56px at the top of the page and gives the rest back.
   */
  return (
    <div
      className="flex h-14 shrink-0 items-center justify-between px-3"
      /* Clears the notch / Dynamic Island in an installed app; env() is 0 in a
         normal browser tab, so this is inert there. */
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="shd-wrap">
        {showBack ? (
          <button
            type="button"
            onClick={onBack ?? (() => (hasInAppHistory() ? navigate(-1) : navigate('/')))}
            aria-label="Go back"
            className={FLOATING_BUTTON_CLASS}
          >
            {/*
              An SVG, not the Material Symbols ligature this used to be. A
              ligature is the literal string "arrow_back" until the webfont
              arrives, and permanently where the font is blocked — this control
              is on nearly every screen in the app, so it was the single most
              exposed instance of that failure. It also cannot inherit a stroke
              weight, so it never matched the icons beside it.
            */}
            <BackIcon size="lg" />
          </button>
        ) : (
          <span aria-hidden="true" />
        )}

        {/* The screen's <h1>. It lives here rather than in the screen so the
            control and its label are one unit, and so no screen has to spend a
            second band of vertical space repeating its own name. */}
        {title ? <h1 className="shd-title">{title}</h1> : null}
      </div>

      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export default ScreenHeader;
