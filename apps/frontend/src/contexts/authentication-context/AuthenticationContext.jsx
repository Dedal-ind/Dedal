/* eslint-disable react-refresh/only-export-components */
// AuthenticationContext.jsx
// Holds the signed-in participant's JWT token and user object for the whole app.
// The token is mirrored to storage (via the api-client helpers) — sessionStorage
// on desktop (re-login each visit) and localStorage on mobile (remembers). The axios
// interceptor can attach it and so a refresh keeps the session. Screens read and
// mutate auth state through the useAuthentication hook.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import apiClient, {
  getStoredAuthToken,
  storeAuthToken,
  clearStoredAuthToken,
  AUTH_USER_STORAGE_KEY,
} from '../../api-client/api-client.js';

export const ADMIN_ROLES = ['administrator', 'platformAdmin'];

const ROLE_PRECEDENCE = ['platformAdmin', 'administrator', 'coordinator', 'volunteer'];

const PARTICIPANT_ROLE_IDENTITY = { kind: 'participant', label: null, scopeName: null };

function deriveRoleIdentity(assignments) {
  const list = Array.isArray(assignments) ? assignments : [];
  for (const role of ROLE_PRECEDENCE) {
    const assignment = list.find((candidate) => candidate.role === role);
    if (!assignment) {
      continue;
    }
    if (role === 'platformAdmin') {
      return { kind: 'platformAdmin', label: 'Platform Admin', scopeName: null };
    }
    if (role === 'administrator') {
      return {
        kind: 'administrator',
        label: 'College Admin',
        scopeName: assignment.collegeId?.commonName ?? null,
      };
    }
    if (role === 'coordinator') {
      return {
        kind: 'coordinator',
        label: 'Coordinator',
        scopeName: assignment.festId?.festName ?? assignment.eventIds?.[0]?.eventName ?? null,
      };
    }
    return {
      kind: 'volunteer',
      label: 'Volunteer',
      scopeName: assignment.festId?.festName ?? null,
    };
  }
  return PARTICIPANT_ROLE_IDENTITY;
}

function readStoredUser() {
  const rawStoredUser = window.localStorage.getItem(AUTH_USER_STORAGE_KEY)
    || window.sessionStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!rawStoredUser) {
    return null;
  }
  try {
    return JSON.parse(rawStoredUser);
  } catch {
    return null;
  }
}

const AuthenticationContext = createContext(null);

export function AuthenticationProvider({ children }) {
  const [authToken, setAuthToken] = useState(() => getStoredAuthToken());
  const [currentUser, setCurrentUser] = useState(() => readStoredUser());
  const [hasStaffAssignment, setHasStaffAssignment] = useState(false);
  const [adminAssignments, setAdminAssignments] = useState([]);
  const [authorizationState, setAuthorizationState] = useState('unknown');
  const [staffAssignments, setStaffAssignments] = useState([]);

  useEffect(() => {
    const isDesktop = window.matchMedia('(min-width: 768px)').matches;
    const storage = isDesktop ? window.sessionStorage : window.localStorage;
    // Clear both to avoid duplicates
    window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);
    if (currentUser) {
      storage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(currentUser));
    }
  }, [currentUser]);

  useEffect(() => {
    if (!authToken) {
      return undefined;
    }
    let isActive = true;
    apiClient
      .get('/users/me')
      .then((freshUser) => {
        if (isActive && freshUser) {
          setCurrentUser((previousUser) => ({ ...previousUser, ...freshUser }));
        }
      })
      .catch((refreshError) => {
        const authenticationRejectionCodes = [
          'AUTHENTICATION_TOKEN_MISSING',
          'AUTHENTICATION_TOKEN_EXPIRED',
          'AUTHENTICATION_TOKEN_INVALID',
          'USER_NOT_FOUND',
        ];
        if (isActive && authenticationRejectionCodes.includes(refreshError?.code)) {
          setAuthToken(null);
          setCurrentUser(null);
        }
      });
    return () => {
      isActive = false;
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasStaffAssignment(false);
      setAdminAssignments([]);
      setStaffAssignments([]);
      setAuthorizationState('unauthorized');
      return undefined;
    }
    let isActive = true;
    setAuthorizationState('unknown');
    apiClient
      .get('/staff-assignments/mine')
      .then((assignments) => {
        if (!isActive) {
          return;
        }
        const list = Array.isArray(assignments) ? assignments : [];
        setHasStaffAssignment(list.length > 0);
        setStaffAssignments(list);
        const adminRows = list.filter((assignment) => ADMIN_ROLES.includes(assignment.role));
        setAdminAssignments(adminRows);
        setAuthorizationState(adminRows.length > 0 ? 'authorized' : 'unauthorized');
      })
      .catch(() => {
        if (isActive) {
          setHasStaffAssignment(false);
          setAdminAssignments([]);
          setStaffAssignments([]);
          setAuthorizationState('unauthorized');
        }
      });
    return () => {
      isActive = false;
    };
  }, [authToken]);

  function signIn(nextAuthToken, nextUser) {
    storeAuthToken(nextAuthToken);
    setAuthToken(nextAuthToken);
    setCurrentUser(nextUser);
  }

  function updateUser(userChanges) {
    setCurrentUser((previousUser) => ({ ...previousUser, ...userChanges }));
  }

  function signOut() {
    clearStoredAuthToken();
    setAuthToken(null);
    setCurrentUser(null);
    setAdminAssignments([]);
    setStaffAssignments([]);
    setAuthorizationState('unauthorized');
  }

  const contextValue = useMemo(
    () => ({
      authToken,
      currentUser,
      isAuthenticated: Boolean(authToken),
      hasStaffAssignment,
      authorizationState,
      isAdministrator: authorizationState === 'authorized',
      isPlatformAdmin: adminAssignments.some((assignment) => assignment.role === 'platformAdmin'),
      adminAssignments,
      staffAssignments,
      roleIdentity: deriveRoleIdentity(staffAssignments),
      administeredFests: adminAssignments.map((assignment) => assignment.festId).filter(Boolean),
      signIn,
      updateUser,
      signOut,
    }),
    [
      authToken,
      currentUser,
      hasStaffAssignment,
      authorizationState,
      adminAssignments,
      staffAssignments,
    ],
  );

  return (
    <AuthenticationContext.Provider value={contextValue}>
      {children}
    </AuthenticationContext.Provider>
  );
}

export function useAuthentication() {
  const authenticationValue = useContext(AuthenticationContext);
  if (authenticationValue === null) {
    throw new Error('useAuthentication must be used inside an AuthenticationProvider.');
  }
  return authenticationValue;
}

export default AuthenticationContext;
