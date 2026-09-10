// EmptyState.jsx
// THE empty state. One, shared, for every screen in the participant app that
// can come back with nothing.
//
// WHY IT LOOKS LIKE THIS.
//
// The previous version — and the five near-identical copies of it that had
// drifted into five stylesheets — was a headline, a subheading, an oversized
// mark and a pill, stacked at the TOP of an otherwise blank page. Three things
// were wrong with that. An illustrated composition pinned under the header
// reads as a page that failed to load rather than a page with nothing in it. A
// headline plus a subheading is two sentences where the situation only has
// one — the second line is always filler, because there is nothing to
// elaborate on. And a bordered or tinted box drawn around nothing looks like a
// broken component; empty space is the design.
//
// So: ONE plain sentence in --body-m at --ink, and at most ONE --primary
// action, centred in the space the screen has left. --ink and not --muted,
// because grey text alone in the middle of an empty screen reads as disabled.
//
// The action is optional and is omitted where there is genuinely nowhere
// useful to go — an empty notifications feed has no action, because there is
// nothing a person can do to acquire notifications.
//
// CENTRING. The block claims the viewport minus a fixed offset, defaulting to
// 120px: the 56px ScreenHeader plus the padding a screen typically puts above
// and below its content column. Deliberately a slight UNDERSHOOT, so the block
// never grows taller than the room actually available and introduces a
// scrollbar on a page that has nothing to scroll. A screen with more chrome
// than that overrides --des-empty-offset. 100dvh, not 100vh, so a mobile
// browser's collapsing toolbar cannot push the sentence off the bottom.
//
// It is min-height on THIS element and never on the screen root, so the
// populated state of every screen is untouched.

import './empty-state.css';

/**
 * @param {object} props
 * @param {string} props.line   The single sentence. Sentence case, no period-
 *                              less fragments, no headline/subheading pair.
 * @param {string} [props.actionLabel]  Omit to render no action.
 * @param {() => void} [props.onAction]
 * @param {string} [props.className]    For a screen that must adjust the
 *                                      vertical offset it sits in.
 */
function EmptyState({ line, actionLabel, onAction, className }) {
  return (
    <div className={className ? `des-empty ${className}` : 'des-empty'}>
      <p className="des-empty__line">{line}</p>
      {actionLabel && onAction ? (
        <button type="button" className="des-empty__action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export default EmptyState;
