// ProfileCompletionScreen.jsx
// Route: /profile-completion — the mandatory first-run form, on the dedal design
// system. Collects identity, academic and consent details and saves them
// (PATCH /users/me). Colleges come from GET /colleges. There is no back button
// and browser back is blocked — this screen must be completed; the "Not you?
// Sign out" link in the header is the only exit.
//
// THIS PASS CHANGED THE PRESENTATION AND NOTHING ELSE. Specifically untouched,
// because it is the phase-1 consent contract and it is correct:
//
//   • WHAT IS COLLECTED. The same fields, the same optionality, the same
//     server payload in handleSubmit — including termsPolicyVersionId and
//     privacyPolicyVersionId, which are what let the server refuse a tick made
//     against superseded text.
//   • loadPolicies() and the ready/loading/error gate. The checkboxes stay
//     disabled until both documents have loaded, and a load failure clears any
//     tick already made: consenting to text we could not show is not consent.
//   • handleStalePolicy() and `stalePolicyKind`. On POLICY_VERSION_STALE both
//     ticks are cleared, both documents are refetched so the version labels show
//     what the NEXT tick will be recorded against, and every other field keeps
//     what the person typed. Ticking either box clears the notice.
//   • validateDateOfBirthInput and its invalid / future / tooOld messages.
//
// What did change: one centred 520px column instead of a stretched full-bleed
// page (no split — see profile-completion.css), tokens instead of the heritage
// palette, SVG marks instead of Material Symbols ligatures, and ONE list of
// required answers feeding the progress bar, the submit button's label and the
// missing-field line, so the three can no longer disagree.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import { checkProfessionalEmail } from '../../helpers/professional-email.js';
import InlineError from '../../components/inline-error/InlineError.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  POLICY_KINDS,
  fetchEffectivePolicy,
  isNetworkError,
  validateDateOfBirthInput,
} from '../../helpers/policy-documents.js';
import CollegeSelect from '../../components/college-select/CollegeSelect.jsx';
import DepartmentSelect from '../../components/department-select/DepartmentSelect.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { AlertIcon, DismissIcon } from '../../components/detail-icons/DetailIcons.jsx';
import {
  PROFILE_COPY,
  YEAR_OF_STUDY_OPTIONS,
  EDIT_PROFILE_COPY,
} from '../../brand/brand-copy.js';
import './profile-completion.css';

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu',
  'Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry',
];

/*
 * Copy set in sentence case here rather than read from PROFILE_COPY, whose
 * corresponding entries are ALL CAPS ("COMPLETE PROFILE", "FULL NAME") from the
 * retired Heritage register. brand-copy.js is not mine to edit in this pass, so
 * the substitutions are collected in one place to be folded back later. The
 * consent strings are NOT among them — those are legal copy and come from
 * PROFILE_COPY unaltered.
 */
const LOCAL_COPY = {
  title: 'Complete your profile',
  intro: 'A few details before you can register for events.',
  exit: 'Not you? Sign out',
  sectionIdentity: 'Personal details',
  sectionAddress: 'Address',
  sectionAcademic: 'College and course',
  sectionConsent: 'Consent',
  optional: 'optional',
  progressLabel: 'Required fields completed',
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  gender: 'Gender',
  phone: 'Phone number',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  state: 'State',
  city: 'City',
  pinCode: 'PIN code',
  college: 'College',
  usn: 'Registration number',
  course: 'Course',
  professionalEmail: 'Professional email',
  yearOfStudy: 'Year of study',
  submitReady: 'Complete profile',
  submitFieldsMissing: 'Fill all required fields',
  submitConsentMissing: 'Accept terms to continue',
  fieldsLeft: (count) => `${count} ${count === 1 ? 'field' : 'fields'} left`,
  dismiss: 'Dismiss',
};

/* Bounds for the date-of-birth input: today, and 130 years back. */
const TODAY_ISO_DATE = new Date().toISOString().slice(0, 10);
const EARLIEST_ISO_DATE = `${new Date().getUTCFullYear() - 130}-01-01`;
const DATE_OF_BIRTH_COPY = {
  invalid: PROFILE_COPY.dateOfBirthInvalid,
  future: PROFILE_COPY.dateOfBirthFuture,
  tooOld: PROFILE_COPY.dateOfBirthTooOld,
};

// A section masthead on the canvas; the card below carries the fields.
function SectionHeading({ children, note }) {
  return (
    <div className="dpc-section__head">
      <h2 className="dpc-section__title">{children}</h2>
      {note ? <span className="dpc-section__note">{note}</span> : null}
    </div>
  );
}

function FieldLabel({ children, required = false, optional = false, htmlFor }) {
  return (
    <label className="dpc-label" htmlFor={htmlFor}>
      {children}
      {required ? (
        <span className="dpc-label__required" aria-hidden="true">*</span>
      ) : null}
      {optional ? <span className="dpc-label__optional">{LOCAL_COPY.optional}</span> : null}
    </label>
  );
}

/*
 * A real checkbox with `appearance: none`, not a hidden input beside a drawn
 * square — see profile-completion.css. The `disabled` prop and the onChange
 * contract are unchanged from the version this replaces; only the drawing moved.
 */
function ConsentCheckbox({ id, checked, onChange, label, disabled = false }) {
  return (
    <label className={disabled ? 'dpc-consent dpc-consent--disabled' : 'dpc-consent'} htmlFor={id}>
      <input
        id={id}
        className="dpc-consent__box"
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="dpc-consent__text">{label}</span>
    </label>
  );
}

function ProfileCompletionScreen() {
  const navigate = useNavigate();
  const { currentUser, updateUser, authorizationState, signOut } = useAuthentication();

  /*
   * Who does not belong on this screen, decided in one place so the two rules
   * cannot race each other.
   *
   * Nothing is decided while authority is 'unknown': the staff-assignments call
   * is still in flight, and acting early would send an administrator to the feed
   * on the strength of a not-yet-known role.
   *
   * An administrator is never held here at all. This form collects USN, college
   * and department — participant fields an admin has no answer for — so an admin
   * whose profile is legitimately "incomplete" would otherwise be stuck on a form
   * they cannot meaningfully submit.
   *
   * An already-complete participant must not re-run the flow either: re-submitting
   * would re-collect consent and could overwrite existing data.
   */
  useEffect(() => {
    if (authorizationState === 'unknown') {
      return;
    }
    if (authorizationState === 'authorized') {
      navigate('/admin/overview', { replace: true });
      return;
    }
    if (currentUser?.isProfileComplete === true) {
      navigate('/', { replace: true });
    }
  }, [authorizationState, currentUser, navigate]);

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [personalState, setPersonalState] = useState('');
  const [personalCity, setPersonalCity] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [gender, setGender] = useState('');
  const [collegeId, setCollegeId] = useState('');
  const [usn, setUsn] = useState('');
  const [department, setDepartment] = useState('');
  const [professionalEmail, setProfessionalEmail] = useState('');
  // Blur, not keystroke — see the note in EditProfileScreen.
  const [professionalEmailError, setProfessionalEmailError] = useState('');

  function handleProfessionalEmailBlur() {
    const problem = checkProfessionalEmail(professionalEmail);
    setProfessionalEmailError(
      problem === 'personal'
        ? EDIT_PROFILE_COPY.professionalEmailPersonal
        : problem === 'invalid'
          ? EDIT_PROFILE_COPY.professionalEmailInvalid
          : '',
    );
  }
  const [yearOfStudy, setYearOfStudy] = useState('');
  const [academicState, setAcademicState] = useState('');
  const [academicCity, setAcademicCity] = useState('');
  // Never pre-ticked: consent must be an affirmative action.
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [hasAcceptedPrivacyPolicy, setHasAcceptedPrivacyPolicy] = useState(false);
  /*
   * Optional. Collected, not acted on: no age is derived or shown here, and
   * nothing in the form branches on it. Validated at the field (real date, not
   * in the future, not implausibly old) so a mistake is named where it was made.
   */
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dateOfBirthError, setDateOfBirthError] = useState('');
  /*
   * The versions of the two documents in effect right now, fetched when the
   * form loads. Each tick is sent with the version id it was made against, so
   * the server can refuse a tick against superseded text. Until both have
   * loaded the checkboxes are disabled and the form cannot be submitted:
   * consenting to text we could not show is not consent.
   */
  const [policyStatus, setPolicyStatus] = useState('loading');
  const [policyErrorIsNetwork, setPolicyErrorIsNetwork] = useState(false);
  const [policyByKind, setPolicyByKind] = useState({});
  /*
   * Set when the server refused the ticks because a document changed while the
   * form was open (POLICY_VERSION_STALE). Names the document that changed. An
   * expected outcome, shown as a prompt to re-read — not as a failure.
   */
  const [stalePolicyKind, setStalePolicyKind] = useState(null);
  const isOnline = useOnlineStatus();

  const [colleges, setColleges] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  // Show a toast at the top that auto-dismisses after 3 seconds.
  function showToast(message) {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 3000);
  }

  function handleDateOfBirthChange(changeEvent) {
    const nextValue = changeEvent.target.value;
    setDateOfBirth(nextValue);
    setDateOfBirthError(validateDateOfBirthInput(nextValue, DATE_OF_BIRTH_COPY).error);
  }

  // Load the currently effective version of each document the form asks about.
  async function loadPolicies() {
    setPolicyStatus('loading');
    try {
      const [terms, privacy] = await Promise.all([
        fetchEffectivePolicy(POLICY_KINDS.TERMS_OF_SERVICE),
        fetchEffectivePolicy(POLICY_KINDS.PRIVACY_POLICY),
      ]);
      if (!terms?.id || !privacy?.id) {
        throw new Error('policy without id');
      }
      setPolicyByKind({
        [POLICY_KINDS.TERMS_OF_SERVICE]: terms,
        [POLICY_KINDS.PRIVACY_POLICY]: privacy,
      });
      setPolicyStatus('ready');
    } catch (error) {
      setPolicyErrorIsNetwork(isNetworkError(error));
      setPolicyStatus('error');
      // A tick made before the failure is meaningless now; clear it.
      setHasAcceptedTerms(false);
      setHasAcceptedPrivacyPolicy(false);
    }
  }

  /*
   * The server declined the whole submission because one document's text
   * changed between load and submit. Neither tick was written, so BOTH are
   * cleared and BOTH documents are refetched — the labels beside the boxes
   * must show the versions the next tick will be made against. Every other
   * field keeps what the person typed.
   */
  async function handleStalePolicy(details) {
    setStalePolicyKind(details?.documentKind ?? null);
    setHasAcceptedTerms(false);
    setHasAcceptedPrivacyPolicy(false);
    await loadPolicies();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPolicies();
    // Once, on mount: retries go through the button in the consent section.
  }, []);

  // Load the verified colleges once.
  useEffect(() => {
    let isActive = true;
    async function loadColleges() {
      try {
        const payload = await apiClient.get('/colleges');
        const collegeList = payload?.colleges ?? payload ?? [];
        const verifiedColleges = collegeList.filter((college) => college.isVerified !== false);
        if (isActive) {
          setColleges(verifiedColleges);
        }
      } catch {
        if (isActive) {
          setColleges([]);
        }
      }
    }
    loadColleges();
    return () => {
      isActive = false;
    };
  }, []);

  // Mandatory screen: block browser back until the profile is submitted.
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    function handlePopState() {
      window.history.pushState(null, '', window.location.href);
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // A 10-digit phone, matching the rule EditProfile already enforces — so a
  // profile can no longer be completed with an invalid number.
  const isPhoneValid = /^\d{10}$/.test(phoneNumber.trim());
  const fullName = [firstName.trim(), middleName.trim(), lastName.trim()].filter(Boolean).join(' ');

  /*
   * ── THE ONE LIST ──
   *
   * WHAT ACTUALLY GATES SUBMISSION: the fields the server stores, and the two
   * consents. This array is the single source for all three things that used to
   * be maintained separately — the progress bar's numerator, the submit button's
   * enabled state and its label, and the missing-field line. Three lists is how
   * the toast came to name fields (address, PIN) that no longer gate submission
   * at all, and how the bar could read 7/7 beside a dead button.
   *
   * Address line 1, state, city and PIN are NOT here and are NOT in the request
   * handleSubmit builds — the server has no address fields — so requiring them
   * would be a gate with nothing behind it. They are still rendered, marked
   * optional, ready if the server ever stores them. NOTHING MAY BE ADDED TO THIS
   * ARRAY THAT handleSubmit DOES NOT SEND; that pairing is the whole contract.
   *
   * `isConsent` is what lets the disabled button pick its own text: fields are
   * checked first, so a person missing both a phone number and both ticks is told
   * about the phone number, which is the one they can act on without reading a
   * legal document.
   */
  const requiredAnswers = [
    { label: LOCAL_COPY.firstName, isMet: firstName.trim() !== '' },
    { label: LOCAL_COPY.lastName, isMet: lastName.trim() !== '' },
    {
      /* Named differently when present-but-wrong, so "phone number" does not sit
         in the missing list beside a box that visibly has a number in it. */
      label: phoneNumber.trim() === '' ? LOCAL_COPY.phone : 'A valid 10-digit phone number',
      isMet: isPhoneValid,
    },
    { label: LOCAL_COPY.college, isMet: collegeId !== '' },
    {
      /* The server requires >= 5 characters; catching it here names the field
         instead of the generic "one or more fields are invalid" a 400 produces. */
      label: usn.trim() === '' ? LOCAL_COPY.usn : 'A registration number of at least 5 characters',
      isMet: usn.trim().length >= 5,
    },
    { label: PROFILE_COPY.consentTerms, isMet: hasAcceptedTerms, isConsent: true },
    { label: PROFILE_COPY.consentPrivacy, isMet: hasAcceptedPrivacyPolicy, isConsent: true },
  ];

  const completedCount = requiredAnswers.filter((answer) => answer.isMet).length;
  const progressPercent = Math.round((completedCount / requiredAnswers.length) * 100);
  const hasUnmetField = requiredAnswers.some((answer) => !answer.isConsent && !answer.isMet);
  const hasUnmetConsent =
    requiredAnswers.some((answer) => answer.isConsent && !answer.isMet) || policyStatus !== 'ready';
  const isValid = !hasUnmetField && !hasUnmetConsent;

  const missingFields = [
    ...(policyStatus !== 'ready' ? [PROFILE_COPY.consentUnavailableField] : []),
    ...requiredAnswers.filter((answer) => !answer.isMet).map((answer) => answer.label),
  ];

  // Fields first, then consent — see the note on the array above.
  const submitLabel = isValid
    ? LOCAL_COPY.submitReady
    : hasUnmetField
      ? LOCAL_COPY.submitFieldsMissing
      : LOCAL_COPY.submitConsentMissing;

  // When the person taps a button that is not ready yet, say why.
  function handleIncompleteClick() {
    if (missingFields.length > 0) {
      showToast(`Still needed: ${missingFields.join(', ')}`);
    }
  }

  async function handleSubmit() {
    if (!isValid || isSubmitting) return;
    // Optional, but not saveable while wrong.
    if (checkProfessionalEmail(professionalEmail)) {
      handleProfessionalEmailBlur();
      return;
    }
    const dateOfBirthCheck = validateDateOfBirthInput(dateOfBirth, DATE_OF_BIRTH_COPY);
    if (dateOfBirthCheck.error) {
      setDateOfBirthError(dateOfBirthCheck.error);
      return;
    }
    setSubmitError('');
    setIsSubmitting(true);
    try {
      const savedProfile = await apiClient.patch('/users/me', {
        fullName,
        phoneNumber: phoneNumber.trim(),
        collegeId,
        usn: usn.trim().toUpperCase(),
        department: department || undefined,
        professionalEmail: professionalEmail.trim() || null,
        yearOfStudy: yearOfStudy ? Number(yearOfStudy) : undefined,
        // Absent when not given: the server treats undefined as "leave as is".
        dateOfBirth: dateOfBirthCheck.value ?? undefined,
        hasAcceptedTerms,
        hasAcceptedPrivacyPolicy,
        /*
         * The exact version each tick was made against. The server records
         * consent against the version in effect at the moment of the write;
         * sending the ids the form displayed lets it refuse a tick made against
         * text that was superseded between load and submit.
         */
        termsPolicyVersionId: policyByKind[POLICY_KINDS.TERMS_OF_SERVICE]?.id,
        privacyPolicyVersionId: policyByKind[POLICY_KINDS.PRIVACY_POLICY]?.id,
      });
      updateUser(savedProfile.user ?? savedProfile);
      navigate('/', { replace: true });
    } catch (patchError) {
      if (patchError?.code === 'POLICY_VERSION_STALE') {
        // Not an error: the text moved. Ask for a re-read, keep everything else.
        await handleStalePolicy(patchError.details);
        return;
      }
      /* The 400 carries per-field details; naming them turns "one or more
       * fields are invalid" into something the person can actually act on. */
      const fieldDetails = patchError?.details && Object.keys(patchError.details).length
        ? Object.entries(patchError.details)
            .map(([field, problem]) => `${field} ${problem}`)
            .join(', ')
        : null;
      setSubmitError(fieldDetails ?? patchError.message ?? PROFILE_COPY.submitFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="dpc-screen">
      {/*
        Sticky header — the title, THE ONE EXIT, and the progress bar.

        The sign-out link is not decoration. Browser back is deliberately blocked
        on this screen (see the popstate effect), so it is the only way off the
        page: without it, anyone who cannot finish the form — wrong account, a
        college not on the list, a number they cannot receive — is trapped here
        with no route forward and no route out.

        The bar is in the header rather than at the top of the form because a
        progress indicator that scrolls away is one nobody sees move.
      */}
      <header className="dpc-header">
        <div className="dpc-header__inner">
          <div className="dpc-header__row">
            <h1 className="dpc-title">{LOCAL_COPY.title}</h1>
            <button type="button" className="dpc-exit" onClick={signOut}>
              {LOCAL_COPY.exit}
            </button>
          </div>
          <p className="dpc-intro">{LOCAL_COPY.intro}</p>

          <div className="dpc-progress">
            <div
              className="dpc-progress__track"
              role="progressbar"
              aria-valuenow={completedCount}
              aria-valuemin={0}
              aria-valuemax={requiredAnswers.length}
              aria-label={LOCAL_COPY.progressLabel}
            >
              <div className="dpc-progress__fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="dpc-progress__count">
              {completedCount}/{requiredAnswers.length}
            </span>
          </div>
        </div>
      </header>

      <main className="dpc-main">
        {/* ── PERSONAL DETAILS ── */}
        <section className="dpc-section">
          <SectionHeading>{LOCAL_COPY.sectionIdentity}</SectionHeading>

          <div className="dpc-card">
            <div className="dpc-field">
              <FieldLabel htmlFor="profile-first-name" required>{LOCAL_COPY.firstName}</FieldLabel>
              <input id="profile-first-name" className="dpc-input" type="text" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Your first name" />
            </div>

            <div className="dpc-field">
              <FieldLabel htmlFor="profile-middle-name" optional>{LOCAL_COPY.middleName}</FieldLabel>
              <input id="profile-middle-name" className="dpc-input" type="text" autoComplete="additional-name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="Your middle name" />
            </div>

            <div className="dpc-field">
              <FieldLabel htmlFor="profile-last-name" required>{LOCAL_COPY.lastName}</FieldLabel>
              <input id="profile-last-name" className="dpc-input" type="text" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Your last name" />
            </div>

            <div className="dpc-field">
              <FieldLabel htmlFor="profile-gender" optional>{LOCAL_COPY.gender}</FieldLabel>
              <select id="profile-gender" className="dpc-input dpc-input--select" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>

            {/* type="tel" + inputMode="tel" raises the phone keypad; the value is
                still validated as ten digits before it can gate submission. */}
            <div className="dpc-field">
              <FieldLabel htmlFor="profile-phone" required>{LOCAL_COPY.phone}</FieldLabel>
              <input
                id="profile-phone"
                className="dpc-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder={PROFILE_COPY.phonePlaceholder}
                aria-describedby="profile-phone-help"
              />
              <p className="dpc-help" id="profile-phone-help">{PROFILE_COPY.phoneHelper}</p>
            </div>
          </div>
        </section>

        {/*
          ── ADDRESS ──
          Every field here is optional, which is exactly why it is its own card: a
          section a participant can skip wholesale is easier to skip when it is one
          card rather than five fields buried among required ones.
        */}
        <section className="dpc-section">
          <SectionHeading note={LOCAL_COPY.optional}>{LOCAL_COPY.sectionAddress}</SectionHeading>

          <div className="dpc-card">
            <div className="dpc-field">
              <FieldLabel htmlFor="profile-address1" optional>{LOCAL_COPY.addressLine1}</FieldLabel>
              <input id="profile-address1" className="dpc-input" type="text" autoComplete="address-line1" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="House or flat number and building" />
            </div>

            <div className="dpc-field">
              <FieldLabel htmlFor="profile-address2" optional>{LOCAL_COPY.addressLine2}</FieldLabel>
              <input id="profile-address2" className="dpc-input" type="text" autoComplete="address-line2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} placeholder="Street and locality" />
            </div>

            <div className="dpc-row">
              <div className="dpc-field">
                <FieldLabel htmlFor="profile-state" optional>{LOCAL_COPY.state}</FieldLabel>
                <select id="profile-state" className="dpc-input dpc-input--select" value={personalState} onChange={(e) => setPersonalState(e.target.value)}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((stateName) => <option key={stateName} value={stateName}>{stateName}</option>)}
                </select>
              </div>
              <div className="dpc-field">
                <FieldLabel htmlFor="profile-city" optional>{LOCAL_COPY.city}</FieldLabel>
                <input id="profile-city" className="dpc-input" type="text" value={personalCity} onChange={(e) => setPersonalCity(e.target.value)} placeholder="City" />
              </div>
            </div>

            <div className="dpc-field">
              <FieldLabel htmlFor="profile-pin" optional>{LOCAL_COPY.pinCode}</FieldLabel>
              <input id="profile-pin" className="dpc-input" type="text" inputMode="numeric" maxLength={6} value={pinCode} onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit PIN" />
            </div>
          </div>
        </section>

        {/* ── COLLEGE AND COURSE ── */}
        <section className="dpc-section">
          <SectionHeading>{LOCAL_COPY.sectionAcademic}</SectionHeading>

          <div className="dpc-card">
            {/* CollegeSelect and DepartmentSelect are shared components with
                their own styling, owned elsewhere. The screen reserves the row
                and sets nothing inside it. */}
            <div className="dpc-field">
              <FieldLabel required>{LOCAL_COPY.college}</FieldLabel>
              <div className="dpc-embed">
                <CollegeSelect
                  colleges={colleges}
                  selectedCollegeId={collegeId}
                  onSelect={setCollegeId}
                  placeholder={PROFILE_COPY.collegePlaceholder}
                />
              </div>
            </div>

            <div className="dpc-field">
              <FieldLabel htmlFor="profile-usn" required>{LOCAL_COPY.usn}</FieldLabel>
              <input id="profile-usn" className="dpc-input" type="text" autoComplete="off" value={usn} onChange={(e) => setUsn(e.target.value.toUpperCase())} placeholder={PROFILE_COPY.usnPlaceholder} />
            </div>

            {/* Labelled "Course", not "Department": what is being asked for is
                the programme the student is enrolled on. The state, the API
                field and the shared picker stay `department` — that is the
                server's field name, and renaming a wire format to match a label
                is how the two drift apart. */}
            <div className="dpc-field">
              <FieldLabel optional>{LOCAL_COPY.course}</FieldLabel>
              <div className="dpc-embed">
                <DepartmentSelect value={department} onChange={setDepartment} />
              </div>
            </div>

            {/* Date of birth — optional, validated at the field. */}
            <div className="dpc-field">
              <FieldLabel htmlFor="profile-date-of-birth" optional>
                {PROFILE_COPY.dateOfBirthLabel}
              </FieldLabel>
              <input
                id="profile-date-of-birth"
                className="dpc-input"
                type="date"
                value={dateOfBirth}
                onChange={handleDateOfBirthChange}
                max={TODAY_ISO_DATE}
                min={EARLIEST_ISO_DATE}
                autoComplete="bday"
                aria-invalid={dateOfBirthError ? 'true' : undefined}
                aria-describedby="profile-date-of-birth-note"
              />
              {dateOfBirthError ? (
                <p className="dpc-fielderror" id="profile-date-of-birth-note" role="alert">
                  <AlertIcon size="sm" />
                  {dateOfBirthError}
                </p>
              ) : (
                <p className="dpc-help" id="profile-date-of-birth-note">
                  {PROFILE_COPY.dateOfBirthHelper}
                </p>
              )}
            </div>

            {/* Professional email — optional, same rule as Edit Profile. */}
            <div className="dpc-field">
              <FieldLabel htmlFor="profile-professional-email" optional>
                {LOCAL_COPY.professionalEmail}
              </FieldLabel>
              <input
                id="profile-professional-email"
                className="dpc-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck="false"
                value={professionalEmail}
                onChange={(changeEvent) => setProfessionalEmail(changeEvent.target.value)}
                onBlur={handleProfessionalEmailBlur}
                placeholder={EDIT_PROFILE_COPY.professionalEmailPlaceholder}
                aria-invalid={professionalEmailError ? 'true' : undefined}
                aria-describedby="profile-professional-email-note"
              />
              {professionalEmailError ? (
                <p className="dpc-fielderror" id="profile-professional-email-note" role="alert">
                  <AlertIcon size="sm" />
                  {professionalEmailError}
                </p>
              ) : (
                <p className="dpc-help" id="profile-professional-email-note">
                  {EDIT_PROFILE_COPY.professionalEmailHelper}
                </p>
              )}
            </div>

            <div className="dpc-field">
              <FieldLabel htmlFor="profile-year" optional>{LOCAL_COPY.yearOfStudy}</FieldLabel>
              <select id="profile-year" className="dpc-input dpc-input--select" value={yearOfStudy} onChange={(e) => setYearOfStudy(e.target.value)}>
                <option value="">Select year of study</option>
                {/* From the shared list, not a second hardcoded 1..6: the server
                    caps yearOfStudy at 6, and two copies of that range drift the
                    moment one of them is edited. */}
                {YEAR_OF_STUDY_OPTIONS.map((year) => (
                  <option key={year} value={year}>
                    {year === 1 ? '1st' : year === 2 ? '2nd' : year === 3 ? '3rd' : `${year}th`} year
                  </option>
                ))}
              </select>
            </div>

            <div className="dpc-row">
              <div className="dpc-field">
                <FieldLabel htmlFor="profile-academic-state" optional>{LOCAL_COPY.state}</FieldLabel>
                <select id="profile-academic-state" className="dpc-input dpc-input--select" value={academicState} onChange={(e) => setAcademicState(e.target.value)}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((stateName) => <option key={stateName} value={stateName}>{stateName}</option>)}
                </select>
              </div>
              <div className="dpc-field">
                <FieldLabel htmlFor="profile-academic-city" optional>{LOCAL_COPY.city}</FieldLabel>
                <input id="profile-academic-city" className="dpc-input" type="text" value={academicCity} onChange={(e) => setAcademicCity(e.target.value)} placeholder="City" />
              </div>
            </div>
          </div>
        </section>

        {/* ── CONSENT ── */}
        <section className="dpc-section">
          <SectionHeading>{LOCAL_COPY.sectionConsent}</SectionHeading>

          <div className="dpc-card">
            {/* The documents must be loaded before anyone can agree to them.
                While loading the boxes are disabled; on failure they stay
                disabled and the section says so, with a retry. */}
            {policyStatus === 'loading' ? (
              <p className="dpc-status" role="status">{PROFILE_COPY.consentLoading}</p>
            ) : null}

            {stalePolicyKind && policyStatus === 'ready' ? (
              <div role="status" className="dpc-stale">
                <div className="dpc-stale__body">
                  <p className="dpc-stale__title">
                    {PROFILE_COPY.consentStaleTitle(
                      stalePolicyKind === POLICY_KINDS.PRIVACY_POLICY
                        ? PROFILE_COPY.consentPrivacy
                        : PROFILE_COPY.consentTerms,
                    )}
                  </p>
                  <p className="dpc-stale__note">{PROFILE_COPY.consentStaleBody}</p>
                </div>
                <button
                  type="button"
                  className="dpc-stale__dismiss"
                  onClick={() => setStalePolicyKind(null)}
                >
                  {PROFILE_COPY.consentStaleDismiss}
                </button>
              </div>
            ) : null}

            {policyStatus === 'error' ? (
              <InlineError
                message={
                  !isOnline || policyErrorIsNetwork
                    ? PROFILE_COPY.consentLoadFailedOffline
                    : PROFILE_COPY.consentLoadFailed
                }
                onRetry={loadPolicies}
              />
            ) : null}

            <ConsentCheckbox
              id="profile-consent-terms"
              checked={hasAcceptedTerms}
              disabled={policyStatus !== 'ready'}
              onChange={(changeEvent) => {
                setHasAcceptedTerms(changeEvent.target.checked);
                if (changeEvent.target.checked) setStalePolicyKind(null);
              }}
              label={
                <>
                  {PROFILE_COPY.consentTermsPrefix}{' '}
                  {/* A real link, opened in a new tab, rather than a button that
                      calls window.open: this is a document, so it must be
                      middle-clickable, copyable and reachable with JS blocked. */}
                  <a
                    className="dpc-consent__link"
                    href="/terms-of-service"
                    target="_blank"
                    rel="noopener"
                    onClick={(clickEvent) => clickEvent.stopPropagation()}
                  >
                    {PROFILE_COPY.consentTerms}
                  </a>
                  <span className="dpc-label__required" aria-hidden="true"> *</span>
                  {policyByKind[POLICY_KINDS.TERMS_OF_SERVICE] ? (
                    <span className="dpc-consent__version">
                      {PROFILE_COPY.consentVersion(
                        policyByKind[POLICY_KINDS.TERMS_OF_SERVICE].versionLabel,
                      )}
                    </span>
                  ) : null}
                </>
              }
            />

            <ConsentCheckbox
              id="profile-consent-privacy"
              checked={hasAcceptedPrivacyPolicy}
              disabled={policyStatus !== 'ready'}
              onChange={(changeEvent) => {
                setHasAcceptedPrivacyPolicy(changeEvent.target.checked);
                if (changeEvent.target.checked) setStalePolicyKind(null);
              }}
              label={
                <>
                  {PROFILE_COPY.consentPrivacyPrefix}{' '}
                  <a
                    className="dpc-consent__link"
                    href="/privacy-policy"
                    target="_blank"
                    rel="noopener"
                    onClick={(clickEvent) => clickEvent.stopPropagation()}
                  >
                    {PROFILE_COPY.consentPrivacy}
                  </a>
                  <span className="dpc-label__required" aria-hidden="true"> *</span>
                  {policyByKind[POLICY_KINDS.PRIVACY_POLICY] ? (
                    <span className="dpc-consent__version">
                      {PROFILE_COPY.consentVersion(
                        policyByKind[POLICY_KINDS.PRIVACY_POLICY].versionLabel,
                      )}
                    </span>
                  ) : null}
                </>
              }
            />

            <p className="dpc-note">{PROFILE_COPY.consentNote}</p>
          </div>
        </section>
      </main>

      {toastMessage ? (
        <div role="alert" className="dpc-toast">
          <AlertIcon size="sm" className="dpc-toast__icon" />
          <p className="dpc-toast__text">{toastMessage}</p>
          <button
            type="button"
            className="dpc-toast__dismiss"
            onClick={() => setToastMessage('')}
            aria-label={LOCAL_COPY.dismiss}
          >
            <DismissIcon size="sm" />
          </button>
        </div>
      ) : null}

      {/* Sticky footer — the one call to action. */}
      <footer className="dpc-footer">
        <div className="dpc-footer__inner">
          {!isValid && missingFields.length > 0 ? (
            <p className="dpc-missing">
              <span className="dpc-missing__count">
                {LOCAL_COPY.fieldsLeft(missingFields.length)}
              </span>
              {': '}
              {missingFields.join(', ')}
            </p>
          ) : null}

          {submitError ? (
            <p className="dpc-submiterror" role="alert">
              <AlertIcon size="sm" />
              {submitError}
            </p>
          ) : null}

          {/*
            aria-disabled rather than disabled while the form is incomplete: a
            disabled button is unfocusable, so a keyboard user tabbing to the end
            of the form finds nothing there and no explanation. It stays
            reachable, and pressing it raises the toast that names what is left.
            It IS genuinely disabled while submitting, which is the one state
            where a second press would do harm.
          */}
          <button
            type="button"
            className="dpc-submit"
            onClick={isValid ? handleSubmit : handleIncompleteClick}
            disabled={isSubmitting}
            aria-disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? <span className="dpc-spin" aria-hidden="true" /> : null}
            {submitLabel}
          </button>
        </div>
      </footer>
    </div>
  );
}

export default ProfileCompletionScreen;
