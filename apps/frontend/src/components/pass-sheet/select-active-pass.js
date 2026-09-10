// select-active-pass.js
// Which pass the header shortcut shows.
//
// Split from PassSheet.jsx so that module exports only a component (React Fast
// Refresh gives up on a file that mixes the two). It is also the piece worth
// testing on its own: pure, total, and the whole of the judgement about what
// "your pass" means when you hold several.

/*
 * Running now beats starting soon, and anything already over is excluded
 * entirely. Pure, so the same list always picks the same pass.
 */
export function selectActivePass(entries, nowTs) {
  const usable = entries.filter((entry) => {
    const fest = entry?.fest;
    if (!fest || entry?.pass?.status !== 'active') return false;
    const ends = fest.endsOn ? new Date(fest.endsOn).getTime() : null;
    return ends === null || ends >= nowTs;
  });
  if (usable.length === 0) return null;

  const live = usable.filter((entry) => {
    const starts = new Date(entry.fest.startsOn).getTime();
    return starts <= nowTs;
  });
  const pool = live.length > 0 ? live : usable;
  return [...pool].sort(
    (a, b) => new Date(a.fest.startsOn).getTime() - new Date(b.fest.startsOn).getTime(),
  )[0];
}


export default selectActivePass;
