// RegisterCollegeScreen.jsx
// Route: /register-college — the public college application form on the dedal
// design system. Four collecting steps plus a review: (1) college info,
// (2) address, (3) point of contact, (4) documents & notes, then a summary
// before submit (POST /college-applications). No authentication. Client-side
// validation mirrors the backend contract; server VALIDATION_FAILED details are
// mapped back onto their fields, and the two 409s (pending application /
// already registered) render as a persistent banner carrying the server's own
// message.
//
// WHAT THIS REDESIGN CHANGED AND WHAT IT DID NOT. It changed the look: a filling
// progress bar instead of numbered circles and a "step 2 of 5" count, floating
// labels, a fixed action bar, a two-column review on wide screens. It changed
// NOTHING about what is collected, which field belongs to which step, what
// counts as valid, or which endpoints are called. Every payload key below is
// byte-for-byte the one the previous version sent.
//
// The three design fields the backend does not yet know (collegeEmail,
// collegeType, usnFormat) are still sent as payload keys — the validator's
// whitelist ignores unknowns, so this is forward-compatible — AND folded into
// notesFromApplicant, which is how the values actually reach a reviewer today.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import PublicWordmarkHeader from '../../components/public-wordmark-header/PublicWordmarkHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import {
  AlertIcon,
  CloseIcon,
  InfoIcon,
  UploadIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import {
  EMPTY_COLLEGE_ADDRESS,
  REQUIRED_COLLEGE_ADDRESS_FIELDS,
  INDIAN_PIN_CODE_PATTERN,
  toCollegeAddressPayload,
  formatCollegeAddressLines,
} from '../../helpers/college-address.js';
import {
  COLLEGE_ONBOARDING_COPY,
  COLLEGE_TYPE_OPTIONS,
  COLLEGE_TYPE_OTHER,
  EXPECTED_FEST_SIZE_OPTIONS,
  COLLEGE_STATE_OPTIONS,
} from '../../brand/brand-copy.js';
import {
  DcoField,
  DcoChoiceGroup,
  DcoReviewSection,
  DcoReviewRow,
} from './college-form-parts.jsx';

// Steps 0–3 collect; step 4 is review.
const REVIEW_STEP = 4;
const TOTAL_STEPS = REVIEW_STEP + 1;

const STEP_TITLES = [
  COLLEGE_ONBOARDING_COPY.dcoStepCollegeTitle,
  COLLEGE_ONBOARDING_COPY.dcoStepAddressTitle,
  COLLEGE_ONBOARDING_COPY.dcoStepContactTitle,
  COLLEGE_ONBOARDING_COPY.dcoStepDocumentsTitle,
  COLLEGE_ONBOARDING_COPY.dcoStepReviewTitle,
];

const STEP_SUBTITLES = [
  COLLEGE_ONBOARDING_COPY.dcoStepCollegeSubtitle,
  COLLEGE_ONBOARDING_COPY.dcoStepAddressSubtitle,
  COLLEGE_ONBOARDING_COPY.dcoStepContactSubtitle,
  COLLEGE_ONBOARDING_COPY.dcoStepDocumentsSubtitle,
  COLLEGE_ONBOARDING_COPY.dcoStepReviewSubtitle,
];

// Which form fields belong to which step, so a server validation error can jump
// the applicant back to the earliest step that still has a problem. UNCHANGED.
const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const STEP_FIELDS = [
  ['collegeName', 'collegeEmail', 'collegeType', 'usnFormat', 'collegeWebsite', 'expectedFestSize'],
  [
    // Server-side address complaints arrive dotted (address.pinCode).
    'address.addressLine1',
    'address.addressLine2',
    'address.townOrLocality',
    'address.city',
    'address.state',
    'address.pinCode',
    'address.country',
  ],
  ['applicantFullName', 'applicantEmail', 'applicantPhone', 'applicantRole'],
  ['notesFromApplicant'],
];

// How long a step takes to cross-slide. Must match the 200ms in
// college-onboarding.css: this timer is what unmounts the outgoing step, and if
// it fired early the animation would be cut off mid-slide.
const STEP_TRANSITION_MS = 200;

const INITIAL_FORM_VALUES = {
  collegeName: '',
  collegeEmail: '',
  collegeType: '',
  collegeTypeOther: '',
  usnFormat: '',
  collegeWebsite: '',
  expectedFestSize: '',
  applicantFullName: '',
  applicantEmail: '',
  applicantPhone: '',
  applicantRole: '',
  notesFromApplicant: '',
};

function RegisterCollegeScreen() {
  const navigate = useTransitionNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  /*
   * THE OUTGOING STEP. `null` at rest; during a step change it holds
   * { index, direction } for the step being left, which stays mounted for
   * STEP_TRANSITION_MS so the two can cross-slide. This is a STATE change and a
   * transform — the router never sees it. Putting the steps on routes would
   * mean the browser Back button dropped somebody into the middle of a
   * half-filled form and a refresh threw four steps of typing away.
   */
  const [leavingStep, setLeavingStep] = useState(null);
  const [formValues, setFormValues] = useState(INITIAL_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState({});
  const [conflictMessage, setConflictMessage] = useState('');
  // Set only if the server ever starts returning the id of the offending
  // application alongside a 409 — see conflictStatusHref below.
  const [conflictApplicationId, setConflictApplicationId] = useState('');
  // The structured postal address, kept beside the flat form values because it
  // is submitted as one nested object.
  const [addressValues, setAddressValues] = useState(EMPTY_COLLEGE_ADDRESS);
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Public college directory (reference + active), fetched lazily the first
  // time step 1 renders. null = not loaded yet.
  const [directoryColleges, setDirectoryColleges] = useState(null);
  const [directoryMatch, setDirectoryMatch] = useState(null);
  const hasFetchedDirectory = useRef(false);

  function setAddressField(fieldName, fieldValue) {
    setAddressValues((previous) => ({ ...previous, [fieldName]: fieldValue }));
    setFieldErrors((previous) => {
      if (!previous[`address.${fieldName}`]) {
        return previous;
      }
      const next = { ...previous };
      delete next[`address.${fieldName}`];
      return next;
    });
  }

  // Lazy one-shot fetch of GET /colleges when the college-details step shows.
  // A failed fetch is silent — the directory hint is a nicety, not a gate.
  useEffect(() => {
    if (currentStep !== 0 || hasFetchedDirectory.current) {
      return;
    }
    hasFetchedDirectory.current = true;
    let isActive = true;
    apiClient
      .get('/colleges')
      .then((payload) => {
        if (isActive) {
          setDirectoryColleges(Array.isArray(payload?.colleges) ? payload.colleges : []);
        }
      })
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [currentStep]);

  // Debounced case-insensitive exact match of the typed name against the
  // directory's collegeName or commonName.
  useEffect(() => {
    if (!directoryColleges) {
      return;
    }
    const timer = setTimeout(() => {
      const typedName = formValues.collegeName.trim().toLowerCase();
      const match = typedName
        ? (directoryColleges.find(
            (college) =>
              college.collegeName?.toLowerCase() === typedName ||
              college.commonName?.toLowerCase() === typedName,
          ) ?? null)
        : null;
      setDirectoryMatch(match);
      // Auto-fill city from the match without clobbering anything the
      // applicant already typed — the field stays fully editable.
      if (match?.city) {
        setAddressValues((previous) =>
          previous.city.trim() ? previous : { ...previous, city: match.city },
        );
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [directoryColleges, formValues.collegeName]);

  // The outgoing step is dropped once its slide is over. A timer rather than an
  // animationend listener: under prefers-reduced-motion the animation never
  // runs and animationend would never fire, stranding a dead copy of the
  // previous step permanently under the live one.
  useEffect(() => {
    if (!leavingStep) {
      return undefined;
    }
    const timer = setTimeout(() => setLeavingStep(null), STEP_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [leavingStep]);

  function setField(fieldName, fieldValue) {
    setFormValues((previous) => ({ ...previous, [fieldName]: fieldValue }));
    // Clear the field's error the moment it is edited.
    setFieldErrors((previous) => {
      if (!previous[fieldName]) {
        return previous;
      }
      const next = { ...previous };
      delete next[fieldName];
      return next;
    });
  }

  /*
   * Validate one step's fields; returns an errors object keyed by field name.
   * UNCHANGED from the Heritage version — same rules, same messages, same
   * shape. This is a look-and-feel change and the contract is not part of it.
   */
  function validateStep(stepIndex) {
    const errors = {};
    const required = COLLEGE_ONBOARDING_COPY.requiredField;
    if (stepIndex === 0) {
      if (!formValues.collegeName.trim()) errors.collegeName = required;
      if (!formValues.collegeEmail.trim()) {
        errors.collegeEmail = required;
      } else if (!/^\S+@\S+\.\S+$/.test(formValues.collegeEmail.trim())) {
        errors.collegeEmail = COLLEGE_ONBOARDING_COPY.invalidEmail;
      }
      if (!formValues.expectedFestSize) errors.expectedFestSize = required;
    }
    if (stepIndex === 1) {
      // Every mandatory address field, then the PIN's shape. The backend
      // re-checks all of this; this only spares a round-trip.
      for (const addressField of REQUIRED_COLLEGE_ADDRESS_FIELDS) {
        if (!String(addressValues[addressField] ?? '').trim()) {
          errors[`address.${addressField}`] = required;
        }
      }
      if (
        addressValues.pinCode.trim() &&
        !INDIAN_PIN_CODE_PATTERN.test(addressValues.pinCode.trim())
      ) {
        errors['address.pinCode'] = COLLEGE_ONBOARDING_COPY.pinCodeInvalid;
      }
    }
    if (stepIndex === 2) {
      if (!formValues.applicantFullName.trim()) errors.applicantFullName = required;
      if (!formValues.applicantEmail.trim()) {
        errors.applicantEmail = required;
      } else if (!/^\S+@\S+\.\S+$/.test(formValues.applicantEmail.trim())) {
        errors.applicantEmail = COLLEGE_ONBOARDING_COPY.invalidEmail;
      }
      if (!formValues.applicantPhone.trim()) {
        errors.applicantPhone = required;
      } else if (!/^\d{10}$/.test(formValues.applicantPhone.trim())) {
        errors.applicantPhone = COLLEGE_ONBOARDING_COPY.invalidPhone;
      }
      if (!formValues.applicantRole.trim()) errors.applicantRole = required;
    }
    return errors;
  }

  /* One move between steps: remember where we came from and which way, so the
     CSS knows whether to slide right-to-left or left-to-right. */
  function goToStep(nextStep, direction) {
    if (nextStep === currentStep) {
      return;
    }
    setLeavingStep({ index: currentStep, direction });
    setCurrentStep(nextStep);
    window.scrollTo(0, 0);
  }

  function handleNext() {
    const errors = validateStep(currentStep);
    if (Object.keys(errors).length > 0) {
      setFieldErrors((previous) => ({ ...previous, ...errors }));
      return;
    }
    goToStep(Math.min(currentStep + 1, REVIEW_STEP), 'forward');
  }

  function handleBack() {
    goToStep(Math.max(currentStep - 1, 0), 'back');
  }

  function jumpToStep(stepIndex) {
    goToStep(stepIndex, stepIndex < currentStep ? 'back' : 'forward');
  }

  const documentInputReference = useRef(null);
  const [documentUrls, setDocumentUrls] = useState([]);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [documentError, setDocumentError] = useState('');

  /*
   * Uploaded ONE AT A TIME rather than in a Promise.all: the endpoint is
   * rate-limited per IP, and firing five parallel requests at it is the quickest
   * way for an applicant to be told to slow down while doing nothing wrong.
   */
  async function handleDocumentFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      return;
    }
    setDocumentError('');
    setIsUploadingDocuments(true);
    try {
      for (const file of files) {
        if (!DOCUMENT_MIME_TYPES.includes(file.type)) {
          setDocumentError(COLLEGE_ONBOARDING_COPY.uploadWrongType);
          continue;
        }
        if (file.size > DOCUMENT_MAX_BYTES) {
          setDocumentError(COLLEGE_ONBOARDING_COPY.uploadTooLarge(file.name));
          continue;
        }
        const body = new FormData();
        body.append('file', file);
        try {
          // The explicit header matches the other upload callers: the client's
          // default is application/json, which would send the parts unparsed.
          const uploaded = await apiClient.post('/uploads/application-document', body, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const url = uploaded?.url ?? uploaded?.data?.url;
          if (url) {
            setDocumentUrls((previous) => [...previous, { url, name: file.name }]);
          }
        } catch (uploadException) {
          setDocumentError(uploadException?.message || COLLEGE_ONBOARDING_COPY.uploadFailed);
        }
      }
    } finally {
      setIsUploadingDocuments(false);
      // Lets the same file be re-picked after a failure.
      if (documentInputReference.current) {
        documentInputReference.current.value = '';
      }
    }
  }

  function removeDocument(url) {
    setDocumentUrls((previous) => previous.filter((document) => document.url !== url));
  }

  /*
   * ONE value for the institution type, whether it came from the list or from
   * the "Other" box. Resolved here so the payload and the reviewer notes cannot
   * disagree about what was chosen — and so the literal word "Other", which
   * tells a reviewer nothing, never reaches them.
   */
  const resolvedCollegeType =
    formValues.collegeType === COLLEGE_TYPE_OTHER
      ? formValues.collegeTypeOther.trim()
      : formValues.collegeType;

  /*
   * The design fields, folded into the notes so they reach the reviewer even
   * though the backend whitelist ignores their payload keys. The applicant's own
   * free text stays first.
   */
  function buildNotesWithExtras() {
    const extras = [
      formValues.collegeEmail.trim() ? `College email: ${formValues.collegeEmail.trim()}` : null,
      resolvedCollegeType ? `Institution type: ${resolvedCollegeType}` : null,
      formValues.usnFormat.trim()
        ? `Registration number format: ${formValues.usnFormat.trim()}`
        : null,
    ].filter(Boolean);
    return [formValues.notesFromApplicant.trim(), extras.join(' · ')]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 2000);
  }

  async function handleSubmit() {
    // Re-validate everything before submitting — the applicant may have jumped
    // back and cleared a field.
    const allErrors = { ...validateStep(0), ...validateStep(1), ...validateStep(2) };
    if (Object.keys(allErrors).length > 0) {
      setFieldErrors(allErrors);
      const brokenStep = STEP_FIELDS.findIndex((fields) =>
        fields.some((fieldName) => allErrors[fieldName]),
      );
      goToStep(brokenStep === -1 ? 0 : brokenStep, 'back');
      return;
    }

    setSubmitError('');
    setConflictMessage('');
    setConflictApplicationId('');
    setIsSubmitting(true);
    try {
      const notesWithExtras = buildNotesWithExtras();
      const payload = await apiClient.post('/college-applications', {
        applicantFullName: formValues.applicantFullName.trim(),
        applicantEmail: formValues.applicantEmail.trim(),
        applicantPhone: formValues.applicantPhone.trim(),
        applicantRole: formValues.applicantRole.trim(),
        collegeName: formValues.collegeName.trim(),
        // The free-text line stays in the payload as the verifier's
        // at-a-glance summary; `address` is the structured record of truth, and
        // city/state are derived from it so they can never disagree.
        collegeAddress: [addressValues.addressLine1, addressValues.addressLine2]
          .filter((line) => line && line.trim())
          .join(', ')
          .trim(),
        collegeCity: addressValues.city.trim(),
        collegeState: addressValues.state,
        address: toCollegeAddressPayload(addressValues),
        collegeWebsite: formValues.collegeWebsite.trim() || undefined,
        expectedFestSize: formValues.expectedFestSize,
        notesFromApplicant: notesWithExtras || undefined,
        // Forward-compatible keys — ignored by today's validator, folded into
        // the notes above so the data is not lost.
        collegeEmail: formValues.collegeEmail.trim() || undefined,
        collegeType: resolvedCollegeType || undefined,
        usnFormat: formValues.usnFormat.trim() || undefined,
        documentUrls: documentUrls.map((document) => document.url),
      });
      const applicationId = payload?.application?.id;
      // Route state carries the full application for the success page; the
      // query param keeps the id alive across a refresh.
      navigate(
        `/register-college/success?applicationId=${encodeURIComponent(applicationId ?? '')}`,
        { state: { application: payload?.application ?? null } },
      );
    } catch (submitException) {
      if (
        submitException.code === 'APPLICATION_ALREADY_PENDING' ||
        submitException.code === 'COLLEGE_ALREADY_REGISTERED'
      ) {
        setConflictMessage(submitException.message);
        setConflictApplicationId(submitException.details?.applicationId ?? '');
      } else if (submitException.code === 'VALIDATION_FAILED') {
        const serverDetails = submitException.details ?? {};
        setFieldErrors(serverDetails);
        const brokenStep = STEP_FIELDS.findIndex((fields) =>
          fields.some((fieldName) => serverDetails[fieldName]),
        );
        if (brokenStep !== -1) {
          goToStep(brokenStep, 'back');
        }
        setSubmitError(submitException.message || COLLEGE_ONBOARDING_COPY.submitFailed);
      } else if (submitException.code === 'APPLICATION_RATE_LIMITED') {
        setSubmitError(COLLEGE_ONBOARDING_COPY.rateLimited);
      } else {
        setSubmitError(submitException.message || COLLEGE_ONBOARDING_COPY.submitFailed);
      }
      window.scrollTo(0, 0);
    } finally {
      setIsSubmitting(false);
    }
  }

  const isReviewStep = currentStep === REVIEW_STEP;
  /*
   * Continue is inert until the current step could actually pass. Computed by
   * running the very same validator the Continue press runs, so the button's
   * appearance and the form's behaviour cannot drift apart — a disabled-looking
   * button that works, or a live one that refuses, is worse than either state
   * honestly held.
   */
  const isCurrentStepComplete = Object.keys(validateStep(currentStep)).length === 0;

  /*
   * THE STATUS LINK ON THE CONFLICT BANNER, AND ITS ONE HONEST LIMITATION.
   *
   * The status route is /register-college/status/:applicationId — it needs an
   * id, and today's 409 responses do not carry one: the backend answers
   * APPLICATION_ALREADY_PENDING and COLLEGE_ALREADY_REGISTERED with a message
   * and nothing else (college-application-service.js). So the id is read out of
   * `details` speculatively, and the link renders only when one is actually
   * there — a link to a route that will 404 is worse than no link, and a
   * hardcoded id-less href would 404 every single time.
   *
   * Adding `applicationId` to those two error details is a one-line backend
   * change and this lights up the moment it lands.
   */
  const conflictStatusHref = conflictApplicationId
    ? `/register-college/status/${encodeURIComponent(conflictApplicationId)}`
    : null;

  /* ── Step bodies ────────────────────────────────────────────────────────── */

  function renderStepBody(stepIndex) {
    if (stepIndex === 0) {
      return (
        <div className="dco-fields">
          <DcoField
            id="dco-college-name"
            label={COLLEGE_ONBOARDING_COPY.dcoCollegeNameLabel}
            value={formValues.collegeName}
            error={fieldErrors.collegeName}
            type="text"
            autoComplete="organization"
            placeholder={COLLEGE_ONBOARDING_COPY.collegeNamePlaceholder}
            onChange={(changeEvent) => setField('collegeName', changeEvent.target.value)}
          />

          {/* Non-blocking directory-match note — informational only, and never
              a gate: being in the directory is good news, not a condition. */}
          {directoryMatch ? (
            <p className="dco-hintbox">
              <span className="dco-hintbox__icon" aria-hidden="true">
                <InfoIcon size="sm" />
              </span>
              {COLLEGE_ONBOARDING_COPY.directoryMatchNote}
            </p>
          ) : null}

          <DcoField
            id="dco-college-email"
            label={COLLEGE_ONBOARDING_COPY.dcoCollegeEmailLabel}
            value={formValues.collegeEmail}
            error={fieldErrors.collegeEmail}
            type="email"
            placeholder={COLLEGE_ONBOARDING_COPY.collegeEmailPlaceholder}
            onChange={(changeEvent) => setField('collegeEmail', changeEvent.target.value)}
          />

          <DcoField
            as="select"
            id="dco-college-type"
            label={COLLEGE_ONBOARDING_COPY.dcoCollegeTypeLabel}
            value={formValues.collegeType}
            error={fieldErrors.collegeType}
            optional
            onChange={(changeEvent) => setField('collegeType', changeEvent.target.value)}
          >
            {/* Blank rather than a worded placeholder: the floating label IS
                the placeholder here, and two of them would collide. */}
            <option value="" />
            {COLLEGE_TYPE_OPTIONS.map((typeName) => (
              <option key={typeName} value={typeName}>
                {typeName}
              </option>
            ))}
          </DcoField>

          {/* Only for "Other": the typed value becomes the collegeType and is
              shown to the reviewer exactly as entered. */}
          {formValues.collegeType === COLLEGE_TYPE_OTHER ? (
            <DcoField
              id="dco-college-type-other"
              label={COLLEGE_ONBOARDING_COPY.dcoCollegeTypeOtherLabel}
              value={formValues.collegeTypeOther}
              error={fieldErrors.collegeTypeOther}
              type="text"
              placeholder={COLLEGE_ONBOARDING_COPY.collegeTypeOtherPlaceholder}
              onChange={(changeEvent) => setField('collegeTypeOther', changeEvent.target.value)}
            />
          ) : null}

          <DcoField
            id="dco-usn-format"
            label={COLLEGE_ONBOARDING_COPY.dcoUsnFormatLabel}
            value={formValues.usnFormat}
            error={fieldErrors.usnFormat}
            hint={COLLEGE_ONBOARDING_COPY.usnFormatHelper}
            optional
            type="text"
            placeholder={COLLEGE_ONBOARDING_COPY.usnFormatPlaceholder}
            onChange={(changeEvent) => setField('usnFormat', changeEvent.target.value)}
          />

          <DcoField
            id="dco-college-website"
            label={COLLEGE_ONBOARDING_COPY.dcoCollegeWebsiteLabel}
            value={formValues.collegeWebsite}
            error={fieldErrors.collegeWebsite}
            optional
            type="url"
            inputMode="url"
            placeholder={COLLEGE_ONBOARDING_COPY.collegeWebsitePlaceholder}
            onChange={(changeEvent) => setField('collegeWebsite', changeEvent.target.value)}
          />

          <DcoChoiceGroup
            name="expectedFestSize"
            legend={COLLEGE_ONBOARDING_COPY.dcoExpectedFestSizeLabel}
            value={formValues.expectedFestSize}
            options={EXPECTED_FEST_SIZE_OPTIONS}
            error={fieldErrors.expectedFestSize}
            onChange={(nextValue) => setField('expectedFestSize', nextValue)}
          />
        </div>
      );
    }

    if (stepIndex === 1) {
      return (
        <div className="dco-fields">
          <DcoField
            id="dco-address-1"
            label={COLLEGE_ONBOARDING_COPY.dcoAddressLine1Label}
            value={addressValues.addressLine1}
            error={fieldErrors['address.addressLine1']}
            type="text"
            autoComplete="address-line1"
            placeholder={COLLEGE_ONBOARDING_COPY.addressLine1Placeholder}
            onChange={(changeEvent) => setAddressField('addressLine1', changeEvent.target.value)}
          />
          <DcoField
            id="dco-address-2"
            label={COLLEGE_ONBOARDING_COPY.dcoAddressLine2Label}
            value={addressValues.addressLine2}
            error={fieldErrors['address.addressLine2']}
            optional
            type="text"
            autoComplete="address-line2"
            placeholder={COLLEGE_ONBOARDING_COPY.addressLine2Placeholder}
            onChange={(changeEvent) => setAddressField('addressLine2', changeEvent.target.value)}
          />
          <DcoField
            id="dco-town"
            label={COLLEGE_ONBOARDING_COPY.dcoTownOrLocalityLabel}
            value={addressValues.townOrLocality}
            error={fieldErrors['address.townOrLocality']}
            optional
            type="text"
            placeholder={COLLEGE_ONBOARDING_COPY.townOrLocalityPlaceholder}
            onChange={(changeEvent) => setAddressField('townOrLocality', changeEvent.target.value)}
          />
          <DcoField
            id="dco-city"
            label={COLLEGE_ONBOARDING_COPY.dcoCityLabel}
            value={addressValues.city}
            error={fieldErrors['address.city']}
            type="text"
            autoComplete="address-level2"
            placeholder={COLLEGE_ONBOARDING_COPY.collegeCityPlaceholder}
            onChange={(changeEvent) => setAddressField('city', changeEvent.target.value)}
          />
          <DcoField
            as="select"
            id="dco-state"
            label={COLLEGE_ONBOARDING_COPY.dcoStateLabel}
            value={addressValues.state}
            error={fieldErrors['address.state']}
            onChange={(changeEvent) => setAddressField('state', changeEvent.target.value)}
          >
            <option value="" />
            {COLLEGE_STATE_OPTIONS.map((stateName) => (
              <option key={stateName} value={stateName}>
                {stateName}
              </option>
            ))}
          </DcoField>
          {/*
            type="text" with inputMode="numeric", NOT type="number": the number
            spinner is useless for a PIN and iOS Safari renders it badly.
            inputMode brings up the numeric keypad on mobile.
          */}
          <DcoField
            id="dco-pin"
            label={COLLEGE_ONBOARDING_COPY.dcoPinCodeLabel}
            value={addressValues.pinCode}
            error={fieldErrors['address.pinCode']}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="postal-code"
            placeholder={COLLEGE_ONBOARDING_COPY.pinCodePlaceholder}
            onChange={(changeEvent) => setAddressField('pinCode', changeEvent.target.value)}
          />
        </div>
      );
    }

    if (stepIndex === 2) {
      return (
        <div className="dco-fields">
          <DcoField
            id="dco-applicant-name"
            label={COLLEGE_ONBOARDING_COPY.dcoApplicantNameLabel}
            value={formValues.applicantFullName}
            error={fieldErrors.applicantFullName}
            type="text"
            autoComplete="name"
            placeholder={COLLEGE_ONBOARDING_COPY.applicantFullNamePlaceholder}
            onChange={(changeEvent) => setField('applicantFullName', changeEvent.target.value)}
          />
          <DcoField
            id="dco-applicant-email"
            label={COLLEGE_ONBOARDING_COPY.dcoApplicantEmailLabel}
            value={formValues.applicantEmail}
            error={fieldErrors.applicantEmail}
            hint={COLLEGE_ONBOARDING_COPY.applicantEmailHelper}
            type="email"
            autoComplete="email"
            placeholder={COLLEGE_ONBOARDING_COPY.applicantEmailPlaceholder}
            onChange={(changeEvent) => setField('applicantEmail', changeEvent.target.value)}
          />
          <DcoField
            id="dco-applicant-phone"
            label={COLLEGE_ONBOARDING_COPY.dcoApplicantPhoneLabel}
            value={formValues.applicantPhone}
            error={fieldErrors.applicantPhone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={COLLEGE_ONBOARDING_COPY.applicantPhonePlaceholder}
            onChange={(changeEvent) => setField('applicantPhone', changeEvent.target.value)}
          />
          <DcoField
            id="dco-applicant-role"
            label={COLLEGE_ONBOARDING_COPY.dcoApplicantRoleLabel}
            value={formValues.applicantRole}
            error={fieldErrors.applicantRole}
            type="text"
            placeholder={COLLEGE_ONBOARDING_COPY.applicantRolePlaceholder}
            onChange={(changeEvent) => setField('applicantRole', changeEvent.target.value)}
          />
        </div>
      );
    }

    if (stepIndex === 3) {
      return (
        <div className="dco-fields">
          {/*
            A real uploader. It posts to /uploads/application-document, the one
            public upload route — rate-limited per IP and restricted to
            PDF/JPEG/PNG, because a college applying has no account to
            authenticate with yet. Unchanged: same route, same MIME list, same
            5 MB ceiling.

            A <button>, not a div with role="button" and a hand-rolled keydown
            handler: Enter and Space are then the browser's job rather than four
            lines that have to remember to preventDefault.
          */}
          <button
            type="button"
            className="dco-drop"
            onClick={() => documentInputReference.current?.click()}
          >
            <span className="dco-drop__icon" aria-hidden="true">
              <UploadIcon size="lg" />
            </span>
            <span className="dco-drop__title">
              {COLLEGE_ONBOARDING_COPY.dcoUploadZoneTitle}
            </span>
            <span className="dco-drop__hint">{COLLEGE_ONBOARDING_COPY.uploadHint}</span>
          </button>
          <input
            ref={documentInputReference}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            hidden
            onChange={(changeEvent) => handleDocumentFiles(changeEvent.target.files)}
          />

          {isUploadingDocuments ? (
            <p className="dco-note">{COLLEGE_ONBOARDING_COPY.uploadInProgress}</p>
          ) : null}
          {documentError ? (
            <p className="dco-note dco-note--alert" role="alert">
              {documentError}
            </p>
          ) : null}

          {documentUrls.length > 0 ? (
            <ul className="dco-docs">
              {documentUrls.map((document) => (
                <li className="dco-doc" key={document.url}>
                  <span className="dco-doc__name">{document.name}</span>
                  <button
                    type="button"
                    className="dco-doc__remove"
                    onClick={() => removeDocument(document.url)}
                    aria-label={COLLEGE_ONBOARDING_COPY.removeDocument(document.name)}
                  >
                    <CloseIcon size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="dco-note">{COLLEGE_ONBOARDING_COPY.documentsNote}</p>

          <DcoField
            as="textarea"
            id="dco-notes"
            label={COLLEGE_ONBOARDING_COPY.dcoNotesLabel}
            value={formValues.notesFromApplicant}
            optional
            rows={4}
            placeholder={COLLEGE_ONBOARDING_COPY.notesPlaceholder}
            onChange={(changeEvent) => setField('notesFromApplicant', changeEvent.target.value)}
          />
        </div>
      );
    }

    // Step 4 — review.
    return (
      <div className="dco-review">
        {/*
          THE 409s. Persistent, at the top of the review, carrying the server's
          own wording — neither conflict is something the applicant can fix by
          pressing Submit again, and both mean the thing they came to do is
          already done. So the useful next move is the status page, and that is
          the only link here.

          aria-live="assertive": it appears in response to a press, several
          hundred milliseconds later, at the top of a screen whose bottom the
          person is looking at. Nothing else on the screen changes to announce it.
        */}
        {conflictMessage ? (
          <div className="dco-conflict" role="alert" aria-live="assertive">
            <span className="dco-conflict__icon" aria-hidden="true">
              <AlertIcon size="md" />
            </span>
            <div className="dco-conflict__body">
              <p className="dco-conflict__text">{conflictMessage}</p>
              {conflictStatusHref ? (
                <Link className="dco-conflict__link" to={conflictStatusHref}>
                  {COLLEGE_ONBOARDING_COPY.dcoConflictLink}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <DcoReviewSection title={STEP_TITLES[0]} onEdit={() => jumpToStep(0)}>
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoCollegeNameLabel}
            value={formValues.collegeName}
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoCollegeEmailLabel}
            value={formValues.collegeEmail}
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoCollegeTypeLabel}
            value={resolvedCollegeType}
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoUsnFormatLabel}
            value={formValues.usnFormat}
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoCollegeWebsiteLabel}
            value={formValues.collegeWebsite}
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoExpectedFestSizeLabel}
            value={
              EXPECTED_FEST_SIZE_OPTIONS.find(
                (option) => option.value === formValues.expectedFestSize,
              )?.label
            }
          />
        </DcoReviewSection>

        <DcoReviewSection title={STEP_TITLES[1]} onEdit={() => jumpToStep(1)}>
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoAddressSummaryLabel}
            value={formatCollegeAddressLines(addressValues).join(', ')}
          />
        </DcoReviewSection>

        <DcoReviewSection title={STEP_TITLES[2]} onEdit={() => jumpToStep(2)}>
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoApplicantNameLabel}
            value={formValues.applicantFullName}
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoApplicantEmailLabel}
            value={formValues.applicantEmail}
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoApplicantPhoneLabel}
            value={formValues.applicantPhone}
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoApplicantRoleLabel}
            value={formValues.applicantRole}
          />
        </DcoReviewSection>

        <DcoReviewSection title={STEP_TITLES[3]} onEdit={() => jumpToStep(3)}>
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoDocumentsSummaryLabel}
            value={
              documentUrls.length
                ? COLLEGE_ONBOARDING_COPY.dcoDocumentCount(documentUrls.length)
                : ''
            }
          />
          <DcoReviewRow
            label={COLLEGE_ONBOARDING_COPY.dcoNotesSummaryLabel}
            value={formValues.notesFromApplicant}
          />
        </DcoReviewSection>

        {submitError ? (
          <p className="dco-note dco-note--alert" role="alert">
            {submitError}
          </p>
        ) : null}
      </div>
    );
  }

  /* One step, as a real fieldset with the step title as its legend. `key` is
     the step index so React remounts on a change and the entry animation
     actually restarts rather than being skipped as a re-render. */
  function renderStep(stepIndex, animationClass, isLeaving) {
    return (
      <div
        key={`dco-step-${stepIndex}`}
        className={['dco-step', animationClass, isLeaving ? 'dco-step--leaving' : '']
          .filter(Boolean)
          .join(' ')}
        // The outgoing copy is a picture of where you were, not a form you can
        // still type into — `inert` takes it out of the tab order and out of
        // the accessibility tree in one attribute.
        inert={isLeaving || undefined}
      >
        {/* A real fieldset with the step title as its legend: that is what
            tells a screen reader these six controls are one group called
            "About your college". A <div> and an <h2> beside it look the same
            and carry none of it. The <legend> is a direct child, which the
            element requires. */}
        <fieldset className="dco-fieldset">
          <legend className="dco-legend">{STEP_TITLES[stepIndex]}</legend>
          <p className="dco-substep">{STEP_SUBTITLES[stepIndex]}</p>
          {renderStepBody(stepIndex)}
        </fieldset>
      </div>
    );
  }

  return (
    <div
      className={[
        'dco-screen',
        'dco-screen--form',
        isReviewStep ? 'dco-screen--review' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/*
        THE PROGRESS BAR — the only progress indicator on this form. The
        "step N of 4" line the Heritage version carried is deliberately gone:
        see the long note in college-onboarding.css for why a count and a bar
        carry the same information but not the same decision.
      */}
      <div
        className="dco-progress"
        role="progressbar"
        aria-label={COLLEGE_ONBOARDING_COPY.dcoProgressLabel}
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={currentStep + 1}
      >
        <div
          className="dco-progress__fill"
          style={{ transform: `scaleX(${(currentStep + 1) / TOTAL_STEPS})` }}
        />
      </div>

      <PublicWordmarkHeader />

      <form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          if (isReviewStep) {
            handleSubmit();
          } else {
            handleNext();
          }
        }}
      >
        <h1 className="dco-sr">{COLLEGE_ONBOARDING_COPY.dcoFormTitle}</h1>

        <div className="dco-steps dco-col">
          {leavingStep
            ? renderStep(leavingStep.index, `dco-step--leave-${leavingStep.direction}`, true)
            : null}
          {renderStep(
            currentStep,
            leavingStep ? `dco-step--enter-${leavingStep.direction}` : '',
            false,
          )}
        </div>

        {/*
          THE ACTION BAR. Fixed, so Continue is never at an unknown scroll depth
          that changes with every step.

          Continue is `aria-disabled`, never `disabled`: a disabled button
          cannot be focused or pressed and therefore can never explain itself.
          This one stays reachable and, when pressed while incomplete, runs the
          ordinary validation path — which paints the inline errors that ARE the
          explanation. `disabled` is used for exactly one thing, an in-flight
          submit, where a second press would post the application twice.
        */}
        <div className="dco-actions">
          <div className="dco-actions__inner">
            {currentStep > 0 ? (
              <button type="button" className="dco-back" onClick={handleBack}>
                {COLLEGE_ONBOARDING_COPY.dcoBack}
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              className={[
                'dco-next',
                isReviewStep ? 'dco-next--wide' : '',
                isCurrentStepComplete ? '' : 'dco-next--inert',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={isSubmitting}
              aria-disabled={!isCurrentStepComplete}
              aria-describedby={isCurrentStepComplete ? undefined : 'dco-inert-reason'}
            >
              {isReviewStep
                ? COLLEGE_ONBOARDING_COPY.dcoSubmit
                : COLLEGE_ONBOARDING_COPY.dcoContinue}
            </button>
            {isCurrentStepComplete ? null : (
              <span className="dco-sr" id="dco-inert-reason">
                {COLLEGE_ONBOARDING_COPY.dcoIncompleteReason}
              </span>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

export default RegisterCollegeScreen;
