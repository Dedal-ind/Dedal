// SettingsScreen.jsx
// Route: /settings — the participant's settings and profile hub, rebuilt on the
// dedal design system.
//
// WHAT CHANGED, AND WHY.
//
// IT IS ROWS, NOT CARDS. The screen it replaces was five identical rounded
// containers stacked down the page, each with a border, a shadow and 16px of
// padding, to group between two and four items. That is a lot of drawing to say
// something a line of type already says, and by the fifth container the reader
// has stopped seeing them. Now: a label, a run of rows, hairlines between them.
//
// EDITING YOUR PROFILE IS AN EXPAND, NOT A DESTINATION. The form is right under
// the avatar, on the screen you were already on, in the component /profile/edit
// also renders (ProfileFieldSet). The route still works — see that file's
// header for why the fields live in exactly one place.
//
// THE NATIVE DIALOGS ARE GONE. Signing out and deleting an account used to be
// window.confirm(), and a failed deletion used to be window.alert(). Neither can
// be styled, both are drawn by the browser rather than by the app — so on a
// phone they appear pinned to the address bar with the hostname above them —
// and the app already has one confirmation pattern (BottomSheet) that every
// other decision goes through. These two now go through it as well.
//
// SIGN OUT IS A ROW. A filled button is how a screen says "this is the thing to
// do here", and signing out is not the thing to do on a settings screen.
// DELETING YOUR ACCOUNT is at the very bottom in --muted, below a rule, because
// the signature red belongs on the confirmation — describing what is about to
// happen — rather than on the control, advertising it.
//
// Endpoints: GET /users/me/consents (through useConsentStanding — append-only
// records, per document, with the version accepted and whether it is current),
// PATCH /users/me, POST /uploads/student-id (the existing multipart upload path,
// reused for the avatar), DELETE /users/me.
//
// There is still no backend preference storage, so every toggle below the push
// flag is a localStorage flag. That is unchanged and still a TODO.

import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import BottomSheet from '../../components/bottom-sheet/BottomSheet.jsx';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import {
  AvatarEditIcon,
  ChevronIcon,
  ExpandIcon,
  SignOutIcon,
  AlertIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { useConsentStanding } from '../../hooks/use-consent-standing/use-consent-standing.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { POLICY_KINDS, policyVersionPath } from '../../helpers/policy-documents.js';
import { BRAND_IDENTITY } from '../../brand/brand-identity.js';
import { SETTINGS_COPY } from '../../brand/brand-copy.js';
import ProfileFieldSet from '../edit-profile/ProfileFieldSet.jsx';
import './settings.css';

/*
 * Copy, in sentence case, held here.
 *
 * SETTINGS_COPY still speaks in the retired Heritage register — "SETTINGS",
 * "Log Out", the ALL-CAPS toggle words — and it is imported by the admin
 * settings screen, which this pass must not touch. Rewriting the shared
 * constant would restyle that screen's labels as a side effect, so the
 * participant strings live with the participant screen. The consent lines are
 * the exception and are still read from SETTINGS_COPY below, because the same
 * sentences are shown by the admin profile screen and the two must not drift.
 */
const COPY = {
  title: 'Settings',
  editProfile: 'Edit profile',
  editProfileClose: 'Close the profile editor',
  account: 'Account',
  email: 'Email address',
  participantId: 'Participant ID',
  notifications: 'Notifications',
  push: 'Push notifications',
  emailUpdates: 'Email updates',
  reminders: 'Event reminders',
  liveScores: 'Live scores',
  preferences: 'Preferences',
  language: 'Language',
  languageValue: 'English',
  darkMode: 'Dark mode',
  wifiOnly: 'Download over Wi-Fi only',
  legal: 'Legal',
  terms: 'Terms of service',
  privacy: 'Privacy policy',
  consentRecord: 'What you have accepted',
  about: 'About',
  version: 'Version',
  versionValue: '1.0.0',
  builtBy: 'Built by',
  builtByValue: 'Dedal',
  signOut: 'Sign out',
  signOutTitle: 'Sign out of Dedal?',
  signOutNote: 'You can sign back in with your email whenever you want.',
  cancel: 'Cancel',
  deleteAccount: 'Delete account',
  deleteTitle: 'Delete your account?',
  deleteNote:
    'Your registrations, passes and certificates go with it. This cannot be undone, and support cannot bring it back.',
  deleteConfirm: 'Delete permanently',
  deleteFailed: 'Your account could not be deleted. Try again, or contact support if it keeps failing.',
  avatarChange: 'Change your picture',
  avatarAdd: 'Add a picture',
  avatarUploading: 'Uploading your picture…',
  avatarFailed: 'That picture could not be uploaded. Try another one.',
  avatarWrongType: 'Only JPEG and PNG images are accepted.',
  avatarTooLarge: 'That file is over 5 MB. Choose a smaller image.',
  consentUpdated: 'Updated version available',
  consentView: 'Read the version you accepted',
  consentLoading: 'Loading what you have accepted',
  retry: 'Try again',
};

/*
 * The consent sentences ARE read from the shared constant, unlike everything
 * else above. The admin profile screen renders the same standing from the same
 * hook, and "Accepted version 3 on 4 Sep 2026" appearing two different ways in
 * one product is a legal-copy problem rather than a styling one. These are
 * already sentence case, so there is nothing to correct.
 */
const CONSENT_COPY = {
  termsName: SETTINGS_COPY.consentTermsName,
  privacyName: SETTINGS_COPY.consentPrivacyName,
  consentAcceptedOn: SETTINGS_COPY.consentAcceptedOn,
  consentWithdrawnOn: SETTINGS_COPY.consentWithdrawnOn,
  consentNone: SETTINGS_COPY.consentNone,
  offline: SETTINGS_COPY.consentOffline,
  loadFailed: SETTINGS_COPY.consentLoadFailed,
};

// TODO: persist these server-side once user notification-preference fields exist.
const NOTIFICATIONS_STORAGE_KEY = 'festpass.notificationsEnabled';
const PREFERENCE_STORAGE_KEYS = {
  emailUpdates: 'festpass.pref.emailUpdates',
  eventReminders: 'festpass.pref.eventReminders',
  liveScores: 'festpass.pref.liveScores',
  darkMode: 'festpass.pref.darkMode',
  wifiOnly: 'festpass.pref.wifiOnly',
};

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png'];

function readFlag(storageKey, defaultOn) {
  return (window.localStorage.getItem(storageKey) ?? (defaultOn ? 'on' : 'off')) === 'on';
}

function initialsOf(fullName) {
  return (
    (fullName || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  );
}

function formatConsentDate(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/* A row that goes somewhere or opens something. */
function ActionRow({ label, value, onClick, children }) {
  return (
    <li>
      <button type="button" className="dst-row dst-row--action" onClick={onClick}>
        <span className="dst-row__label">{label}</span>
        {value ? <span className="dst-row__value">{value}</span> : null}
        {children ?? (
          <span className="dst-row__chev">
            <ChevronIcon />
          </span>
        )}
      </button>
    </li>
  );
}

/* A row that only states a fact. Not a button, so a keyboard user does not tab
   through four controls that do nothing on the way to one that does. */
function FactRow({ label, value }) {
  return (
    <li>
      <div className="dst-row">
        <span className="dst-row__label">{label}</span>
        <span className="dst-row__value">{value}</span>
      </div>
    </li>
  );
}

/*
 * A row whose control is a switch. The whole <label> is the row, so the target
 * is 52px tall rather than the 26px track, and the accessible name comes from
 * the text the person can see rather than from an aria-label that can drift
 * away from it.
 */
function SwitchRow({ label, isOn, onToggle }) {
  const inputId = useId();
  return (
    <li>
      <label className="dst-row dst-row--switch" htmlFor={inputId}>
        <span className="dst-row__label">{label}</span>
        <input
          id={inputId}
          className="dst-switch"
          type="checkbox"
          role="switch"
          checked={isOn}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </label>
    </li>
  );
}

/*
 * ONE DOCUMENT'S STANDING.
 *
 * THIS INFORMS. IT DOES NOT RE-PROMPT — that was the previous screen's stated
 * intent and it is correct, so it is preserved exactly: there is no withdrawal
 * control here, no tick, and the wording for a superseded acceptance is
 * neutral. The consent records are append-only; what a settings screen owes the
 * reader is a receipt, not another form.
 *
 * The endpoint returns, per kind: { status, policyVersionId, versionLabel,
 * contentHash, consentedAt, effectiveVersionId, isCurrentVersion }. `status` is
 * 'none' before anything has been accepted, in which case there is no version
 * and no date and the row says so rather than rendering em-dashes.
 */
function ConsentRow({ name, entry, copy }) {
  const date = formatConsentDate(entry?.consentedAt);
  const isAccepted = entry?.status === 'accepted';
  const isWithdrawn = entry?.status === 'withdrawn';

  let meta = copy.consentNone;
  if (isAccepted) {
    meta = copy.consentAcceptedOn(entry.versionLabel ?? '—', date ?? '—');
  } else if (isWithdrawn) {
    meta = copy.consentWithdrawnOn(date ?? '—');
  }

  return (
    <div>
      <p className="dst-consent__name">{name}</p>
      <p className="dst-consent__meta">{meta}</p>
      {isAccepted && !entry.isCurrentVersion ? (
        /* Neutral wording, and it is a statement rather than a call to act.
           See settings.css for why this is 14px bold and not 11px. */
        <p className="dst-consent__flag">
          <AlertIcon size="sm" />
          {COPY.consentUpdated}
        </p>
      ) : null}
      {isAccepted && entry.policyVersionId ? (
        /* A real link, to the exact text that was accepted — not a button that
           calls window.open, which cannot be opened in a new tab on purpose,
           cannot be copied, and is invisible to "open link in…". */
        <a
          className="dst-consent__link"
          href={policyVersionPath(entry.policyVersionId)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {COPY.consentView}
        </a>
      ) : null}
    </div>
  );
}

function SettingsScreen() {
  const navigate = useNavigate();
  const { currentUser, updateUser, signOut } = useAuthentication();
  const consent = useConsentStanding();
  const isOnline = useOnlineStatus();

  const [isEditing, setIsEditing] = useState(false);
  const [confirming, setConfirming] = useState(null); // null | 'sign-out' | 'delete'
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(() =>
    readFlag(NOTIFICATIONS_STORAGE_KEY, true),
  );
  const [preferenceFlags, setPreferenceFlags] = useState(() => ({
    emailUpdates: readFlag(PREFERENCE_STORAGE_KEYS.emailUpdates, true),
    eventReminders: readFlag(PREFERENCE_STORAGE_KEYS.eventReminders, true),
    liveScores: readFlag(PREFERENCE_STORAGE_KEYS.liveScores, false),
    darkMode: readFlag(PREFERENCE_STORAGE_KEYS.darkMode, false),
    wifiOnly: readFlag(PREFERENCE_STORAGE_KEYS.wifiOnly, false),
  }));

  function handleToggleNotifications(enabled) {
    setNotificationsEnabled(enabled);
    window.localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, enabled ? 'on' : 'off');
  }

  function handleTogglePreference(flagName, enabled) {
    setPreferenceFlags((previous) => ({ ...previous, [flagName]: enabled }));
    window.localStorage.setItem(PREFERENCE_STORAGE_KEYS[flagName], enabled ? 'on' : 'off');
    if (flagName === 'darkMode') {
      document.documentElement.classList.toggle('dark', enabled);
    }
  }

  // Keeps <html> in sync with the stored flag, and applies it on mount. The
  // toggle handler already applies it instantly, so this re-run is a no-op.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', preferenceFlags.darkMode);
  }, [preferenceFlags.darkMode]);

  // ── The avatar ────────────────────────────────────────────────────────────
  /*
   * There is one upload endpoint on this backend — POST /uploads/student-id,
   * multipart — and it returns a URL. The avatar goes through it and the URL is
   * then stored on the user with PATCH /users/me. The route's NAME is wrong for
   * this use and that is worth saying out loud: it is a general image upload
   * wearing a student-ID label, and if a second one is ever added this call
   * should move to it. What it is not worth is a second upload path invented on
   * the client for one field.
   *
   * PATCH /users/me validates the whole profile, so the current values go up
   * alongside the new picture — sending profilePictureUrl alone is rejected.
   */
  const fileInputRef = useRef(null);
  const [avatarState, setAvatarState] = useState('idle'); // 'idle' | 'busy' | 'error'
  const [avatarError, setAvatarError] = useState('');
  /* Set the moment a NEW url arrives, so only a freshly uploaded picture gets
     the fade — the one already on the account should just be there. */
  const [freshAvatarUrl, setFreshAvatarUrl] = useState(null);

  async function handleAvatarSelected(changeEvent) {
    const file = changeEvent.target.files?.[0];
    changeEvent.target.value = '';
    if (!file) return;
    if (!AVATAR_MIME_TYPES.includes(file.type)) {
      setAvatarState('error');
      setAvatarError(COPY.avatarWrongType);
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarState('error');
      setAvatarError(COPY.avatarTooLarge);
      return;
    }
    setAvatarState('busy');
    setAvatarError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploaded = await apiClient.post('/uploads/student-id', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = uploaded?.url ?? uploaded?.data?.url ?? '';
      if (!url) throw new Error('no url');
      const saved = await apiClient.patch('/users/me', {
        fullName: currentUser?.fullName ?? '',
        collegeId: currentUser?.collegeId?.id ?? currentUser?.collegeId ?? '',
        usn: currentUser?.usn ?? '',
        phoneNumber: currentUser?.phoneNumber ?? '',
        yearOfStudy: currentUser?.yearOfStudy ?? undefined,
        department: currentUser?.department ?? undefined,
        studentIdUrl: currentUser?.studentIdUrl ?? undefined,
        profilePictureUrl: url,
      });
      updateUser(saved.user ?? saved);
      setFreshAvatarUrl(url);
      setAvatarState('idle');
    } catch {
      setAvatarState('error');
      setAvatarError(COPY.avatarFailed);
    }
  }

  // ── The two confirmations ────────────────────────────────────────────────

  function runSignOut() {
    setConfirming(null);
    signOut();
    navigate('/', { replace: true });
  }

  async function runDeleteAccount() {
    setIsDeleting(true);
    setDeleteError('');
    try {
      await apiClient.delete('/users/me');
      setConfirming(null);
      signOut();
      navigate('/', { replace: true });
    } catch {
      /* The failure is reported INSIDE the sheet, where the person is looking
         and where the retry is. window.alert() put it in a browser dialog that
         dismissed the whole context to say "Failed to delete account." */
      setDeleteError(COPY.deleteFailed);
    } finally {
      setIsDeleting(false);
    }
  }

  const photoUrl = currentUser?.profilePictureUrl ?? '';
  const hasPhoto = photoUrl !== '';

  return (
    <div className="dst-screen">
      {/* The back affordance. /settings is reached from /profile, which is a tab
          root, so without this the only way out is the browser's own back. */}
      <ScreenHeader title={COPY.title} />

      <div className="dst-col dst-col--under-chrome">

        {/* Identity. The avatar is the control; the 80px circle is the target. */}
        <section className="dst-identity">
          <input
            ref={fileInputRef}
            className="dst-file"
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleAvatarSelected}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            className={avatarState === 'busy' ? 'dst-avatar dst-avatar--busy' : 'dst-avatar'}
            onClick={() => fileInputRef.current?.click()}
            aria-label={hasPhoto ? COPY.avatarChange : COPY.avatarAdd}
          >
            {hasPhoto ? (
              <img
                /* Keyed on the url so React replaces the element rather than
                   mutating src — a mutated src keeps the old decoded frame on
                   screen and the fade would have nothing to fade. */
                key={photoUrl}
                className={
                  photoUrl === freshAvatarUrl
                    ? 'dst-avatar__img dst-avatar__img--fresh'
                    : 'dst-avatar__img'
                }
                src={photoUrl}
                alt=""
              />
            ) : (
              <span className="dst-avatar__fallback" aria-hidden="true">
                {initialsOf(currentUser?.fullName)}
              </span>
            )}
            <span className="dst-avatar__mark" aria-hidden="true">
              <AvatarEditIcon size="sm" />
            </span>
          </button>

          <div>
            <h2 className="dst-name">{currentUser?.fullName ?? ''}</h2>
            <p className="dst-identity__line">{currentUser?.emailAddress ?? ''}</p>
          </div>

          {avatarState === 'busy' ? (
            <p className="dst-identity__line" role="status">
              {COPY.avatarUploading}
            </p>
          ) : null}
          {avatarState === 'error' ? (
            <p className="dst-identity__line dst-identity__line--error" role="alert">
              {avatarError}
            </p>
          ) : null}
        </section>

        {/* Account. "Edit profile" opens the form in place. */}
        <section className="dst-section">
          <p className="dst-section__label">{COPY.account}</p>
          <ul className="dst-rows">
            <li>
              <button
                type="button"
                className="dst-row dst-row--action"
                aria-expanded={isEditing}
                aria-controls="dst-edit-panel"
                onClick={() => setIsEditing((open) => !open)}
              >
                <span className="dst-row__label">{COPY.editProfile}</span>
                <span className={isEditing ? 'dst-row__chev dst-row__chev--open' : 'dst-row__chev'}>
                  <ExpandIcon />
                </span>
              </button>
              {/*
               * The expand is always in the DOM so the 0fr → 1fr transition has
               * something to animate, but the collapsed panel must not hold
               * focusable fields — Tab would walk into a form nobody can see.
               * `inert` removes the whole subtree from focus and from the
               * accessibility tree in one attribute.
               */}
              <div
                id="dst-edit-panel"
                className={isEditing ? 'dst-expand dst-expand--open' : 'dst-expand'}
              >
                <div className="dst-expand__inner" inert={!isEditing || undefined}>
                  <ProfileFieldSet
                    autoFocusFirstField={isEditing}
                    onSaved={() => setIsEditing(false)}
                  />
                </div>
              </div>
            </li>
            <FactRow label={COPY.email} value={currentUser?.emailAddress ?? '—'} />
            <FactRow label={COPY.participantId} value={currentUser?.participantId ?? '—'} />
          </ul>
        </section>

        <section className="dst-section">
          <p className="dst-section__label">{COPY.notifications}</p>
          <ul className="dst-rows">
            <SwitchRow
              label={COPY.push}
              isOn={notificationsEnabled}
              onToggle={handleToggleNotifications}
            />
            <SwitchRow
              label={COPY.emailUpdates}
              isOn={preferenceFlags.emailUpdates}
              onToggle={(next) => handleTogglePreference('emailUpdates', next)}
            />
            <SwitchRow
              label={COPY.reminders}
              isOn={preferenceFlags.eventReminders}
              onToggle={(next) => handleTogglePreference('eventReminders', next)}
            />
            <SwitchRow
              label={COPY.liveScores}
              isOn={preferenceFlags.liveScores}
              onToggle={(next) => handleTogglePreference('liveScores', next)}
            />
          </ul>
        </section>

        <section className="dst-section">
          <p className="dst-section__label">{COPY.preferences}</p>
          <ul className="dst-rows">
            <FactRow label={COPY.language} value={COPY.languageValue} />
            <SwitchRow
              label={COPY.darkMode}
              isOn={preferenceFlags.darkMode}
              onToggle={(next) => handleTogglePreference('darkMode', next)}
            />
            <SwitchRow
              label={COPY.wifiOnly}
              isOn={preferenceFlags.wifiOnly}
              onToggle={(next) => handleTogglePreference('wifiOnly', next)}
            />
          </ul>
        </section>

        {/* Legal, and the consent record. */}
        <section className="dst-section">
          <p className="dst-section__label">{COPY.legal}</p>
          <ul className="dst-rows">
            <ActionRow
              label={COPY.terms}
              onClick={() => window.open(BRAND_IDENTITY.termsUrl, '_blank', 'noopener')}
            />
            <ActionRow
              label={COPY.privacy}
              onClick={() => window.open(BRAND_IDENTITY.privacyUrl, '_blank', 'noopener')}
            />
            <li>
              <div className="dst-row">
                <span className="dst-row__label">{COPY.consentRecord}</span>
              </div>
              <div className="dst-consent">
                {consent.status === 'loading' ? (
                  <div role="status" aria-label={COPY.consentLoading}>
                    <div className="dst-skel" style={{ width: '70%' }} />
                  </div>
                ) : null}
                {consent.status === 'error' ? (
                  <div>
                    <p className="dst-notice" role="alert">
                      {!isOnline || consent.errorIsNetwork
                        ? CONSENT_COPY.offline
                        : CONSENT_COPY.loadFailed}
                    </p>
                    <button type="button" className="dst-retry" onClick={consent.reload}>
                      {COPY.retry}
                    </button>
                  </div>
                ) : null}
                {consent.status === 'ready'
                  ? [
                      [POLICY_KINDS.TERMS_OF_SERVICE, CONSENT_COPY.termsName],
                      [POLICY_KINDS.PRIVACY_POLICY, CONSENT_COPY.privacyName],
                    ].map(([kind, name]) => (
                      <ConsentRow
                        key={kind}
                        name={name}
                        entry={consent.standing?.[kind]}
                        copy={CONSENT_COPY}
                      />
                    ))
                  : null}
              </div>
            </li>
          </ul>
        </section>

        <section className="dst-section">
          <p className="dst-section__label">{COPY.about}</p>
          <ul className="dst-rows">
            <FactRow label={COPY.version} value={COPY.versionValue} />
            <FactRow label={COPY.builtBy} value={COPY.builtByValue} />
          </ul>
        </section>

        {/* Sign out is an action, not a fact about the app, so it does not
            belong under About next to the version number. It gets its own
            unlabelled group: a heading over a single row would be furniture. */}
        <section className="dst-section">
          <ul className="dst-rows">
            <ActionRow label={COPY.signOut} onClick={() => setConfirming('sign-out')}>
              <span className="dst-row__icon">
                <SignOutIcon />
              </span>
            </ActionRow>
          </ul>
        </section>

        <div className="dst-end">
          <button
            type="button"
            className="dst-danger"
            onClick={() => {
              setDeleteError('');
              setConfirming('delete');
            }}
          >
            {COPY.deleteAccount}
          </button>
        </div>
      </div>

      {/* The two confirmations. Both are the app's own sheet. */}
      <BottomSheet
        isOpen={confirming === 'sign-out'}
        onClose={() => setConfirming(null)}
        title={COPY.signOutTitle}
      >
        <div className="dst-confirm">
          <p className="dst-confirm__note">{COPY.signOutNote}</p>
          <div className="dst-confirm__actions">
            <button type="button" className="dst-confirm__cancel" onClick={() => setConfirming(null)}>
              {COPY.cancel}
            </button>
            <button type="button" className="dst-confirm__go" onClick={runSignOut}>
              {COPY.signOut}
            </button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet
        isOpen={confirming === 'delete'}
        onClose={() => setConfirming(null)}
        title={COPY.deleteTitle}
      >
        <div className="dst-confirm">
          <p className="dst-confirm__note">{COPY.deleteNote}</p>
          {deleteError ? (
            <p className="dst-notice dst-notice--refusal" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="dst-confirm__actions">
            <button type="button" className="dst-confirm__cancel" onClick={() => setConfirming(null)}>
              {COPY.cancel}
            </button>
            <button
              type="button"
              className="dst-confirm__go"
              aria-disabled={isDeleting}
              onClick={() => {
                if (!isDeleting) runDeleteAccount();
              }}
            >
              {isDeleting ? <span className="dst-spin" aria-hidden="true" /> : null}
              {COPY.deleteConfirm}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export default SettingsScreen;
