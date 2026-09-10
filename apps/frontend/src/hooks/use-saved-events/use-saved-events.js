// use-saved-events.js
// Saved (bookmarked) events, stored against the ACCOUNT.
//
// This used to keep the list in localStorage. That tied saves to a browser
// rather than a person: bookmark on your phone, open the laptop, nothing there.
// Worse, the key was never scoped to a user, so two people signing in on the
// same device saw each other's saves. It now reads and writes the server.
//
// The set is still mirrored in module state and broadcast on a window event so
// every mounted consumer (the detail-page bookmark, the saved list, the profile
// count badge) stays in sync without a global store.

import { useCallback, useEffect, useState } from 'react';

import { apiClient } from '../../api-client/api-client.js';

const SAVED_EVENTS_CHANGED_EVENT = 'festpass:saved-events-changed';

/*
 * One shared copy of the list. Without this, every consumer would fetch on
 * mount and the profile badge would flash its count on each navigation.
 */
let cachedSavedEventIds = [];
let hasLoadedOnce = false;
let inFlightLoad = null;

function broadcast() {
  window.dispatchEvent(new CustomEvent(SAVED_EVENTS_CHANGED_EVENT));
}

function setCache(ids) {
  cachedSavedEventIds = Array.isArray(ids) ? ids.map(String) : [];
  hasLoadedOnce = true;
  broadcast();
}

async function loadSavedEventIds() {
  /* Share one request if several consumers mount at once. */
  if (inFlightLoad) return inFlightLoad;
  inFlightLoad = apiClient
    .get('/users/me/saved-events')
    .then((result) => {
      setCache(result?.savedEventIds ?? []);
      return cachedSavedEventIds;
    })
    .catch(() => {
      /* Signed out, or offline. An empty list is the honest answer; the
       * bookmark simply shows unsaved rather than the screen erroring. */
      setCache([]);
      return cachedSavedEventIds;
    })
    .finally(() => {
      inFlightLoad = null;
    });
  return inFlightLoad;
}

export function useSavedEvents() {
  const [savedEventIds, setSavedEventIds] = useState(cachedSavedEventIds);
  const [isLoading, setIsLoading] = useState(!hasLoadedOnce);

  useEffect(() => {
    function handleChange() {
      setSavedEventIds(cachedSavedEventIds);
    }
    window.addEventListener(SAVED_EVENTS_CHANGED_EVENT, handleChange);

    if (!hasLoadedOnce) {
      loadSavedEventIds().finally(() => setIsLoading(false));
    }
    return () => window.removeEventListener(SAVED_EVENTS_CHANGED_EVENT, handleChange);
  }, []);

  const isSaved = useCallback(
    (eventId) => savedEventIds.includes(String(eventId)),
    [savedEventIds],
  );

  /*
   * Optimistic: the bookmark fills the moment it is tapped, because waiting on
   * a round trip makes the control feel broken. If the write fails the previous
   * state is put back, so the icon never lies for longer than the request.
   */
  const saveEvent = useCallback(async (eventId) => {
    const id = String(eventId);
    if (cachedSavedEventIds.includes(id)) return true;
    const previous = cachedSavedEventIds;
    setCache([...previous, id]);
    try {
      const result = await apiClient.post(`/users/me/saved-events/${id}`);
      setCache(result?.savedEventIds ?? [...previous, id]);
      return true;
    } catch {
      setCache(previous);
      return false;
    }
  }, []);

  const unsaveEvent = useCallback(async (eventId) => {
    const id = String(eventId);
    const previous = cachedSavedEventIds;
    setCache(previous.filter((saved) => saved !== id));
    try {
      const result = await apiClient.delete(`/users/me/saved-events/${id}`);
      setCache(result?.savedEventIds ?? previous.filter((saved) => saved !== id));
      return true;
    } catch {
      setCache(previous);
      return false;
    }
  }, []);

  const toggleSaved = useCallback(
    (eventId) => {
      const id = String(eventId);
      if (cachedSavedEventIds.includes(id)) {
        unsaveEvent(id);
        return false;
      }
      saveEvent(id);
      return true;
    },
    [saveEvent, unsaveEvent],
  );

  const refresh = useCallback(() => loadSavedEventIds(), []);

  return { savedEventIds, isSaved, saveEvent, unsaveEvent, toggleSaved, isLoading, refresh };
}

export default useSavedEvents;
