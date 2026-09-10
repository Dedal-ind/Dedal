// AdminHierarchyFilter.jsx
// The ONE cascading Fest → Event → Sub-event filter for the whole admin
// console. Nine screens used to reimplement a fest picker each; they all mount
// this instead. If you are about to copy this file, don't — add a prop.
//
// THREE LEVELS, CAPPED. parentEventId allows arbitrary nesting, but the cascade
// stops at sub-event: a sub-event that itself has children does NOT get a
// fourth dropdown. Those deeper events are still covered — the scope this emits
// carries includeDescendants, so selecting a sub-event includes everything
// beneath it. A fourth level would need a tree control, not another <select>.
//
// The event list is fetched ONCE per fest and cached in a ref for the lifetime
// of the mount; the cascade is then pure client-side grouping by parentEventId.
// Three requests per selection change made the console feel sluggish.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveSelect from '../admin-executive-select/AdminExecutiveSelect.jsx';
import { ALL_OPTION_VALUE } from '../../helpers/admin-hierarchy-scope.js';
import { ADMIN_HIERARCHY_FILTER_COPY as COPY } from '../../brand-admin/brand-copy.js';

function AdminHierarchyFilter({
  fests = [],
  selectedFestId = '',
  selectedEventId = '',
  selectedSubEventId = '',
  onChange,
  showAllOption = true,
  disabled = false,
  className = '',
}) {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const [events, setEvents] = useState([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  // festId → event list. A ref, not state: caching must not re-render, and it
  // must not outlive the screen (so no localStorage, no global store).
  const eventsByFestIdReference = useRef(new Map());
  const hasReadUrlReference = useRef(false);

  const emitChange = useCallback(
    (nextScope) => {
      onChange?.(nextScope);
      /*
       * URL sync through the router's own setter — window.history.replaceState
       * would desync React Router's internal location and the next navigation
       * would fight it. replace: true so drilling the filter does not fill the
       * back stack with filter states.
       */
      const nextParameters = new URLSearchParams(searchParameters);
      for (const [key, value] of Object.entries({
        festId: nextScope.festId,
        eventId: nextScope.eventId,
        subEventId: nextScope.subEventId,
      })) {
        if (value) {
          nextParameters.set(key, value);
        } else {
          nextParameters.delete(key);
        }
      }
      setSearchParameters(nextParameters, { replace: true });
    },
    [onChange, searchParameters, setSearchParameters],
  );

  // The fest's whole event tree, once per fest.
  const loadEventsForFest = useCallback(async (festId) => {
    if (!festId) {
      setEvents([]);
      return [];
    }
    const cached = eventsByFestIdReference.current.get(festId);
    if (cached) {
      setEvents(cached);
      return cached;
    }
    setIsLoadingEvents(true);
    try {
      const eventList = await apiClient.get(`/fests/${festId}/events/all?includeChildren=true`);
      const safeEvents = Array.isArray(eventList) ? eventList : [];
      eventsByFestIdReference.current.set(festId, safeEvents);
      setEvents(safeEvents);
      return safeEvents;
    } catch {
      setEvents([]);
      return [];
    } finally {
      setIsLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEventsForFest(selectedFestId);
  }, [selectedFestId, loadEventsForFest]);

  /*
   * Mount-time URL adoption, exactly once. A stale bookmark naming a deleted or
   * now-inaccessible event is NOT an error — the unknown id is simply dropped
   * and the filter falls back to "All events".
   */
  useEffect(() => {
    if (hasReadUrlReference.current || fests.length === 0) {
      return;
    }
    hasReadUrlReference.current = true;

    const urlFestId = searchParameters.get('festId');
    if (!urlFestId || !fests.some((fest) => fest.id === urlFestId)) {
      return;
    }
    (async () => {
      const festEvents = await loadEventsForFest(urlFestId);
      const urlEventId = searchParameters.get('eventId');
      const urlSubEventId = searchParameters.get('subEventId');
      const isKnown = (eventId) => festEvents.some((event) => event.id === eventId);
      onChange?.({
        festId: urlFestId,
        eventId: urlEventId && isKnown(urlEventId) ? urlEventId : null,
        subEventId: urlSubEventId && isKnown(urlSubEventId) ? urlSubEventId : null,
      });
    })();
    // Deliberately mount-only: re-running would fight the admin's own choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fests]);

  const topLevelEvents = useMemo(
    () => events.filter((event) => !event.parentEventId),
    [events],
  );
  const subEvents = useMemo(
    () => (selectedEventId ? events.filter((event) => event.parentEventId === selectedEventId) : []),
    [events, selectedEventId],
  );

  /*
   * A solo container wraps exactly ONE event, so making the admin pick it from
   * a one-item dropdown is a pointless step — it is selected for them.
   */
  const selectedFest = fests.find((fest) => fest.id === selectedFestId) ?? null;
  useEffect(() => {
    if (
      selectedFest?.isSoloContainer &&
      !selectedEventId &&
      topLevelEvents.length === 1
    ) {
      onChange?.({ festId: selectedFestId, eventId: topLevelEvents[0].id, subEventId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFest, topLevelEvents, selectedEventId]);

  const festOptions = fests.map((fest) => ({
    value: fest.id,
    // No chip component inside a native <option> — a browser renders only text
    // there, so the marker is part of the label.
    label: fest.isSoloContainer ? `${fest.festName} · ${COPY.independentTag}` : fest.festName,
  }));

  const eventOptions = [
    ...(showAllOption ? [{ value: ALL_OPTION_VALUE, label: COPY.allEvents }] : []),
    ...topLevelEvents.map((event) => ({ value: event.id, label: event.eventName })),
  ];

  const subEventOptions = [
    ...(showAllOption ? [{ value: ALL_OPTION_VALUE, label: COPY.allSubEvents }] : []),
    ...subEvents.map((event) => ({ value: event.id, label: event.eventName })),
  ];

  const hasNoEvents = Boolean(selectedFestId) && !isLoadingEvents && topLevelEvents.length === 0;

  return (
    <div
      className={[
        'grid grid-cols-1 gap-4 sm:grid-cols-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <AdminExecutiveSelect
        label={COPY.festLabel}
        placeholder={COPY.festPlaceholder}
        options={festOptions}
        value={selectedFestId}
        disabled={disabled}
        helperText={fests.length === 0 ? COPY.noFests : undefined}
        onChange={(changeEvent) =>
          // A new fest invalidates both children.
          emitChange({ festId: changeEvent.target.value || null, eventId: null, subEventId: null })
        }
      />

      <AdminExecutiveSelect
        label={COPY.eventLabel}
        options={eventOptions}
        value={selectedEventId}
        // Disabled until a fest is chosen — a child filter with no parent can
        // only narrow data the admin is not looking at.
        disabled={disabled || !selectedFestId || hasNoEvents}
        helperText={hasNoEvents ? COPY.noEvents : undefined}
        onChange={(changeEvent) =>
          emitChange({
            festId: selectedFestId,
            eventId: changeEvent.target.value || null,
            subEventId: null,
          })
        }
      />

      {/*
        * HIDDEN, not disabled, when the selected event has no children: a
        * permanently greyed-out empty dropdown reads as broken. Absence says
        * "this event is the leaf" far more clearly.
        */}
      {subEvents.length > 0 ? (
        <AdminExecutiveSelect
          label={COPY.subEventLabel}
          options={subEventOptions}
          value={selectedSubEventId}
          disabled={disabled}
          onChange={(changeEvent) =>
            emitChange({
              festId: selectedFestId,
              eventId: selectedEventId,
              subEventId: changeEvent.target.value || null,
            })
          }
        />
      ) : null}
    </div>
  );
}

export default AdminHierarchyFilter;
