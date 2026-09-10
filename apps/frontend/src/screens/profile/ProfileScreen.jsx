// ProfileScreen.jsx
// Route: /profile — the participant's identity and the list of places their
// account leads, rebuilt on the dedal design system.
//
// THIS SCREEN IS THE FRONT DOOR; /settings IS THE WORKSHOP. That division is
// new and it is the point of the pass. Before it, /profile and /settings both
// carried an avatar, both carried a route into the profile form, and BOTH
// carried Log out and Delete account — the same two destructive controls, with
// different wording and different confirmation behaviour, 60px apart in the
// navigation. One of them asked nothing at all before signing you out.
//
// So: this screen shows who you are and where you can go. Signing out and
// deleting your account happen in exactly one place now, at the bottom of
// /settings, through the app's own confirmation sheet — and there is a row here
// that goes there. Nothing was removed from the product; one of two copies was.
//
// The stats are derived from real endpoints (/registrations/mine,
// /certificates/mine) and the strip is hidden when they fail rather than
// rendering three zeroes. The Backstage row appears for staff only, with a live
// mark when a shift is running now (/shifts/mine).

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { formatDepartmentLabel } from '../../helpers/department-format.js';
import { PersonIcon } from '../../components/detail-icons/DetailIcons.jsx';
import '../settings/settings.css';
/* design/profile.css carries the `dsp-` rules and is loaded at the root, with
   the other design-system sheets. */

/*
 * Sentence case, held here. PROFILE_HUB_COPY is ALL-CAPS ("COLLEGE", "YEAR",
 * "Log Out") and carries the two destructive labels this screen no longer has;
 * it is left alone for anything still reading it.
 */
/*
 * The FIELD LABELS below are copied word for word from FIELD_COPY in
 * screens/edit-profile/ProfileFieldSet.jsx, which is the one place the profile
 * form is defined. Read view and edit view must name the same fact the same
 * way, or "Course" here and "Department" there become two fields in the reader's
 * head. If a label changes there, change it here.
 */
const COPY = {
  title: 'Profile',
  editProfile: 'Edit profile',
  statFests: 'Fests',
  statEvents: 'Events',
  statCertificates: 'Certificates',
  active: 'Active',
  yearSuffix: 'year',
  personal: 'Personal details',
  academic: 'College details',
  emailAddress: 'Email address',
  participantId: 'Participant ID',
  phone: 'Phone number',
  professionalEmail: 'Institutional email',
  college: 'College',
  usn: 'Register number',
  department: 'Course',
  year: 'Year of study',
  country: 'Country',
  countryValue: 'India',
  collegeAddress: 'College address',
  studentId: 'Student ID',
  studentIdUploaded: 'Uploaded',
};

// "3" -> "3rd" for the status line. Data formatting, not copy.
function ordinalOf(number) {
  const remainderTen = number % 10;
  const remainderHundred = number % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${number}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${number}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${number}rd`;
  return `${number}th`;
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

/*
 * A GROUP OF FACTS, and the rule that makes it worth having.
 *
 * `rows` arrives with a null value for every field the person has not filled,
 * and those are dropped here rather than rendered as an empty row or an em-dash
 * placeholder. A profile with three answers shows three lines. Ten labels with
 * seven blanks beside them is not "showing your data" — it is a checklist of
 * things you have not done, printed on the screen that is supposed to be about
 * who you are.
 *
 * The group itself disappears when nothing in it survives, so a student who
 * filled only their college never sees an empty "Personal details" heading.
 *
 * <dl>, not a table and not a list of divs: these are term/description pairs
 * and that is what a description list is for. Read-only throughout — the one
 * control that changes any of it is in the header.
 */
function DetailGroup({ label, rows }) {
  const filled = rows.filter((row) => row.value);
  if (filled.length === 0) {
    return null;
  }
  return (
    <div className="dsp-group">
      <h2 className="dsp-group__label">{label}</h2>
      <dl className="dsp-list">
        {filled.map((row) => (
          <div className="dsp-row" key={row.label}>
            <dt className="dsp-key">{row.label}</dt>
            <dd className="dsp-value">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ProfileScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuthentication();

  /* The whole college record, not just its name: the read view states the
     college address too, and that is city/state/pinCode off this same object —
     keeping it costs nothing and saves a second lookup. */
  const [college, setCollege] = useState(null);
  const [stats, setStats] = useState(null); // { festsAttended, eventsEntered, certificates }
  /*
   * The unread-alerts count, the saved-events count and the on-shift check all
   * went with the navigation rows they annotated. That removes three network
   * calls from every visit to Profile — the screen now fetches only the college
   * name and the stats it actually displays.
   */

  const loadDossier = useCallback(async () => {
    // The auth user carries only collegeId, so the name is a second read.
    if (currentUser?.collegeId) {
      apiClient
        .get('/colleges')
        .then((payload) => {
          const colleges = payload?.colleges ?? payload ?? [];
          setCollege(
            colleges.find((candidate) => candidate.id === currentUser.collegeId) ?? null,
          );
        })
        .catch(() => {});
    }

    try {
      const [registrations, certificates] = await Promise.all([
        apiClient.get('/registrations/mine'),
        apiClient.get('/certificates/mine'),
      ]);
      const registrationList = Array.isArray(registrations) ? registrations : [];
      const festIds = new Set(
        registrationList.map((registration) => registration.eventId?.festId?.id).filter(Boolean),
      );
      setStats({
        festsAttended: festIds.size,
        eventsEntered: registrationList.length,
        certificates: Array.isArray(certificates) ? certificates.length : 0,
      });
    } catch {
      setStats(null);
    }

  }, [currentUser]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDossier();
  }, [loadDossier]);

  if (!currentUser) {
    return (
      <div className="dst-screen">
        <div className="dst-col" role="status" aria-label="Loading your profile">
          <div className="dst-skel" style={{ height: '80px', width: '80px', margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  /* The chip is the account's STATE and nothing else now. It used to read
     "Active · 3rd year · CSE", which put the year and the course in a pill at
     the top and again in no list at all; both are proper rows below, so the
     chip is left saying the one thing only it can say. */
  const isActive = Boolean(currentUser.isProfileComplete);

  const photoUrl = currentUser.profilePictureUrl ?? '';
  const collegeName = college?.commonName ?? college?.collegeName ?? '';
  const collegeAddress = college
    ? [college.city, college.state, college.address?.pinCode].filter(Boolean).join(', ')
    : '';

  /* Every row is `label` + a value that is either a string or null. Falsy means
     "not filled" and DetailGroup drops it; nothing here decides what to show,
     it only decides what the value IS. */
  const personalRows = [
    /*
     * Email and participant ID are listed here even though the identity block
     * above already shows the email. Repeating it is deliberate: the list is
     * what somebody scans when they are checking their own details are right,
     * and a field that is missing from that list reads as a field the app does
     * not hold. The participant ID is the number a volunteer asks for at a gate,
     * so it belongs with the details rather than nowhere.
     */
    { label: COPY.emailAddress, value: currentUser.emailAddress ?? '' },
    { label: COPY.phone, value: currentUser.phoneNumber ?? '' },
    { label: COPY.participantId, value: currentUser.participantId ?? '' },
    { label: COPY.professionalEmail, value: currentUser.professionalEmail ?? '' },
  ];
  const academicRows = [
    { label: COPY.college, value: collegeName },
    { label: COPY.usn, value: currentUser.usn ?? '' },
    { label: COPY.department, value: formatDepartmentLabel(currentUser.department) },
    {
      label: COPY.year,
      value: currentUser.yearOfStudy
        ? `${ordinalOf(currentUser.yearOfStudy)} ${COPY.yearSuffix}`
        : '',
    },
    /* Country is stated only once there is a college record to attach it to.
       On an empty profile it is not a fact about the person, it is a constant
       the platform happens to have. */
    { label: COPY.country, value: collegeName ? COPY.countryValue : '' },
    { label: COPY.collegeAddress, value: collegeAddress },
    /* The image itself is not reproduced here — it is a photograph of an ID
       card, and the answer this screen owes is whether one is on file. */
    { label: COPY.studentId, value: currentUser.studentIdUrl ? COPY.studentIdUploaded : '' },
  ];

  return (
    <div className="dst-screen">
      {/* It USED to be a tab root, which is why it had no bar. It is not one
          any more: Profile is reached from the account drawer now, so arriving
          here is always a push and there has to be a way back out.

          EDIT LIVES IN THE ACTION SLOT. It used to be the single row at the
          bottom of the screen, which made it look like one more line of the
          data above it — the same height, the same hairline, the same left
          edge — so the one thing on the page you can press was the thing least
          distinguishable from the things you cannot. */}
      <ScreenHeader
        title={COPY.title}
        action={
          <button
            type="button"
            className="dsp-edit"
            onClick={() => navigate('/profile/edit')}
          >
            <PersonIcon size="sm" />
            {COPY.editProfile}
          </button>
        }
      />

      <div className="dst-col">
        <section className="dst-identity">
          {/* Display only here. The picture is CHANGED in the hub at /settings,
              where the upload, its progress and its failure all have room —
              having two controls that both open a file picker was one of the
              duplications this pass removed. */}
          <span className="dst-avatar dst-avatar--static" role="presentation">
            {photoUrl ? (
              <img className="dst-avatar__img" src={photoUrl} alt="" />
            ) : (
              <span className="dst-avatar__fallback" aria-hidden="true">
                {initialsOf(currentUser.fullName)}
              </span>
            )}
          </span>

          <div>
            <h2 className="dst-name">{currentUser.fullName}</h2>
            {/* The email stays here and appears nowhere else on the screen.
                The college, the year and the course used to be up here too, in
                the line and in the chip below; they are rows in the list now,
                because a fact said twice on one screen reads as two facts. */}
            <p className="dst-identity__line">{currentUser.emailAddress}</p>
          </div>

          {isActive ? <span className="dst-pill">{COPY.active}</span> : null}
        </section>

        {stats ? (
          <div className="dst-stats">
            <div className="dst-stat">
              <span className="dst-stat__value">{stats.festsAttended}</span>
              <span className="dst-stat__label">{COPY.statFests}</span>
            </div>
            <div className="dst-stat">
              <span className="dst-stat__value">{stats.eventsEntered}</span>
              <span className="dst-stat__label">{COPY.statEvents}</span>
            </div>
            <div className="dst-stat">
              <span className="dst-stat__value">{stats.certificates}</span>
              <span className="dst-stat__label">{COPY.statCertificates}</span>
            </div>
          </div>
        ) : null}

        {/*
         * THE "Your account" LIST IS GONE.
         *
         * It was eight rows of navigation — Registrations, Passes,
         * Certificates, Teams, Saved events, Alerts, Settings — and every one
         * of them is now in the account drawer you opened to get here. Arriving
         * at Profile from that menu only to be shown the same menu again is a
         * dead end dressed as a destination.
         *
         * What is left is what Profile is actually for: who you are, what you
         * have done, and the one control that changes it.
         */}
        <section className="dsp-details">
          <DetailGroup label={COPY.personal} rows={personalRows} />
          <DetailGroup label={COPY.academic} rows={academicRows} />
        </section>
      </div>
    </div>
  );
}

export default ProfileScreen;
