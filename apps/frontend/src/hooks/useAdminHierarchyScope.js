// useAdminHierarchyScope.js
// The state half of the shared Fest → Event → Sub-event filter. Every admin
// screen holds its scope through this hook so none of them reimplements the
// reset rules (a new fest clears event and sub-event; a new event clears
// sub-event) — AdminHierarchyFilter emits the whole next scope, the hook just
// stores it.

import { useCallback, useState } from 'react';
import {
  buildHierarchyScopeQuery,
  buildHierarchyScopeParameters,
} from '../helpers/admin-hierarchy-scope.js';

export function useAdminHierarchyScope(initialFestId = '') {
  const [scope, setScope] = useState({
    festId: initialFestId,
    eventId: '',
    subEventId: '',
  });

  // The component always sends the complete next scope, children included, so
  // there is nothing to merge — storing it verbatim IS the reset behaviour.
  const handleScopeChange = useCallback((nextScope) => {
    setScope({
      festId: nextScope.festId ?? '',
      eventId: nextScope.eventId ?? '',
      subEventId: nextScope.subEventId ?? '',
    });
  }, []);

  return {
    scope,
    setScope,
    handleScopeChange,
    // "?eventId=…&includeDescendants=true" — append to any scoped endpoint.
    scopeQuery: buildHierarchyScopeQuery(scope),
    scopeParameters: buildHierarchyScopeParameters(scope),
    // The single event a screen should act on: the sub-event if one is chosen,
    // else the event, else nothing (fest-wide).
    activeEventId: scope.subEventId || scope.eventId || '',
  };
}
