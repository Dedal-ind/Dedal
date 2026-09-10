// ProfileFieldSet.jsx
// THE participant profile form. One implementation, two mount points.
//
// WHY THIS FILE EXISTS. The redesign moves editing your profile out of a
// separate screen and into an inline expand on /settings — you tap "Edit
// profile", the rows part, and the fields are there, under the avatar you were
// already looking at. That instruction leaves an obvious trap: /profile/edit is
// a real route with real deep links into it (the profile-completion flow, old
// notification payloads, anything a person has bookmarked), so it has to keep
// working, and the lazy way to keep it working is to leave the old screen
// standing beside the new expand. That is exactly how this codebase came to
// have two copies of the registration form drift apart.
//
// So the FIELDS live here and nowhere else. SettingsScreen renders this inside
// its expand; EditProfileScreen renders this same component in a plain column
// for the route. There is one validator, one PATCH, one set of labels. A field
// added here appears in both places or in neither.
//
// Endpoints: PATCH /users/me for the save, GET /colleges for the picker,
// POST /uploads/student-id (multipart) for the ID image — all pre-existing.
//
// The two shared pickers (college, department) are rendered into a `.dst-embed`
// slot untouched. They carry their own register and are used by three other
// screens; restyling them from this surface would reach all of them.

import { useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import CollegeSelect from '../../components/college-select/CollegeSelect.jsx';
import DepartmentSelect from '../../components/department-select/DepartmentSelect.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { checkProfessionalEmail } from '../../helpers/professional-email.js';
import { YEAR_OF_STUDY_OPTIONS } from '../../brand/brand-copy.js';
import { AlertIcon, LockIcon, MailIcon, UploadIcon } from '../../components/detail-icons/DetailIcons.jsx';

/*
 * Copy, held here rather than in brand-copy.js.
 *
 * EDIT_PROFILE_COPY is ALL-CAPS throughout — "FULL NAME", "SAVE", "PROFILE
 * UPDATED" — which is the retired Heritage register and is the opposite of the
 * sentence case this system asks for. It is also imported by screens this pass
 * does not own, so rewriting it in place would restyle those screens' labels
 * without their authors' knowledge. These strings therefore live with the one
 * component that renders them, and the shared constant is left alone for the
 * screens that still speak that way.
 */
const FIELD_COPY = {
  personal: 'Personal details',
  academic: 'College details',
  fullName: 'Full name',
  fullNamePlaceholder: 'Your full name',
  email: 'Email address',
  emailHelp: 'Linked to your sign-in, so it cannot be changed here.',
  professionalEmail: 'Institutional email',
  professionalEmailPlaceholder: 'you@institution.edu.in',
  professionalEmailHelp: 'Optional. Personal providers such as Gmail are not accepted.',
  professionalEmailInvalid: 'Enter a valid email address.',
  professionalEmailPersonal: 'Use your institutional address, not a personal one.',
  phone: 'Phone number',
  phonePlaceholder: '10-digit mobile number',
  phoneInvalid: 'Enter a 10-digit mobile number.',
  college: 'College',
  usn: 'Register number',
  usnPlaceholder: 'e.g. 1RV21CS001',
  department: 'Course',
  departmentPlaceholder: 'Search or type your course',
  year: 'Year of study',
  yearNone: 'Tap a year, or tap it again to clear it.',
  country: 'Country',
  countryValue: 'India',
  collegeAddress: 'College address',
  collegeAddressHelp: 'From your college record.',
  studentId: 'Student ID',
  upload: 'Upload your student ID',
  uploadReplace: 'Tap to replace',
  uploadHint: 'JPEG or PNG, up to 5 MB',
  uploading: 'Uploading…',
  uploadTooLarge: 'That file is over 5 MB. Choose a smaller image.',
  uploadWrongType: 'Only JPEG and PNG images are accepted.',
  uploadFailed: 'The upload did not go through. Try again.',
  optional: 'optional',
  save: 'Save changes',
  saving: 'Saving',
  saved: 'Saved',
  saveFailed: 'Your changes could not be saved. Try again.',
  nothingToSave: 'Nothing has changed yet.',
  incomplete: 'Fill in your name, phone number, college and register number.',
};

const PHONE_PATTERN = /^\d{10}$/;
const STUDENT_ID_MAX_BYTES = 5 * 1024 * 1024;
const STUDENT_ID_MIME_TYPES = ['image/jpeg', 'image/png'];

function buildForm(user) {
  return {
    fullName: user?.fullName ?? '',
    phoneNumber: user?.phoneNumber ?? '',
    /* The API returns collegeId either as a bare id or as a populated object,
       depending on the route that served the user. The picker wants the id. */
    collegeId: user?.collegeId?.id ?? user?.collegeId?._id ?? user?.collegeId ?? '',
    usn: user?.usn ?? '',
    department: user?.department ?? '',
    yearOfStudy: user?.yearOfStudy ?? null,
    studentIdUrl: user?.studentIdUrl ?? '',
    professionalEmail: user?.professionalEmail ?? '',
  };
}

function FieldLabel({ htmlFor, children, required, optional }) {
  return (
    <label className="dst-label" htmlFor={htmlFor}>
      {children}
      {required ? (
        <span className="dst-label__required" aria-hidden="true">
          *
        </span>
      ) : null}
      {optional ? <span className="dst-label__optional">({FIELD_COPY.optional})</span> : null}
    </label>
  );
}

/* The student-ID zone: a hidden file input driven by a real button, with the
   uploaded image shown back rather than a filename the person cannot check. */
function StudentIdField({ studentIdUrl, onUploaded }) {
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  async function handleFileSelected(changeEvent) {
    const file = changeEvent.target.files?.[0];
    /* Cleared so choosing the SAME file twice after a failure still fires a
       change event. */
    changeEvent.target.value = '';
    if (!file) return;
    if (!STUDENT_ID_MIME_TYPES.includes(file.type)) {
      setUploadError(FIELD_COPY.uploadWrongType);
      return;
    }
    if (file.size > STUDENT_ID_MAX_BYTES) {
      setUploadError(FIELD_COPY.uploadTooLarge);
      return;
    }
    setUploadError('');
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiClient.post('/uploads/student-id', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded(result?.url ?? result?.data?.url ?? '');
    } catch {
      setUploadError(FIELD_COPY.uploadFailed);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="dst-field">
      <input
        ref={fileInputRef}
        className="dst-file"
        type="file"
        accept="image/jpeg,image/png"
        onChange={handleFileSelected}
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        className="dst-upload"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
      >
        {studentIdUrl && !isUploading ? (
          <>
            <img className="dst-upload__preview" src={studentIdUrl} alt="Your uploaded student ID" />
            <span className="dst-upload__hint">{FIELD_COPY.uploadReplace}</span>
          </>
        ) : (
          <>
            <UploadIcon size="lg" />
            <span>{isUploading ? FIELD_COPY.uploading : FIELD_COPY.upload}</span>
            <span className="dst-upload__hint">{FIELD_COPY.uploadHint}</span>
          </>
        )}
      </button>
      {uploadError ? (
        <p className="dst-fielderror" role="alert">
          <AlertIcon size="sm" />
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}

/*
 * `onSaved` fires after a successful PATCH and after the auth context has the
 * new user. The inline expand uses it to collapse itself; the route uses it to
 * go back to /profile. The SAVE CONFIRMATION is not the caller's job — the
 * stroke is drawn here, because it confirms the thing this component did.
 */
function ProfileFieldSet({ onSaved, autoFocusFirstField = false }) {
  const { currentUser, updateUser } = useAuthentication();

  const [form, setForm] = useState(() => buildForm(currentUser));
  const [baseline, setBaseline] = useState(() => buildForm(currentUser));
  const [colleges, setColleges] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showStroke, setShowStroke] = useState(false);
  const [professionalEmailError, setProfessionalEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const firstFieldRef = useRef(null);

  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/colleges')
      .then((payload) => {
        if (isActive) setColleges(payload?.colleges ?? payload ?? []);
      })
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, []);

  /*
   * The stroke is cleared on a TIMER, not on animationend.
   *
   * The animation is gated behind `prefers-reduced-motion: no-preference`, so
   * for anybody who has asked for less motion the element renders and no
   * animation ever runs — meaning animationend never fires and the stroke, and
   * the live region beside it, would stay up for the rest of the session. A
   * timer of the animation's own length is the same 1.44s for everyone and
   * cannot depend on a callback that may not be scheduled.
   */
  useEffect(() => {
    if (!showStroke) return undefined;
    const timer = window.setTimeout(() => setShowStroke(false), 1440);
    return () => window.clearTimeout(timer);
  }, [showStroke]);

  /* The expand opens on a tap and the first field is where the person is going;
     moving focus there also puts the newly revealed region in the tab order at
     the point they are actually reading. */
  useEffect(() => {
    if (autoFocusFirstField) firstFieldRef.current?.focus();
  }, [autoFocusFirstField]);

  function setField(name, value) {
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  /*
   * Both checked on BLUR, not on every keystroke. "a@b" and "98765" are invalid
   * half-way through typing every valid value, and flagging them there trains
   * people to ignore the line that will later carry the real refusal.
   */
  function handleProfessionalEmailBlur() {
    const problem = checkProfessionalEmail(form.professionalEmail);
    setProfessionalEmailError(
      problem === 'personal'
        ? FIELD_COPY.professionalEmailPersonal
        : problem === 'invalid'
          ? FIELD_COPY.professionalEmailInvalid
          : '',
    );
  }

  function handlePhoneBlur() {
    const value = form.phoneNumber.trim();
    setPhoneError(value === '' || PHONE_PATTERN.test(value) ? '' : FIELD_COPY.phoneInvalid);
  }

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline),
    [form, baseline],
  );
  const isComplete =
    form.fullName.trim() !== '' &&
    PHONE_PATTERN.test(form.phoneNumber.trim()) &&
    form.collegeId !== '' &&
    form.usn.trim() !== '';
  const canSave = isDirty && isComplete && !isSaving;
  const selectedCollege = colleges.find((college) => college.id === form.collegeId) ?? null;

  async function handleSave() {
    if (!canSave) return;
    if (checkProfessionalEmail(form.professionalEmail)) {
      handleProfessionalEmailBlur();
      return;
    }
    setSaveError('');
    setIsSaving(true);
    try {
      const saved = await apiClient.patch('/users/me', {
        fullName: form.fullName.trim(),
        phoneNumber: form.phoneNumber.trim(),
        collegeId: form.collegeId,
        usn: form.usn.trim().toUpperCase(),
        department: form.department || undefined,
        yearOfStudy: form.yearOfStudy ?? undefined,
        studentIdUrl: form.studentIdUrl || undefined,
        /* '' clears it server-side (null); undefined would leave it untouched. */
        professionalEmail: form.professionalEmail.trim() || null,
      });
      const savedUser = saved.user ?? saved;
      updateUser(savedUser);
      /* The saved values become the new baseline, so the form goes clean
         in place rather than needing to be unmounted to forget it was dirty. */
      setBaseline(buildForm(savedUser));
      setForm(buildForm(savedUser));
      setShowStroke(true);
      onSaved?.(savedUser);
    } catch (error) {
      setSaveError(error?.message || FIELD_COPY.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  if (!currentUser) {
    return (
      <div className="dst-form" role="status" aria-label="Loading your profile">
        <div className="dst-skel" />
        <div className="dst-skel" />
        <div className="dst-skel" />
      </div>
    );
  }

  /* Named so the inert save button can say WHICH condition is unmet rather than
     being a control that silently does nothing. */
  const blockedReason = !isDirty
    ? FIELD_COPY.nothingToSave
    : !isComplete
      ? FIELD_COPY.incomplete
      : '';

  return (
    <div className="dst-form">
      {saveError ? (
        <p className="dst-notice dst-notice--refusal" role="alert">
          {saveError}
        </p>
      ) : null}

      <fieldset className="dst-form__group">
        <legend className="dst-form__legend">{FIELD_COPY.personal}</legend>

        <div className="dst-field">
          <FieldLabel htmlFor="dst-full-name" required>
            {FIELD_COPY.fullName}
          </FieldLabel>
          <input
            ref={firstFieldRef}
            id="dst-full-name"
            className="dst-input"
            type="text"
            autoComplete="name"
            value={form.fullName}
            onChange={(event) => setField('fullName', event.target.value)}
            placeholder={FIELD_COPY.fullNamePlaceholder}
          />
        </div>

        <div className="dst-field">
          <FieldLabel htmlFor="dst-email">{FIELD_COPY.email}</FieldLabel>
          <div className="dst-field__wrap">
            <input
              id="dst-email"
              className="dst-input dst-input--fixed"
              type="email"
              readOnly
              value={currentUser.emailAddress ?? ''}
            />
            <span className="dst-field__mark">
              <LockIcon size="sm" />
            </span>
          </div>
          <p className="dst-help">{FIELD_COPY.emailHelp}</p>
        </div>

        <div className="dst-field">
          <FieldLabel htmlFor="dst-professional-email" optional>
            {FIELD_COPY.professionalEmail}
          </FieldLabel>
          <div className="dst-field__wrap">
            <input
              id="dst-professional-email"
              className="dst-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.professionalEmail}
              onChange={(event) => setField('professionalEmail', event.target.value)}
              onBlur={handleProfessionalEmailBlur}
              aria-invalid={professionalEmailError ? 'true' : undefined}
              aria-describedby="dst-professional-email-note"
              placeholder={FIELD_COPY.professionalEmailPlaceholder}
            />
            <span className="dst-field__mark">
              <MailIcon size="sm" />
            </span>
          </div>
          {professionalEmailError ? (
            <p className="dst-fielderror" id="dst-professional-email-note" role="alert">
              <AlertIcon size="sm" />
              {professionalEmailError}
            </p>
          ) : (
            <p className="dst-help" id="dst-professional-email-note">
              {FIELD_COPY.professionalEmailHelp}
            </p>
          )}
        </div>

        <div className="dst-field">
          <FieldLabel htmlFor="dst-phone" required>
            {FIELD_COPY.phone}
          </FieldLabel>
          <input
            id="dst-phone"
            className="dst-input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={form.phoneNumber}
            onChange={(event) => setField('phoneNumber', event.target.value)}
            onBlur={handlePhoneBlur}
            aria-invalid={phoneError ? 'true' : undefined}
            aria-describedby={phoneError ? 'dst-phone-note' : undefined}
            placeholder={FIELD_COPY.phonePlaceholder}
          />
          {phoneError ? (
            <p className="dst-fielderror" id="dst-phone-note" role="alert">
              <AlertIcon size="sm" />
              {phoneError}
            </p>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="dst-form__group">
        <legend className="dst-form__legend">{FIELD_COPY.academic}</legend>

        <div className="dst-field">
          <span className="dst-label">
            {FIELD_COPY.college}
            <span className="dst-label__required" aria-hidden="true">
              *
            </span>
          </span>
          <div className="dst-embed">
            <CollegeSelect
              colleges={colleges}
              selectedCollegeId={form.collegeId}
              onSelect={(collegeId) => setField('collegeId', collegeId)}
              placeholder={FIELD_COPY.college}
            />
          </div>
        </div>

        <div className="dst-field">
          <FieldLabel htmlFor="dst-usn" required>
            {FIELD_COPY.usn}
          </FieldLabel>
          <input
            id="dst-usn"
            className="dst-input"
            type="text"
            autoComplete="off"
            value={form.usn}
            onChange={(event) => setField('usn', event.target.value.toUpperCase())}
            placeholder={FIELD_COPY.usnPlaceholder}
          />
        </div>

        <div className="dst-field">
          <span className="dst-label">
            {FIELD_COPY.department}
            <span className="dst-label__optional">({FIELD_COPY.optional})</span>
          </span>
          <div className="dst-embed">
            <DepartmentSelect
              value={form.department}
              onChange={(department) => setField('department', department)}
              placeholder={FIELD_COPY.departmentPlaceholder}
            />
          </div>
        </div>

        {/* Year of study. A group of toggles, so it is announced as one control
            with four options rather than as four unrelated buttons. */}
        <div className="dst-field" role="group" aria-labelledby="dst-year-label">
          <span className="dst-label" id="dst-year-label">
            {FIELD_COPY.year}
            <span className="dst-label__optional">({FIELD_COPY.optional})</span>
          </span>
          <div className="dst-years">
            {YEAR_OF_STUDY_OPTIONS.map((year) => {
              const isPicked = form.yearOfStudy === year;
              return (
                <button
                  key={year}
                  type="button"
                  className="dst-year"
                  aria-pressed={isPicked}
                  onClick={() => setField('yearOfStudy', isPicked ? null : year)}
                >
                  {year}
                </button>
              );
            })}
          </div>
          <p className="dst-help">{FIELD_COPY.yearNone}</p>
        </div>

        {/* Country — one value, and the platform serves Indian colleges only, so
            this is a fact rather than a choice and is drawn as one. */}
        <div className="dst-field">
          <span className="dst-label">{FIELD_COPY.country}</span>
          <p className="dst-help">{FIELD_COPY.countryValue}</p>
        </div>

        {selectedCollege ? (
          <div className="dst-field">
            <span className="dst-label">{FIELD_COPY.collegeAddress}</span>
            <p className="dst-help">
              {[selectedCollege.city, selectedCollege.state, selectedCollege.address?.pinCode]
                .filter(Boolean)
                .join(', ') || FIELD_COPY.collegeAddressHelp}
            </p>
          </div>
        ) : null}

        <div className="dst-field">
          <span className="dst-label">
            {FIELD_COPY.studentId}
            <span className="dst-label__optional">({FIELD_COPY.optional})</span>
          </span>
          <StudentIdField
            studentIdUrl={form.studentIdUrl}
            onUploaded={(url) => setField('studentIdUrl', url)}
          />
        </div>
      </fieldset>

      <button
        type="button"
        className={canSave ? 'dst-cta' : 'dst-cta dst-cta--inert'}
        aria-disabled={!canSave}
        aria-describedby={blockedReason ? 'dst-save-block' : undefined}
        onClick={handleSave}
      >
        {isSaving ? <span className="dst-spin" aria-hidden="true" /> : null}
        {isSaving ? FIELD_COPY.saving : FIELD_COPY.save}
      </button>
      {blockedReason ? (
        <p className="dst-help" id="dst-save-block">
          {blockedReason}
        </p>
      ) : null}

      {/* The confirmation. A live region as well as a stroke, because a 2px
          rule drawn across the top of the window is not available to a screen
          reader and "did that save?" is the question this whole control
          answers. */}
      <p className="dst-sr" role="status">
        {showStroke ? FIELD_COPY.saved : ''}
      </p>
      {showStroke ? <span className="dst-stroke" aria-hidden="true" /> : null}
    </div>
  );
}

export default ProfileFieldSet;
