// api-client.js
// The single configured axios instance every screen and hook uses to talk to
// the Dedal backend. It attaches the stored JWT to every request, unwraps the
// backend's { data } / { error } response envelope, and redirects to the email
// sign-in screen on a 401.

import axios from 'axios';
import { saveIntendedRoute } from '../helpers/post-sign-in-redirect.js';

// The sessionStorage key the JWT is stored under. Kept here so both the client and
// the auth flow read and write the same key.
// Desktop (≥768px): sessionStorage — login does not persist across browser close.
// Mobile  (<768px): localStorage  — login is remembered across sessions.
export const AUTH_TOKEN_STORAGE_KEY = 'festpass.authToken';

// The cached-user key AuthenticationContext mirrors the signed-in user under.
// The 401 handler must clear BOTH: clearing only the token leaves a "zombie
// session" — the cached user keeps the UI looking signed in while every
// authenticated call fails, which is exactly how a participant reached checkout
// looking signed-in and then got bounced to sign-in on tapping Pay.
export const AUTH_USER_STORAGE_KEY = 'festpass.authUser';

// The payment surface a 401 must not orphan: sign-in should return the user
// here, not to the generic feed. Matched by prefix on the CURRENT path.
const PAYMENT_FLOW_PATH_PREFIXES = ['/checkout/', '/payment-processing/', '/payment-failed/'];

// Desktop uses sessionStorage (re-login on close), mobile uses localStorage (remembers).
function getStorage() {
  const isDesktop = window.matchMedia('(min-width: 768px)').matches;
  return isDesktop ? window.sessionStorage : window.localStorage;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
});

export function getStoredAuthToken() {
  // Check both storages — user might have switched between mobile/desktop
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
    || window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function storeAuthToken(authToken) {
  const storage = getStorage();
  // Clear the other storage to avoid duplicates
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  storage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
}

export function clearStoredAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

// Request interceptor — attach the bearer token when we have one.
apiClient.interceptors.request.use((requestConfig) => {
  const authToken = getStoredAuthToken();
  if (authToken) {
    requestConfig.headers.Authorization = `Bearer ${authToken}`;
  }
  return requestConfig;
});

// Response interceptor — unwrap the success envelope, normalise the error one,
// and bounce unauthenticated users back to sign-in.
apiClient.interceptors.response.use(
  (response) => {
    // Success envelope is { data: ... }. Unwrap it so callers get the payload
    // directly instead of digging through response.data.data.
    if (response.data && Object.prototype.hasOwnProperty.call(response.data, 'data')) {
      return response.data.data;
    }
    return response.data;
  },
  (error) => {
    const httpStatus = error.response?.status;

    if (httpStatus === 401) {
      clearStoredAuthToken();
      // A dead session must be dead ALL the way: without this, the cached user
      // keeps the UI looking signed in after a silent boot-time 401 (the
      // "zombie session"), and the failure only surfaces when the participant
      // reaches the first authenticated action — historically, tapping Pay.
      window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);
      // A 401 mid-payment must not strand the purchase: stash the checkout
      // path so the sign-in flow (resolvePostSignInRoute) returns the user to
      // /checkout/:paymentGroupId instead of the generic feed. Payment paths
      // only — everywhere else the existing land-on-home behaviour stands.
      const currentPath = window.location.pathname;
      if (PAYMENT_FLOW_PATH_PREFIXES.some((prefix) => currentPath.startsWith(prefix))) {
        saveIntendedRoute(currentPath);
      }
      // Hard redirect so all in-memory auth state is dropped.
      if (currentPath !== '/') {
        window.location.assign('/');
      }
    }

    // Error envelope is { error: { code, message, details } }. Throw that shape
    // so callers can switch on a stable code. Fall back to a synthetic error
    // when the failure never reached the backend (network, timeout).
    const backendError = error.response?.data?.error;
    if (backendError) {
      return Promise.reject(backendError);
    }

    return Promise.reject({
      code: 'NETWORK_ERROR',
      message: 'Could not reach Dedal. Check your connection and try again.',
      details: {},
    });
  },
);

export default apiClient;
