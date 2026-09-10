// delivery-reporter.js
// Buffers delivery events and sends them in batches. The client-side half of
// promotions delivery tracking.
//
// WHAT AN EVENT IS. { token, kind, occurredAt }. Nothing else: the server
// reads the campaign, creative, placement and cap subject from the decision
// token it minted, and ignores anything else a client asserts.
//
// BATCHED, NOT PER EVENT. Events queue in memory and flush on a short
// interval, or immediately when the page is hidden. A carousel fires several
// events in a second; one request per event would be the noisiest thing on
// the home screen.
//
// SURVIVES UNLOAD. The flush uses fetch with `keepalive: true`, which the
// browser keeps alive after the page goes away — the modern equivalent of
// sendBeacon that can carry headers. sendBeacon itself is NOT used: it cannot
// set an Authorization header, the bearer token lives in web storage rather
// than a cookie, and the ingest endpoint is authenticated, so a beacon would
// arrive as a 401 and every unload flush would be lost.
//
// SAFE TO RETRY, CHEAP TO LOSE. The server records each (token, kind) once
// and answers a duplicate as a duplicate, so re-sending can never inflate
// anything. A failed flush is dropped quietly: measurement is not worth a
// visible error or a blocked navigation. Nothing here is ever awaited by
// rendering or by a click.

import { getStoredAuthToken } from '../api-client/api-client.js';

const FLUSH_INTERVAL_MILLISECONDS = 2000;
const MAXIMUM_BATCH_SIZE = 50;

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const INGEST_URL = `${apiBaseUrl}/delivery/events`;

let buffer = [];
let flushTimer = null;
let listenersInstalled = false;

function send(events) {
  const authToken = getStoredAuthToken();
  if (!authToken || events.length === 0) {
    return;
  }
  try {
    fetch(INGEST_URL, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ events }),
    }).catch(() => {
      /* Dropped on purpose — see the file header. */
    });
  } catch {
    /* fetch itself threw (no network stack, or a keepalive body too large): drop. */
  }
}

/* Sends everything queued, in chunks the server will accept. */
export function flushDeliveryEvents() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (buffer.length > 0) {
    send(buffer.splice(0, MAXIMUM_BATCH_SIZE));
  }
}

function installListeners() {
  if (listenersInstalled || typeof window === 'undefined') {
    return;
  }
  listenersInstalled = true;
  /*
   * pagehide fires on tab close and on navigation away, including bfcache
   * entry; visibilitychange → hidden covers a backgrounded tab on mobile,
   * which may be killed without any further event. Both flush; a second
   * flush of an empty buffer is a no-op.
   */
  window.addEventListener('pagehide', flushDeliveryEvents);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushDeliveryEvents();
    }
  });
}

/*
 * Queue one event. `kind` is measurable, viewable or click — the decision is
 * the server's own record and the client never sends one.
 */
export function reportDeliveryEvent(token, kind) {
  if (typeof token !== 'string' || token.length === 0) {
    return;
  }
  installListeners();
  buffer.push({ token, kind, occurredAt: new Date().toISOString() });
  if (buffer.length >= MAXIMUM_BATCH_SIZE) {
    flushDeliveryEvents();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flushDeliveryEvents, FLUSH_INTERVAL_MILLISECONDS);
  }
}

export const DELIVERY_EVENT_KINDS = {
  MEASURABLE: 'measurable',
  VIEWABLE: 'viewable',
  CLICK: 'click',
};
