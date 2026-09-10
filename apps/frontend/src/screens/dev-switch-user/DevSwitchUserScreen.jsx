// DevSwitchUserScreen.jsx
// Route: /dev/switch-user — a development-only identity switcher.
// Lists every seeded user (grouped by role) and lets you sign in AS any of them
// with one tap, no OTP. It talks to the dev-only backend routes
// GET /dev/users and POST /dev/login-as, which answer 404 outside development —
// so on a production build this screen simply shows "unavailable".

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import SkeletonBlock from '../../components/skeleton-block/SkeletonBlock.jsx';

// Coarsest-first so the picker reads admin → coordinator → volunteer → participant.
const ROLE_ORDER = ['platformAdmin', 'administrator', 'coordinator', 'volunteer', 'participant'];
const ROLE_LABELS = {
  platformAdmin: 'Platform admin',
  administrator: 'College admin',
  coordinator: 'Coordinators',
  volunteer: 'Volunteers',
  participant: 'Participants',
};

function DevSwitchUserScreen() {
  const navigate = useNavigate();
  const { signIn, currentUser, signOut } = useAuthentication();
  const [loadState, setLoadState] = useState('loading'); // loading | ready | unavailable | error
  const [users, setUsers] = useState([]);
  const [switchingEmail, setSwitchingEmail] = useState(null);
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    setLoadState('loading');
    try {
      const payload = await apiClient.get('/dev/users');
      setUsers(Array.isArray(payload) ? payload : []);
      setLoadState('ready');
    } catch (loadError) {
      // 404 = the dev routes are gated off (not development). Anything else is a real error.
      setLoadState(loadError?.code === 'ROUTE_NOT_FOUND' ? 'unavailable' : 'error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
  }, [loadUsers]);

  async function switchTo(user) {
    setError('');
    setSwitchingEmail(user.emailAddress);
    try {
      const session = await apiClient.post('/dev/login-as', { emailAddress: user.emailAddress });
      signIn(session.authenticationToken, session.user);
      navigate('/');
    } catch (switchError) {
      setError(switchError.message || 'Could not switch user.');
      setSwitchingEmail(null);
    }
  }

  const groups = ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role] ?? role,
    members: users.filter((user) => user.role === role),
  })).filter((group) => group.members.length > 0);

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <ScreenHeader sticky={false} />

      {loadState === 'loading' ? (
        <div className="flex flex-col gap-3">
          <SkeletonBlock className="h-14 w-full" />
          <SkeletonBlock className="h-14 w-full" />
          <SkeletonBlock className="h-14 w-full" />
        </div>
      ) : null}

      {loadState === 'unavailable' ? (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
          <p className="font-body text-[14px] leading-[22px] text-on-surface">
            The user switcher is only available when the backend runs with
            APPLICATION_ENVIRONMENT=development.
          </p>
        </div>
      ) : null}

      {loadState === 'error' ? (
        <div className="rounded-xl border border-error/40 bg-error-container/40 p-4">
          <p className="mb-3 font-body text-[13px] leading-[20px] text-on-error-container" role="alert">
            Could not load users.
          </p>
          <button
            type="button"
            onClick={loadUsers}
            className="rounded-pill border border-outline-variant bg-surface-container-lowest px-5 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors active:bg-surface-container"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loadState === 'ready' ? (
        <div className="flex flex-col gap-6">
          {error ? (
            <p className="font-body text-[13px] leading-[20px] text-error" role="alert">
              {error}
            </p>
          ) : null}

          {groups.map((group) => (
            <section key={group.role}>
              <h2 className="mb-2 px-1 font-body text-[12px] font-bold uppercase leading-4 tracking-label-caps text-on-surface-variant">
                {group.label} ({group.members.length})
              </h2>
              <div className="flex flex-col gap-2">
                {group.members.map((user) => {
                  const isCurrent = currentUser?.emailAddress === user.emailAddress;
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => switchTo(user)}
                      disabled={Boolean(switchingEmail)}
                      className={[
                        'flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors active:scale-[0.98] disabled:opacity-60',
                        isCurrent
                          ? 'border-olive-accent bg-olive-accent/10'
                          : 'border-outline-variant bg-surface-container-lowest active:bg-surface-container',
                      ].join(' ')}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-display text-[16px] font-bold leading-tight text-on-surface">
                          {user.fullName || user.emailAddress}
                        </span>
                        <span className="block truncate font-body text-[12px] leading-[18px] text-on-surface-variant">
                          {user.emailAddress}
                        </span>
                      </span>
                      {switchingEmail === user.emailAddress ? (
                        <span
                          aria-hidden="true"
                          className="h-5 w-5 shrink-0 animate-spin rounded-pill border-2 border-olive-accent/40 border-t-olive-accent"
                        />
                      ) : (
                        <span
                          className={[
                            'shrink-0 rounded-pill px-2.5 py-0.5 font-body text-[10px] font-bold uppercase leading-4 tracking-label-caps',
                            isCurrent
                              ? 'bg-olive-accent text-on-tertiary'
                              : 'border border-olive-accent text-olive-accent',
                          ].join(' ')}
                        >
                          {isCurrent ? 'current' : 'switch'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {currentUser ? (
            <button
              type="button"
              onClick={signOut}
              className="flex h-[48px] w-full items-center justify-center gap-2 rounded-pill border border-outline-variant bg-surface-container-lowest font-body text-[14px] font-semibold text-on-surface transition-colors active:bg-surface-container"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                logout
              </span>
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default DevSwitchUserScreen;
