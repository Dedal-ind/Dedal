// AdminCreateEventScreen.jsx
// Route: /admin/events/create — create a new event under one of the
// administrator's fests. A three-step wizard (Event Setup · Staff · Review).
// The Staff step collects zero-or-more { email, role } rows; on submit the event
// is created FIRST (its id is required), then one POST
// /fests/:festId/staff/assign call per row with eventIds: [newEventId]. A failed
// assignment never rolls the created event back — the wizard reports per-row
// results and offers a retry for the failed rows only.
//
// The whole form maps to POST /fests/:festId/events (confirmed against
// event-routes/controller/validator/field-parsers). Create always yields a DRAFT
// — status is not a writable field — so "Publish Event" creates and then calls
// POST /fests/:festId/events/:eventId/publish. Poster images go through
// POST /uploads first, and the returned URL rides along as posterImageUrl.
//
// Publishing is therefore two calls, and the second can fail on its own — so the
// created event's id is retained and a retry resumes from it rather than
// creating a duplicate.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trash2, AlertTriangle, UserPlus, CheckCircle2, X } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTextarea from '../../components-admin/admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveCheckbox from '../../components-admin/admin-executive-checkbox/AdminExecutiveCheckbox.jsx';
import AdminSegmentedToggle from '../../components-admin/admin-segmented-toggle/AdminSegmentedToggle.jsx';
import AdminStepIndicator from '../../components-admin/admin-step-indicator/AdminStepIndicator.jsx';
import AdminOffersEditor from '../../components-admin/admin-offers-editor/AdminOffersEditor.jsx';
import AdminCollapsibleSection from '../../components-admin/admin-collapsible-section/AdminCollapsibleSection.jsx';
import AdminPosterUpload from '../../components-admin/admin-poster-upload/AdminPosterUpload.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminCategorySelect from '../../components-admin/admin-category-select/AdminCategorySelect.jsx';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import {
  ADMIN_CREATE_EVENT_COPY as COPY,
  ADMIN_FEST_OFFERS_COPY,
} from '../../brand-admin/brand-copy.js';
import {
  emptyEventForm,
  validateEventSetup,
  isSetupMinimallyFilled,
  buildEventPayload,
  describeEventDuration,
  eventToForm,
} from '../../helpers/admin-event-form.js';

const CANCEL_ROUTE = '/admin/overview';
const EVENT_ACCESS_ROUTE = '/admin/events/access';

// Backend validation-detail keys → the form field the message should attach to.
const SERVER_FIELD_MAP = {
  eventName: 'eventName',
  description: 'description',
  venue: 'venue',
  feeAmountPaise: 'feeAmountRupees',
  capacity: 'capacity',
  minimumTeamSize: 'teamSizes',
  maximumTeamSize: 'teamSizes',
  startsAt: 'schedule',
  endsAt: 'schedule',
  registrationOpensAt: 'registration',
  registrationClosesAt: 'registration',
  parentEventId: 'parentEventId',
  category: 'category',
  scoringFormat: 'scoringFormat',
};

function mapServerErrors(details) {
  const mapped = {};
  if (details && typeof details === 'object') {
    for (const [key, reason] of Object.entries(details)) {
      mapped[SERVER_FIELD_MAP[key] ?? key] = typeof reason === 'string' ? reason : COPY.errors.submitFailed;
    }
  }
  return mapped;
}

/*
 * The publish call rejects with INVALID_FEST_STATE while the parent fest is a
 * draft — the default state a fest is created in. The backend message names the
 * fest status but not the way out, so the remedy is spelled out here.
 */
function buildSubmitErrorMessage(submitException) {
  if (submitException.code === 'INVALID_FEST_STATE') {
    return `${submitException.message} ${COPY.errors.publishFestFirst}`;
  }
  return submitException.message || COPY.errors.submitFailed;
}

// A small red line under a grouped field (schedule, registration, team sizes).
function FieldError({ message }) {
  if (!message) {
    return null;
  }
  return (
    <p className="flex items-center gap-1.5 font-admin-body text-[13px] text-admin-status-error-red">
      <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
      {message}
    </p>
  );
}

function SectionHeading({ children }) {
  return (
    <h3 className="font-admin-display text-[16px] font-semibold leading-6 text-admin-neutral-ink">{children}</h3>
  );
}

import { EMAIL_ADDRESS_PATTERN } from '@dedal/shared';

// The per-row message for a failed assign call, from the codes the backend
// actually returns; VALIDATION_FAILED carries a field detail worth echoing.
function formatAssignmentErrorMessage(error) {
  if (error?.code === 'VALIDATION_FAILED' && error.details?.emailAddress) {
    return `Email ${error.details.emailAddress}.`;
  }
  return (
    COPY.assignmentErrors[error?.code] ?? error?.message ?? COPY.assignmentErrors.fallback
  );
}

function AdminCreateEventScreen() {
  const navigate = useNavigate();
  /*
   * EDIT MODE: /admin/events/create?festId=…&editEventId=… opens this same
   * wizard pre-filled with the event's stored values, and Submit PATCHes the
   * event instead of creating one. One form, one validation path, two verbs —
   * the alternative (a second full-field form) would drift from this one on
   * every future field.
   */
  const [searchParams] = useSearchParams();
  const editEventId = searchParams.get('editEventId');
  const editFestId = searchParams.get('festId');
  const isEditMode = Boolean(editEventId && editFestId);
  const [editLoadState, setEditLoadState] = useState(isEditMode ? 'loading' : 'idle');
  const [form, setForm] = useState(emptyEventForm);
  // Step 0's mode chooser: null until the admin picks. 'fest' is today's flow;
  // 'independent' skips the fest picker — the backend wraps the event in an
  // invisible solo container fest (POST /events/independent).
  const [creationMode, setCreationMode] = useState(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // The id of the event this wizard already created. Publishing is a second call
  // that can fail on its own (most often because the parent fest is still a
  // draft), so a retry must resume from this id rather than create a twin.
  const [createdEventId, setCreatedEventId] = useState('');
  // '' while the wizard is still editing; 'published' or 'draft' once the event
  // exists, which is what the closing success card reads.
  const [outcome, setOutcome] = useState('');
  const { currentUser } = useAuthentication();

  /*
   * Staff rows the admin adds on the Staff step. Each row tracks its own
   * assignment outcome so a partial failure after the event is created can be
   * reported and retried per row — the created event is never rolled back.
   * status: 'idle' | 'success' | 'failed'.
   */
  const [staffRows, setStaffRows] = useState([]);
  const [isAssignmentReportVisible, setIsAssignmentReportVisible] = useState(false);

  /*
   * The bulk add form. One textarea takes any number of addresses separated by
   * commas or newlines; ADD STAFF parses them, rejects the ones the backend
   * would refuse anyway (malformed, self, already listed), and stages the rest.
   * They are assigned for real once the event exists — the assign call needs its
   * id, and for an independent event even the fest does not exist yet.
   */
  const [bulkEmails, setBulkEmails] = useState('');
  const [bulkRole, setBulkRole] = useState('coordinator');
  const [bulkContactPhone, setBulkContactPhone] = useState('');
  const [bulkError, setBulkError] = useState('');

  // Split on commas, semicolons, whitespace and newlines alike; an admin pasting
  // a column out of a spreadsheet must not have to reformat it.
  function parseEmailList(rawValue) {
    return String(rawValue || '')
      .split(/[\s,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }

  /*
   * Stage every address in the textarea under the chosen role. Rejections are
   * reported per address rather than failing the whole paste — nine good rows out
   * of ten should not be lost to one typo.
   */
  function addStaffFromBulk() {
    const parsed = parseEmailList(bulkEmails);
    if (parsed.length === 0) {
      setBulkError(COPY.staffNoValidEmails);
      return;
    }
    const ownEmail = (currentUser?.emailAddress ?? '').toLowerCase();
    const alreadyListed = new Set(staffRows.map((row) => row.emailAddress));
    const rejected = [];
    const accepted = [];
    for (const email of parsed) {
      if (!EMAIL_ADDRESS_PATTERN.test(email)) {
        rejected.push(`${email} — ${COPY.staffInvalidEmailError}`);
      } else if (email === ownEmail) {
        rejected.push(`${email} — ${COPY.staffSelfError}`);
      } else if (alreadyListed.has(email) || accepted.some((row) => row.emailAddress === email)) {
        rejected.push(`${email} — ${COPY.staffDuplicateError}`);
      } else {
        accepted.push({
          emailAddress: email,
          role: bulkRole,
          contactPhone: bulkContactPhone.trim(),
          status: 'idle',
          errorMessage: '',
        });
      }
    }
    setStaffRows((previous) => [...previous, ...accepted]);
    setBulkError(rejected.join(' · '));
    if (accepted.length > 0) {
      setBulkEmails('');
      setBulkContactPhone('');
    }
  }

  function removeStaffRow(rowIndex) {
    setStaffRows((previous) => previous.filter((unused, index) => index !== rowIndex));
  }

  /*
   * One assign call per not-yet-successful row, sequentially so per-row results
   * stay attributable. Returns whether every row (including previously
   * succeeded ones) is now assigned.
   */
  async function runStaffAssignments(eventId, festIdOverride = null) {
    // festIdOverride: the independent flow creates its wrapper fest inside the
    // same submit, so React state cannot carry the id to this call in time.
    const assignmentFestId = festIdOverride ?? form.festId;
    const results = [...staffRows];
    for (let index = 0; index < results.length; index += 1) {
      if (results[index].status === 'success') {
        continue;
      }
      try {
        /*
         * The access window is deliberately NOT sent: the backend derives it from
         * the event's own schedule and the role (a coordinator opens two days
         * ahead, a volunteer gets an auto-created shift from three hours before
         * the start to the end). Sending a client-computed window would be a
         * second source of truth for the same rule.
         */
        const assignPayload = {
          emailAddress: results[index].emailAddress.trim().toLowerCase(),
          role: results[index].role,
          eventIds: [eventId],
        };
        if (results[index].contactPhone) {
          assignPayload.assignmentContactPhone = results[index].contactPhone;
        }
        await apiClient.post(`/fests/${assignmentFestId}/staff/assign`, assignPayload);
        results[index] = { ...results[index], status: 'success', errorMessage: '' };
      } catch (assignError) {
        results[index] = {
          ...results[index],
          status: 'failed',
          errorMessage: formatAssignmentErrorMessage(assignError),
        };
      }
    }
    setStaffRows(results);
    return results.every((row) => row.status === 'success');
  }

  async function handleRetryFailedAssignments() {
    if (!createdEventId) {
      return;
    }
    setSubmitting(true);
    const allAssigned = await runStaffAssignments(createdEventId);
    setSubmitting(false);
    if (allAssigned) {
      setIsAssignmentReportVisible(false);
    }
  }

  const [fests, setFests] = useState([]);
  const [parentEvents, setParentEvents] = useState([]);
  const [openSections, setOpenSections] = useState({ additional: false, parent: false, questions: false });

  // Load the administrator's fests; preselect when there is exactly one.
  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/fests/mine')
      .then((list) => {
        if (!isActive) {
          return;
        }
        const festList = Array.isArray(list) ? list : [];
        setFests(festList);
        if (festList.length === 1) {
          setForm((previous) => ({ ...previous, festId: festList[0].id }));
        }
      })
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, []);

  // Load candidate parent events whenever the chosen fest changes. The backend
  // accepts any event in the fest as a parent (it does not restrict by depth), so
  // every fest event is offered.
  useEffect(() => {
    if (!form.festId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParentEvents([]);
      return undefined;
    }
    let isActive = true;
    apiClient
      .get(`/fests/${form.festId}/events/all`)
      .then((list) => {
        if (isActive) {
          setParentEvents(Array.isArray(list) ? list : []);
        }
      })
      .catch(() => {
        if (isActive) {
          setParentEvents([]);
        }
      });
    return () => {
      isActive = false;
    };
  }, [form.festId]);

  const updateField = useCallback((name, value) => {
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => {
      if (!previous[name]) {
        return previous;
      }
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }, []);

  /*
   * FAQ mutations. An FAQ is two free-text halves and nothing else — no type, no
   * options, no required flag — because the organiser is writing an answer, not
   * designing an input.
   */
  const addFaq = () =>
    setForm((previous) => ({ ...previous, faqs: [...previous.faqs, { question: '', answer: '' }] }));
  const updateFaq = (index, field, value) =>
    setForm((previous) => ({
      ...previous,
      faqs: previous.faqs.map((faq, faqIndex) =>
        faqIndex === index ? { ...faq, [field]: value } : faq,
      ),
    }));
  const removeFaq = (index) =>
    setForm((previous) => ({
      ...previous,
      faqs: previous.faqs.filter((_, faqIndex) => faqIndex !== index),
    }));

  const festOptions = useMemo(
    () =>
      fests
        // Solo containers wrap exactly one independent event; adding more events
        // requires "Convert to full fest" first, so they are not offered here.
        .filter((fest) => !fest.isSoloContainer)
        .map((fest) => ({ value: fest.id, label: fest.festName })),
    [fests],
  );
  const parentOptions = useMemo(
    () => parentEvents.map((event) => ({ value: event.id, label: event.eventName })),
    [parentEvents],
  );
  const isIndependent = creationMode === 'independent';
  /*
   * The parent fest's active add-ons, for the read-only notice above. Read from
   * the already-loaded fest list rather than fetched: /fests/mine returns whole
   * fest documents, so the offers are in hand and a second request would only
   * add a way for this panel to be empty while the fest has offers.
   */
  const selectedFest = fests.find((fest) => fest.id === form.festId) ?? null;
  const selectedFestName = selectedFest?.festName ?? 'the parent fest';
  const inheritedOffers = (selectedFest?.offers ?? []).filter(
    (offer) => offer.isActive !== false,
  );
  const setupFilled = isSetupMinimallyFilled(form, isIndependent);

  function handleNextFromSetup() {
    const setupErrors = validateEventSetup(form, COPY.errors, isIndependent);
    setErrors(setupErrors);
    if (Object.keys(setupErrors).length === 0) {
      setServerError('');
      setStep(1);
    }
  }

  useEffect(() => {
    if (!isEditMode) {
      return;
    }
    let isStale = false;
    (async () => {
      try {
        const event = await apiClient.get(`/fests/${editFestId}/events/${editEventId}`);
        if (isStale) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm(eventToForm(event, editFestId));
        setCreationMode('fest');
        setStep(0);
        setEditLoadState('ready');
      } catch {
        if (!isStale) setEditLoadState('error');
      }
    })();
    return () => { isStale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, editFestId, editEventId]);

  async function handleSubmit(shouldPublish) {
    const setupErrors = validateEventSetup(form, COPY.errors, isIndependent);
    if (Object.keys(setupErrors).length > 0) {
      setErrors(setupErrors);
      setStep(0);
      return;
    }
    setSubmitting(true);
    setServerError('');
    if (isEditMode) {
      /*
       * PATCH, not POST: updateEvent assigns field-by-field then save(), so the
       * schema's cross-field hooks run and a reschedule re-syncs the
       * registration window. On success, straight back to Event Access — the
       * wizard's publish/staff steps belong to creation, not correction.
       */
      try {
        const payload = buildEventPayload(form);
        // parentEventId is structural; edits must not accidentally re-parent.
        delete payload.parentEventId;
        await apiClient.patch(`/fests/${editFestId}/events/${editEventId}`, payload);
        navigate(`/admin/events/access?festId=${editFestId}`);
      } catch (editException) {
        setErrors(mapServerErrors(editException.details));
        setServerError(buildSubmitErrorMessage(editException));
        setStep(0);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    let eventId = createdEventId;
    let festIdForCalls = form.festId;
    try {
      if (!eventId) {
        const payload = buildEventPayload(form);
        if (isIndependent) {
          // One call creates the wrapper fest AND the event; every later call
          // (publish, staff assignment) is ordinary fest-scoped API.
          const created = await apiClient.post('/events/independent', payload);
          eventId = created.event.id;
          festIdForCalls = created.fest.id;
          setForm((previous) => ({ ...previous, festId: created.fest.id }));
        } else {
          const createdEvent = await apiClient.post(`/fests/${form.festId}/events`, payload);
          eventId = createdEvent.id;
        }
        setCreatedEventId(eventId);
      }
      if (shouldPublish) {
        /*
         * A draft fest refuses to hold a published event (INVALID_FEST_STATE), so
         * the fest goes first when it is still a draft. The independent flow is
         * exempt: publishing the event publishes its invisible wrapper fest
         * server-side, and there is no separate fest action in that flow.
         */
        const parentFest = fests.find((fest) => fest.id === festIdForCalls);
        if (!isIndependent && parentFest?.status === 'draft') {
          await apiClient.post(`/fests/${festIdForCalls}/publish`);
          setFests((previous) =>
            previous.map((fest) =>
              fest.id === festIdForCalls ? { ...fest, status: 'published' } : fest,
            ),
          );
        }
        await apiClient.post(`/fests/${festIdForCalls}/events/${eventId}/publish`);
      }
    } catch (submitException) {
      setErrors(mapServerErrors(submitException.details));
      setServerError(buildSubmitErrorMessage(submitException));
      // Once the event exists, the only thing left to retry is the publish, so
      // the admin stays on the review step instead of being sent back to a form
      // whose next submit would create a second event.
      setStep(eventId ? 2 : 0);
      setSubmitting(false);
      return;
    }

    /*
     * The event now exists; assignments run AFTER it (the id is required). A
     * failed assignment must not throw into the catch above — the event is kept,
     * the per-row report shows what succeeded and what failed, and only the
     * failed rows are retried. Losing a created event to a typo'd email would be
     * far worse than a partial result.
     */
    const allAssigned =
      staffRows.length === 0 ? true : await runStaffAssignments(eventId, festIdForCalls);
    setSubmitting(false);
    // The outcome card replaces the old silent bounce to the dashboard: an admin
    // who pressed "Save as Draft" must be told the event is NOT live, and where
    // to publish it from.
    setOutcome(shouldPublish ? 'published' : 'draft');
    setStep(2);
    setIsAssignmentReportVisible(!allAssigned);
  }

  const isTeam = form.eventType === 'team';
  const isPaid = form.feeMode === 'paid';
  const isVirtual = form.locationType === 'virtual';
  const eventDuration = describeEventDuration(form);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <div className="flex flex-col gap-4">
        <AdminStepIndicator
          steps={COPY.steps}
          currentIndex={step}
          /* Once the event exists, stepping back would offer an edit this wizard
             cannot make (create is a one-shot call) — so the header locks. */
          onStepSelect={(index) => !outcome && index < step && setStep(index)}
        />
      </div>

      <AdminErrorBanner message={serverError} />

      {/* STEP 0 — WHERE DOES THIS EVENT LIVE? Two cards; the form appears only
          after a choice. "Independent" skips fest selection entirely. */}
      {isEditMode && editLoadState === 'loading' ? (
        <div className="flex h-[40vh] items-center justify-center">
          <span aria-label="Loading" className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue" />
        </div>
      ) : null}
      {isEditMode && editLoadState === 'error' ? (
        <p className="py-6 font-admin-body text-[14px] text-admin-status-error-red">
          Could not load this event for editing. Go back and try again.
        </p>
      ) : null}
      {step === 0 && creationMode === null && !isEditMode ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { mode: 'fest', title: COPY.modeFestTitle, body: COPY.modeFestBody },
            { mode: 'independent', title: COPY.modeIndependentTitle, body: COPY.modeIndependentBody },
          ].map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => setCreationMode(option.mode)}
              className="cursor-pointer rounded-lg border-2 border-admin-slate-200 bg-admin-surface-white p-6 text-left transition-colors hover:border-admin-primary-blue"
            >
              <p className="font-admin-display text-[17px] font-semibold text-admin-neutral-ink">
                {option.title}
              </p>
              <p className="mt-2 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                {option.body}
              </p>
            </button>
          ))}
        </div>
      ) : null}

      {/* STEP 1 — EVENT SETUP */}
      {step === 0 && creationMode !== null ? (
        <AdminExecutiveCard>
          <div className="flex flex-col gap-8">
            {creationMode === 'independent' ? (
              <p className="rounded-md border border-admin-primary-blue/30 bg-admin-primary-blue/5 px-4 py-3 font-admin-body text-[13px] leading-[18px] text-admin-neutral-ink">
                {COPY.independentBanner}
              </p>
            ) : (
              /* Fest selector — fest mode only */
              <AdminExecutiveSelect
                label={COPY.festLabel}
                required
                placeholder={COPY.festPlaceholder}
                helperText={fests.length === 0 ? COPY.noFests : COPY.festHelper}
                options={festOptions}
                value={form.festId}
                onChange={(event) => updateField('festId', event.target.value)}
                errorMessage={errors.festId}
              />
            )}

            {/* Identity */}
            <section className="flex flex-col gap-4">
              <SectionHeading>{COPY.identityHeading}</SectionHeading>
              <AdminExecutiveInput
                label={COPY.nameLabel}
                required
                placeholder={COPY.namePlaceholder}
                value={form.eventName}
                onChange={(event) => updateField('eventName', event.target.value)}
                errorMessage={errors.eventName}
              />
              <AdminExecutiveTextarea
                label={COPY.descriptionLabel}
                required
                rows={3}
                maxLength={2000}
                placeholder={COPY.descriptionPlaceholder}
                value={form.description}
                onChange={(event) => updateField('description', event.target.value)}
                errorMessage={errors.description}
              />
              <AdminPosterUpload
                label={COPY.posterLabel}
                value={form.posterImageUrl}
                onChange={(url) => updateField('posterImageUrl', url)}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/*
                  Was an AdminExecutiveSelect over a fixed option list, which made
                  the backend enum the ceiling on what a college could run. Now a
                  free-text field with the same list as suggestions.
                */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="event-category"
                    className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink"
                  >
                    {COPY.categoryLabel}
                  </label>
                  <AdminCategorySelect
                    inputId="event-category"
                    value={form.category}
                    onChange={(categoryValue) => updateField('category', categoryValue)}
                    placeholder={COPY.categoryPlaceholder}
                    hasError={Boolean(errors.category)}
                  />
                  <p
                    className={[
                      'font-admin-body text-[13px] leading-[18px]',
                      errors.category ? 'text-admin-status-error-red' : 'text-admin-slate-600',
                    ].join(' ')}
                  >
                    {errors.category ?? COPY.categoryHelperText}
                  </p>
                </div>
                <AdminExecutiveSelect
                  label={COPY.scoringLabel}
                  options={COPY.scoringOptions}
                  value={form.scoringFormat}
                  onChange={(event) => updateField('scoringFormat', event.target.value)}
                  errorMessage={errors.scoringFormat}
                />
              </div>
              <AdminSegmentedToggle
                label={COPY.typeLabel}
                options={COPY.typeOptions}
                value={form.eventType}
                onChange={(value) => updateField('eventType', value)}
              />
              {isTeam ? (
                <div className="flex flex-col gap-1.5">
                  <div className="grid grid-cols-2 gap-4">
                    <AdminExecutiveInput
                      label={COPY.minTeamLabel}
                      type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                      min={2}
                      value={form.minimumTeamSize}
                      onChange={(event) => updateField('minimumTeamSize', event.target.value)}
                    />
                    <AdminExecutiveInput
                      label={COPY.maxTeamLabel}
                      type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                      min={2}
                      value={form.maximumTeamSize}
                      onChange={(event) => updateField('maximumTeamSize', event.target.value)}
                    />
                  </div>
                  <FieldError message={errors.teamSizes} />
                </div>
              ) : (
                /*
                 * Solo: the team-size pair is not disabled, it is absent — team
                 * sizes are meaningless for an event one person registers for,
                 * and the payload omits them so the model's 1/1 default stands.
                 * The line says so, rather than leaving a gap the admin reads as
                 * a field that failed to render.
                 */
                <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                  {COPY.soloTeamSizeNote}
                </p>
              )}
            </section>

            {/* Schedule */}
            <section className="flex flex-col gap-4">
              <SectionHeading>{COPY.scheduleHeading}</SectionHeading>
              {/*
                * The end DATE input. The form model, validation and multi-day
                * maths (admin-event-form.js) supported endDate all along — the
                * input was simply never rendered, so every event was forced
                * same-day. Empty still means same-day, so a one-day event costs
                * no extra click and nothing existing changes behaviour.
                */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <AdminExecutiveInput
                  label={COPY.eventDateLabel}
                  type="date"
                  value={form.eventDate}
                  onChange={(event) => updateField('eventDate', event.target.value)}
                />
                <AdminExecutiveInput
                  label={COPY.startTimeLabel}
                  type="time"
                  value={form.startTime}
                  onChange={(event) => updateField('startTime', event.target.value)}
                />
                <AdminExecutiveInput
                  label={COPY.endDateLabel ?? 'End date (optional)'}
                  type="date"
                  value={form.endDate}
                  min={form.eventDate || undefined}
                  onChange={(event) => updateField('endDate', event.target.value)}
                />
                <AdminExecutiveInput
                  label={COPY.endTimeLabel}
                  type="time"
                  value={form.endTime}
                  onChange={(event) => updateField('endTime', event.target.value)}
                />
              </div>
              <FieldError message={errors.schedule} />
              {/*
                Duration, not a "how many days" input: the event model has no
                durationDays field — an event runs from startsAt to endsAt, and
                this form's single date makes that one day. Shown read-only for
                BOTH solo and team events so the length is never a guess.
              */}
              <div className="flex flex-col gap-1.5 rounded-md border border-admin-slate-200 bg-admin-surface-off-white px-3 py-2.5">
                <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
                  {COPY.durationLabel}
                </span>
                <span className="font-admin-mono text-[13px] text-admin-neutral-ink">
                  {eventDuration ?? COPY.durationUnset}
                </span>
                {eventDuration ? (
                  <span className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                    {COPY.durationHelper}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
                  {COPY.regOpensLabel}
                </span>
                <div className="grid grid-cols-2 gap-2 sm:max-w-[420px]">
                  <AdminExecutiveInput
                    type="date"
                    value={form.regOpensDate}
                    onChange={(event) => updateField('regOpensDate', event.target.value)}
                  />
                  <AdminExecutiveInput
                    type="time"
                    value={form.regOpensTime}
                    onChange={(event) => updateField('regOpensTime', event.target.value)}
                  />
                </div>
                {/* Says where the closing decision actually lives, so its absence
                    here reads as deliberate rather than as a missing field. */}
                <span className="font-admin-body text-[12px] leading-[18px] text-admin-slate-600">
                  {COPY.regStaysOpenNote}
                </span>
              </div>
              <FieldError message={errors.registration} />
            </section>

            {/* Location */}
            <section className="flex flex-col gap-4">
              <SectionHeading>{COPY.locationHeading}</SectionHeading>
              <AdminSegmentedToggle
                label={COPY.locationTypeLabel}
                options={COPY.locationTypeOptions}
                value={form.locationType}
                onChange={(value) => updateField('locationType', value)}
              />
              {isVirtual ? (
                <AdminExecutiveInput
                  label={COPY.meetingLinkLabel}
                  placeholder={COPY.meetingLinkPlaceholder}
                  helperText={COPY.virtualNote}
                  value={form.meetingLink}
                  onChange={(event) => updateField('meetingLink', event.target.value)}
                  errorMessage={errors.meetingLink || errors.venue}
                />
              ) : (
                <AdminExecutiveInput
                  label={COPY.venueLabel}
                  placeholder={COPY.venuePlaceholder}
                  value={form.venue}
                  onChange={(event) => updateField('venue', event.target.value)}
                  errorMessage={errors.venue}
                />
              )}
            </section>

            {/* Capacity & pricing */}
            <section className="flex flex-col gap-4">
              <SectionHeading>{COPY.capacityHeading}</SectionHeading>
              <AdminExecutiveInput
                label={COPY.capacityLabel}
                type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                min={1}
                placeholder={COPY.capacityPlaceholder}
                helperText={COPY.capacityHelper}
                value={form.capacity}
                onChange={(event) => updateField('capacity', event.target.value)}
                errorMessage={errors.capacity}
              />
              {/*
                Only meaningful once a capacity exists: an unlimited event can
                never be full, so it can never have a queue. Hidden rather than
                disabled, so it does not read as a setting that failed to apply.
              */}
              {form.capacity ? (
                <AdminSegmentedToggle
                  label={COPY.waitlistLabel}
                  options={COPY.waitlistOptions}
                  value={form.waitlistEnabled ? 'on' : 'off'}
                  onChange={(value) => updateField('waitlistEnabled', value === 'on')}
                />
              ) : null}
              <AdminSegmentedToggle
                label={COPY.feeTypeLabel}
                options={COPY.feeOptions}
                value={form.feeMode}
                onChange={(value) => updateField('feeMode', value)}
              />
              {isPaid ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <AdminExecutiveInput
                    label={COPY.feeAmountLabel}
                    type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                    min={1}
                    placeholder={COPY.feeAmountPlaceholder}
                    value={form.feeAmountRupees}
                    onChange={(event) => updateField('feeAmountRupees', event.target.value)}
                    errorMessage={errors.feeAmountRupees}
                  />
                  {isTeam ? (
                    <AdminSegmentedToggle
                      label={COPY.feeStructureLabel}
                      options={COPY.feeStructureOptions}
                      value={form.feeStructure}
                      onChange={(value) => updateField('feeStructure', value)}
                    />
                  ) : null}
                </div>
              ) : null}
            </section>

            {/* Additional (collapsible) */}
            <AdminCollapsibleSection
              title={COPY.additionalHeading}
              isOpen={openSections.additional}
              onToggle={() => setOpenSections((s) => ({ ...s, additional: !s.additional }))}
            >
              <div className="flex flex-col gap-4">
                <AdminExecutiveTextarea
                  label={COPY.rulesLabel}
                  rows={4}
                  maxLength={5000}
                  placeholder={COPY.rulesPlaceholder}
                  value={form.rules}
                  onChange={(event) => updateField('rules', event.target.value)}
                />
                <AdminExecutiveInput
                  label={COPY.prizeLabel}
                  placeholder={COPY.prizePlaceholder}
                  value={form.prizePoolDescription}
                  onChange={(event) => updateField('prizePoolDescription', event.target.value)}
                />
                <AdminExecutiveCheckbox
                  label={COPY.medicalLabel}
                  description={COPY.medicalDescription}
                  checked={form.requiresMedicalDeclaration}
                  onChange={(checked) => updateField('requiresMedicalDeclaration', checked)}
                />
                {/*
                  * ADD-ONS BELONG TO ONE LEVEL, NOT BOTH.
                  *
                  * An event UNDER a fest inherits the fest's offers — the
                  * registration form already unions fest.offers with
                  * event.offers, so a second "Food" configured here would render
                  * beside the fest's "Food" as two separate purchasable add-ons
                  * at two different rates. Participants cannot tell which one
                  * they need, and the counters cannot either. So the editor is
                  * hidden and what is inherited is stated instead.
                  *
                  * An INDEPENDENT event has no parent fest to inherit from (its
                  * invisible solo-container fest is created for it), so it is the
                  * only place add-ons are configured directly.
                  */}
                {isIndependent ? (
                  <AdminOffersEditor
                    offers={form.offers}
                    onChange={(offers) => updateField('offers', offers)}
                    scopeLabel={ADMIN_FEST_OFFERS_COPY.eventScopeIntro}
                  />
                ) : (
                  <div className="rounded-md border border-admin-slate-200 bg-admin-surface-off-white p-4">
                    <h3 className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
                      {COPY.inheritedOffersHeading}
                    </h3>
                    <p className="mt-1 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                      {inheritedOffers.length > 0
                        ? COPY.inheritedOffersIntro(
                            selectedFestName,
                            inheritedOffers.map((offer) => offer.offerName).join(', '),
                          )
                        : COPY.inheritedOffersEmpty(selectedFestName)}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <AdminExecutiveInput
                    label={COPY.weightLabel}
                    helperText={COPY.commaSeparatedHint}
                    value={form.weightCategories}
                    onChange={(event) => updateField('weightCategories', event.target.value)}
                  />
                  <AdminExecutiveInput
                    label={COPY.genderLabel}
                    helperText={COPY.commaSeparatedHint}
                    value={form.genderCategories}
                    onChange={(event) => updateField('genderCategories', event.target.value)}
                  />
                  <AdminExecutiveInput
                    label={COPY.ageLabel}
                    helperText={COPY.commaSeparatedHint}
                    value={form.ageCategories}
                    onChange={(event) => updateField('ageCategories', event.target.value)}
                  />
                </div>
              </div>
            </AdminCollapsibleSection>

            {/* Parent event (collapsible) */}
            <AdminCollapsibleSection
              title={COPY.parentHeading}
              isOpen={openSections.parent}
              onToggle={() => setOpenSections((s) => ({ ...s, parent: !s.parent }))}
            >
              <div className="flex flex-col gap-4">
                <AdminExecutiveCheckbox
                  label={COPY.nestLabel}
                  description={COPY.nestDescription}
                  checked={form.nestUnderParent}
                  onChange={(checked) => updateField('nestUnderParent', checked)}
                />
                {form.nestUnderParent ? (
                  <>
                    <AdminExecutiveSelect
                      label={COPY.parentSelectLabel}
                      placeholder={COPY.parentPlaceholder}
                      helperText={COPY.parentHelper}
                      options={parentOptions}
                      value={form.parentEventId}
                      onChange={(event) => updateField('parentEventId', event.target.value)}
                      errorMessage={errors.parentEventId}
                    />
                    {form.parentEventId ? (
                      <p className="font-admin-body text-[13px] text-admin-slate-600">
                        {COPY.parentPreviewLabel}:{' '}
                        <span className="font-medium text-admin-neutral-ink">
                          {parentOptions.find((option) => option.value === form.parentEventId)?.label}
                        </span>
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </AdminCollapsibleSection>

            {/* FAQs (collapsible) */}
            <AdminCollapsibleSection
              title={COPY.faqsHeading}
              badge={form.faqs.length > 0 ? String(form.faqs.length) : undefined}
              isOpen={openSections.questions}
              onToggle={() => setOpenSections((s) => ({ ...s, questions: !s.questions }))}
            >
              <div className="flex flex-col gap-4">
                <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                  {COPY.faqsIntro}
                </p>

                {form.faqs.length === 0 ? (
                  <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.noFaqs}</p>
                ) : (
                  form.faqs.map((faq, index) => (
                    <div
                      key={index}
                      className="flex flex-col gap-3 rounded-md border border-admin-slate-200 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-admin-body text-[12px] font-semibold uppercase tracking-wide text-admin-slate-600">
                          {COPY.faqEntryLabel(index + 1)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFaq(index)}
                          aria-label={COPY.removeFaq}
                          className="rounded p-1 text-admin-slate-600 transition-colors hover:bg-admin-surface-off-white hover:text-admin-status-error-red"
                        >
                          <X size={16} strokeWidth={1.75} />
                        </button>
                      </div>
                      <AdminExecutiveInput
                        label={COPY.faqQuestionLabel}
                        placeholder={COPY.faqQuestionPlaceholder}
                        value={faq.question}
                        onChange={(event) => updateFaq(index, 'question', event.target.value)}
                      />
                      <AdminExecutiveTextarea
                        label={COPY.faqAnswerLabel}
                        placeholder={COPY.faqAnswerPlaceholder}
                        rows={3}
                        value={faq.answer}
                        onChange={(event) => updateFaq(index, 'answer', event.target.value)}
                      />
                    </div>
                  ))
                )}
                <AdminExecutiveButton variant="secondary" size="small" onClick={addFaq}>
                  {COPY.addFaq}
                </AdminExecutiveButton>
              </div>
            </AdminCollapsibleSection>
          </div>

          {/*
            Footer nav. The two lifecycle actions live HERE as well as on the
            review step: an admin who has filled the form in and wants the event
            live should not have to walk two more screens to say so.
          */}
          <div className="mt-8 flex flex-col gap-3 border-t border-admin-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => navigate(CANCEL_ROUTE)}
              className="font-admin-body text-[14px] text-admin-slate-600 transition-colors hover:text-admin-neutral-ink"
            >
              {COPY.cancel}
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <AdminExecutiveButton
                variant="secondary"
                disabled={!setupFilled}
                loading={submitting}
                onClick={() => handleSubmit(false)}
              >
                {COPY.saveDraft}
              </AdminExecutiveButton>
              <AdminExecutiveButton
                variant="secondary"
                disabled={!setupFilled}
                loading={submitting}
                onClick={() => handleSubmit(true)}
              >
                {COPY.publishNow}
              </AdminExecutiveButton>
              <AdminExecutiveButton variant="primary" disabled={!setupFilled} onClick={handleNextFromSetup}>
                {COPY.next}
              </AdminExecutiveButton>
            </div>
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/* STEP 2 — STAFF */}
      {step === 1 ? (
        <AdminExecutiveCard title={COPY.staffHeading} description={COPY.staffIntro}>
          {/* The documented backend behaviour, made explicit so nobody assumes an
              unknown address silently did nothing. */}
          <p className="mb-4 rounded-md bg-admin-primary-blue/5 px-3 py-2 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
            {COPY.staffPendingInviteNote}
          </p>

          {/* What the assignment actually grants, per role — the two windows the
              backend derives, said out loud so nobody goes looking for a
              scheduling screen that no longer exists. */}
          <p className="mb-4 rounded-md bg-admin-surface-off-white px-3 py-2 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
            {COPY.staffAccessNote}
          </p>

          {/* The bulk add form: paste any number of addresses, pick one role. */}
          <div className="flex flex-col gap-4">
            <AdminExecutiveTextarea
              label={COPY.staffBulkLabel}
              rows={3}
              placeholder={COPY.staffBulkPlaceholder}
              helperText={COPY.staffBulkHelper}
              value={bulkEmails}
              onChange={(event) => {
                setBulkEmails(event.target.value);
                setBulkError('');
              }}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <fieldset className="flex flex-col gap-1.5">
                <legend className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
                  {COPY.staffRoleLabel}
                </legend>
                <div className="flex gap-2">
                  {COPY.staffRoleOptions.map((option) => (
                    <label
                      key={option.value}
                      className={[
                        'flex flex-1 cursor-pointer items-center gap-2.5 rounded-md border p-3 transition-colors',
                        bulkRole === option.value
                          ? 'border-admin-primary-blue bg-admin-primary-blue/5'
                          : 'border-admin-slate-200 hover:bg-admin-surface-off-white',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="staff-role"
                        value={option.value}
                        checked={bulkRole === option.value}
                        onChange={() => setBulkRole(option.value)}
                        className="h-4 w-4 accent-admin-primary-blue"
                      />
                      <span className="font-admin-body text-[14px] text-admin-neutral-ink">
                        {option.label}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <AdminExecutiveInput
                label={COPY.staffContactLabel}
                type="tel"
                placeholder={COPY.staffContactPlaceholder}
                value={bulkContactPhone}
                onChange={(event) => setBulkContactPhone(event.target.value)}
              />
            </div>
            {bulkError ? (
              <p className="font-admin-body text-[13px] leading-[18px] text-admin-status-error-red">
                {bulkError}
              </p>
            ) : null}
            <div>
              <AdminExecutiveButton variant="secondary" iconLeft={<UserPlus size={15} />} onClick={addStaffFromBulk}>
                {COPY.staffAddButton}
              </AdminExecutiveButton>
            </div>
          </div>

          {/* The staged list. Nothing is sent until the event exists — the assign
              call needs its id — so each row reads "Pending" until then. */}
          <div className="mt-6 border-t border-admin-slate-200 pt-5">
            <h3 className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
              {COPY.staffQueuedHeading}
            </h3>
            {staffRows.length === 0 ? (
              <p className="mt-2 font-admin-body text-[13px] text-admin-slate-600">
                {COPY.staffQueuedEmpty}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-admin-slate-200">
                {staffRows.map((row, index) => (
                  <li key={row.emailAddress} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-admin-body text-[14px] text-admin-neutral-ink">
                        {row.emailAddress}
                      </span>
                      <span className="block font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                        {COPY.staffRoleOptions.find((option) => option.value === row.role)?.label}
                        {row.contactPhone ? ` · ${row.contactPhone}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={[
                          'rounded-md px-2 py-0.5 font-admin-body text-[12px] font-semibold',
                          row.status === 'success'
                            ? 'bg-admin-status-success-green/10 text-admin-status-success-green'
                            : row.status === 'failed'
                              ? 'bg-admin-status-error-red/10 text-admin-status-error-red'
                              : 'bg-admin-surface-off-white text-admin-slate-600',
                        ].join(' ')}
                      >
                        {row.status === 'success'
                          ? COPY.assignmentRowSucceeded
                          : row.status === 'failed'
                            ? COPY.assignmentRowFailed
                            : COPY.staffQueuedPending}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStaffRow(index)}
                        aria-label={COPY.removeStaffRow}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-status-error-red/10 hover:text-admin-status-error-red"
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-8 flex flex-col gap-3 border-t border-admin-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="font-admin-body text-[14px] text-admin-slate-600 transition-colors hover:text-admin-neutral-ink"
            >
              {COPY.back}
            </button>
            <div className="flex flex-wrap items-center gap-3">
              <AdminExecutiveButton
                variant="secondary"
                loading={submitting}
                onClick={() => handleSubmit(false)}
              >
                {COPY.saveDraft}
              </AdminExecutiveButton>
              <AdminExecutiveButton
                variant="secondary"
                loading={submitting}
                onClick={() => handleSubmit(true)}
              >
                {COPY.publishNow}
              </AdminExecutiveButton>
              <AdminExecutiveButton variant="primary" onClick={() => setStep(2)}>
                {staffRows.length === 0 ? COPY.skipForNow : COPY.next}
              </AdminExecutiveButton>
            </div>
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/* Post-create staff assignment report — the event exists and is kept;
          this names which rows went through and which did not. */}
      {step === 2 && isAssignmentReportVisible ? (
        <AdminExecutiveCard
          title={COPY.assignmentReportHeading}
          description={COPY.assignmentReportBody}
        >
          <ul className="divide-y divide-admin-slate-200">
            {staffRows.map((row, index) => (
              <li key={index} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-admin-body text-[14px] text-admin-neutral-ink">
                    {row.emailAddress}
                    <span className="ml-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                      {COPY.staffRoleOptions.find((option) => option.value === row.role)?.label}
                    </span>
                  </p>
                  {row.status === 'failed' && row.errorMessage ? (
                    <p className="mt-0.5 font-admin-body text-[13px] leading-[18px] text-admin-status-error-red">
                      {row.errorMessage}
                    </p>
                  ) : null}
                </div>
                <span
                  className={[
                    'shrink-0 rounded-md px-2 py-0.5 font-admin-body text-[12px] font-semibold',
                    row.status === 'success'
                      ? 'bg-admin-status-success-green/10 text-admin-status-success-green'
                      : 'bg-admin-status-error-red/10 text-admin-status-error-red',
                  ].join(' ')}
                >
                  {row.status === 'success' ? COPY.assignmentRowSucceeded : COPY.assignmentRowFailed}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-admin-slate-200 pt-5">
            <button
              type="button"
              onClick={() => setIsAssignmentReportVisible(false)}
              className="font-admin-body text-[14px] text-admin-slate-600 transition-colors hover:text-admin-neutral-ink"
            >
              {COPY.finishWithoutRetry}
            </button>
            <AdminExecutiveButton
              variant="primary"
              loading={submitting}
              onClick={handleRetryFailedAssignments}
            >
              {COPY.retryFailedAssignments}
            </AdminExecutiveButton>
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/*
        The closing state. The wizard used to bounce silently to the dashboard,
        which said nothing about whether the event was live — the one fact the
        admin needs. Draft and published each say what happened and where to go.
      */}
      {step === 2 && outcome && !isAssignmentReportVisible ? (
        <AdminExecutiveCard>
          <div className="flex flex-col items-start gap-3 py-2">
            <CheckCircle2
              size={28}
              className="text-admin-status-success-green"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <h2 className="font-admin-display text-[20px] font-semibold leading-7 text-admin-neutral-ink">
              {outcome === 'published' ? COPY.successPublishedHeading : COPY.successDraftHeading}
            </h2>
            <p className="font-admin-body text-[14px] leading-5 text-admin-slate-600">
              {outcome === 'published' ? COPY.successPublishedBody : COPY.successDraftBody}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <AdminExecutiveButton
                variant="primary"
                onClick={() => navigate(`${EVENT_ACCESS_ROUTE}?festId=${form.festId}`)}
              >
                {COPY.goToEventAccess}
              </AdminExecutiveButton>
              <AdminExecutiveButton variant="ghost" onClick={() => navigate(CANCEL_ROUTE)}>
                {COPY.cancel}
              </AdminExecutiveButton>
            </div>
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/* STEP 3 — REVIEW */}
      {step === 2 && !outcome && !isAssignmentReportVisible ? (
        <AdminExecutiveCard title={COPY.reviewHeading} description={COPY.reviewIntro}>
          <ReviewSummary form={form} fests={fests} parentOptions={parentOptions} />
          <div className="mt-8 flex flex-col gap-3 border-t border-admin-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => setStep(0)}
              className="font-admin-body text-[14px] text-admin-slate-600 transition-colors hover:text-admin-neutral-ink"
            >
              {COPY.back}
            </button>
            <div className="flex items-center gap-3">
              <AdminExecutiveButton
                variant="secondary"
                loading={submitting}
                onClick={() => handleSubmit(false)}
              >
                {COPY.saveDraft}
              </AdminExecutiveButton>
              <AdminExecutiveButton variant="primary" loading={submitting} onClick={() => handleSubmit(true)}>
                {COPY.publishNow}
              </AdminExecutiveButton>
            </div>
          </div>
        </AdminExecutiveCard>
      ) : null}
    </div>
  );
}

// A labelled read-back row for the review step.
function ReviewRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-admin-slate-200 py-2.5 last:border-b-0 sm:flex-row sm:gap-4">
      <span className="w-full shrink-0 font-admin-body text-[13px] font-medium text-admin-slate-600 sm:w-[200px]">
        {label}
      </span>
      <span className="font-admin-body text-[14px] text-admin-neutral-ink">{value}</span>
    </div>
  );
}

function ReviewSummary({ form, fests, parentOptions }) {
  const festName = fests.find((fest) => fest.id === form.festId)?.festName ?? COPY.reviewEmpty;
  // No option lookup any more: the stored value IS the label, bar the legacy
  // lowercase slugs the format helper canonicalises.
  const category = formatCategoryLabel(form.category) ?? COPY.reviewEmpty;
  const scoring = COPY.scoringOptions.find((option) => option.value === form.scoringFormat)?.label ?? COPY.reviewEmpty;
  const location =
    form.locationType === 'virtual'
      ? form.meetingLink || COPY.reviewEmpty
      : form.venue || COPY.reviewEmpty;
  const capacity = form.capacity === '' ? COPY.reviewUnlimited : form.capacity;
  const fee =
    form.feeMode === 'paid'
      ? `₹${form.feeAmountRupees || '0'} · ${
          form.eventType === 'team'
            ? COPY.feeStructureOptions.find((option) => option.value === form.feeStructure)?.label
            : COPY.feeStructureOptions[1].label
        }`
      : COPY.reviewFreeLabel;
  const teamSize = form.eventType === 'team' ? `${form.minimumTeamSize}–${form.maximumTeamSize}` : COPY.reviewEmpty;
  const parentName = form.nestUnderParent
    ? parentOptions.find((option) => option.value === form.parentEventId)?.label ?? COPY.reviewEmpty
    : COPY.reviewEmpty;

  return (
    <div className="flex flex-col">
      <ReviewRow label={COPY.festLabel} value={festName} />
      <ReviewRow label={COPY.nameLabel} value={form.eventName || COPY.reviewEmpty} />
      <ReviewRow label={COPY.categoryLabel} value={category} />
      <ReviewRow label={COPY.typeLabel} value={form.eventType === 'team' ? COPY.typeOptions[1].label : COPY.typeOptions[0].label} />
      {form.eventType === 'team' ? <ReviewRow label={COPY.minTeamLabel + ' / ' + COPY.maxTeamLabel} value={teamSize} /> : null}
      <ReviewRow label={COPY.scoringLabel} value={scoring} />
      <ReviewRow
        label={COPY.eventDateLabel}
        value={
          form.eventDate
            ? form.endDate && form.endDate !== form.eventDate
              ? `${form.eventDate} ${form.startTime} → ${form.endDate} ${form.endTime}`
              : `${form.eventDate} · ${form.startTime}–${form.endTime}`
            : COPY.reviewEmpty
        }
      />
      <ReviewRow label={COPY.regOpensLabel} value={form.regOpensDate ? `${form.regOpensDate} ${form.regOpensTime}` : COPY.reviewEmpty} />
      <ReviewRow label={COPY.regClosesLabel} value={COPY.regStaysOpenReview} />
      <ReviewRow label={COPY.locationHeading} value={location} />
      <ReviewRow label={COPY.capacityLabel} value={capacity} />
      <ReviewRow label={COPY.feeTypeLabel} value={fee} />
      <ReviewRow label={COPY.medicalLabel} value={form.requiresMedicalDeclaration ? COPY.reviewYes : COPY.reviewNo} />
      {form.nestUnderParent ? <ReviewRow label={COPY.parentHeading} value={parentName} /> : null}
      {form.customQuestions.length > 0 ? (
        <ReviewRow label={COPY.questionsHeading} value={COPY.questionsSummary(form.customQuestions.length)} />
      ) : null}
    </div>
  );
}

export default AdminCreateEventScreen;
