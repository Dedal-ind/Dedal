// admin-hierarchy-scope.js
// Turns the shared Fest → Event → Sub-event filter's selection into the query
// string its endpoints understand. Lives outside the component file so screens
// can import it without pulling in a React component (and so fast refresh keeps
// working).

export const ALL_OPTION_VALUE = '';

/*
 * includeDescendants is TRUE when an event is chosen but no sub-event: "show me
 * this event and everything under it" — which is what selecting a parent in the
 * cascade means to an admin. Choosing a specific sub-event means they picked one
 * leaf, so it is false. With no event chosen there is nothing to widen.
 */
export function buildHierarchyScopeQuery({ eventId, subEventId }) {
  const scopedEventId = subEventId || eventId || null;
  if (!scopedEventId) {
    return '';
  }
  const parameters = new URLSearchParams({ eventId: scopedEventId });
  if (!subEventId) {
    parameters.set('includeDescendants', 'true');
  }
  return `?${parameters.toString()}`;
}

/* The same scope as an object, for callers assembling their own query string. */
export function buildHierarchyScopeParameters({ eventId, subEventId }) {
  const scopedEventId = subEventId || eventId || null;
  if (!scopedEventId) {
    return {};
  }
  return subEventId
    ? { eventId: scopedEventId }
    : { eventId: scopedEventId, includeDescendants: 'true' };
}
