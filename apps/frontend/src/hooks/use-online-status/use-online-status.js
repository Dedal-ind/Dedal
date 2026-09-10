// use-online-status.js
// Tracks whether the browser currently has a network connection.
//
// This exists so a failed request can say the true thing. Every list screen
// treated a rejected fetch as "could not load your certificates", which is
// wrong-footed advice when the real problem is that the phone is in a lift:
// retrying is useless until the connection is back, and the person is left
// wondering whether their certificates are gone.
//
// navigator.onLine is a floor, not a guarantee — it reports whether the device
// has a network interface, not whether our API is reachable — so it is used to
// distinguish "you are offline" from "the request failed", never to block a
// retry. If it says offline, it is definitely offline.

import { useEffect, useState } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  );

  useEffect(() => {
    function goOnline() {
      setIsOnline(true);
    }
    function goOffline() {
      setIsOnline(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

export default useOnlineStatus;
