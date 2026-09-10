// admin-event-form.js
// The bridge between the Create Event form state and the backend's create-event
// payload. Kept out of the screen so the mapping rules — which mirror the server's
// field parsers and the event model's cross-field validators — read in one place.
//
// Backend contract (confirmed against event-validator.js / event-field-parsers.js
// / event-model.js):
//   required: eventName, description, eventType, venue, startsAt, endsAt,
//             registrationOpensAt, registrationClosesAt
//   free ⇒ feeAmountPaise 0 · paid ⇒ feeAmountPaise > 0
//   solo ⇒ team sizes 1/1 (omitted, model defaults) · team ⇒ min ≥ 2, max ≥ min
//   endsAt ≥ startsAt. Registration has an OPENING only: it stays open until an
//   administrator closes it from Event Access, so no closing time is collected.
//   category nullable · capacity nullable (null = unlimited)

// Combine a yyyy-mm-dd date and an HH:mm time (both local) into an ISO string.
// Returns null when either half is missing, so callers can treat it as "not set".
import { toOfferPayload } from './offer-form.js';
export function combineDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) {
    return null;
  }
  const combined = new Date(`${dateValue}T${timeValue}`);
  return Number.isNaN(combined.getTime()) ? null : combined.toISOString();
}

// Split a comma-separated string into a trimmed, non-empty array.
function splitList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export const emptyEventForm = {
  festId: '',
  eventName: '',
  description: '',
  category: '',
  eventType: 'solo',
  minimumTeamSize: '2',
  maximumTeamSize: '4',
  scoringFormat: 'none',
  eventDate: '',
  /* Optional. Empty means same-day (endDate = eventDate), so every existing
   * draft and one-day event keeps working with no migration. */
  endDate: '',
  startTime: '',
  endTime: '',
  regOpensDate: '',
  regOpensTime: '',
  locationType: 'physical',
  venue: '',
  meetingLink: '',
  capacity: '',
  waitlistEnabled: false,
  feeMode: 'free',
  feeAmountRupees: '',
  feeStructure: 'perTeam',
  posterImageUrl: null,
  rules: '',
  prizePoolDescription: '',
  requiresMedicalDeclaration: false,
  // Event-scoped offers (an add-on to the fest's own; see AdminOffersEditor).
  offers: [],
  weightCategories: '',
  genderCategories: '',
  ageCategories: '',
  nestUnderParent: false,
  parentEventId: '',
  customQuestions: [],
  faqs: [],
};

// The location value the backend stores: one `venue` field. A virtual event puts
// its meeting link there (there is no separate meetingLink field on the model).
export function resolveVenue(form) {
  return form.locationType === 'virtual' ? form.meetingLink.trim() : form.venue.trim();
}

// Validate the Step 1 (Event Setup) fields, returning a map of formField → message
// for anything invalid. An empty map means the step is submittable. `copyErrors`
// is ADMIN_CREATE_EVENT_COPY.errors, passed in so copy stays centralised.
/*
 * `isIndependent` — the standalone flow (POST /events/independent) has NO fest to
 * choose: the backend mints an invisible solo-container wrapper. Requiring festId
 * there is what left the wizard stuck on step 1 with a permanently disabled
 * "Next Step" and an error on a field that is not even rendered. Defaults to
 * false so the fest flow is unchanged.
 */
export function validateEventSetup(form, copyErrors, isIndependent = false) {
  const errors = {};

  if (!isIndependent && !form.festId) {
    errors.festId = copyErrors.festRequired;
  }
  if (!form.eventName.trim()) {
    errors.eventName = copyErrors.nameRequired;
  }
  if (!form.description.trim()) {
    errors.description = copyErrors.descriptionRequired;
  }

  if (form.locationType === 'virtual') {
    if (!form.meetingLink.trim()) {
      errors.meetingLink = copyErrors.meetingLinkRequired;
    }
  } else if (!form.venue.trim()) {
    errors.venue = copyErrors.venueRequired;
  }

  /*
   * The end has its own date so multi-day events exist at all. Empty endDate
   * means same-day — the previous behaviour, kept as the default so a one-day
   * event needs no extra click. The <= check now also catches an end DATE
   * before the start date, not just an earlier time on the same day.
   */
  const effectiveEndDate = form.endDate || form.eventDate;
  const startsAt = combineDateTime(form.eventDate, form.startTime);
  const endsAt = combineDateTime(effectiveEndDate, form.endTime);
  if (!startsAt || !endsAt) {
    errors.schedule = copyErrors.datesRequired;
  } else if (new Date(endsAt) <= new Date(startsAt)) {
    errors.schedule = copyErrors.endAfterStart;
  }

  /*
   * Only the OPENING is asked for. There is no closing time in this form because
   * registration does not close on a clock — it closes when an administrator
   * closes it from Event Access, which is the only rule the runtime enforces.
   * Asking for a closing date here would collect a promise the system does not
   * keep, and admins were reading the refusals that produced as a bug.
   */
  const regOpensAt = combineDateTime(form.regOpensDate, form.regOpensTime);
  if (!regOpensAt) {
    errors.registration = copyErrors.regRequired;
  }

  if (form.eventType === 'team') {
    const min = Number(form.minimumTeamSize);
    const max = Number(form.maximumTeamSize);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 2 || max < min) {
      errors.teamSizes = copyErrors.teamSizes;
    }
  }

  if (form.feeMode === 'paid') {
    const rupees = Number(form.feeAmountRupees);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      errors.feeAmountRupees = copyErrors.feeAmount;
    }
  }

  if (form.capacity !== '') {
    const capacity = Number(form.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      errors.capacity = copyErrors.capacityInvalid;
    }
  }

  /*
   * Both halves or neither. A half-written FAQ is worse than none — it publishes
   * a question the organiser has visibly not answered.
   */
  form.faqs.forEach((faq, index) => {
    const hasQuestion = faq.question.trim().length > 0;
    const hasAnswer = faq.answer.trim().length > 0;
    if (hasQuestion !== hasAnswer) {
      errors[`faq-${index}`] = copyErrors.faqIncomplete;
    }
  });

  return errors;
}

// The hard-required fields whose emptiness disables the "Next Step" button (the
// cross-field ordering rules are checked on click, not used to disable).
export function isSetupMinimallyFilled(form, isIndependent = false) {
  const hasLocation =
    form.locationType === 'virtual' ? Boolean(form.meetingLink.trim()) : Boolean(form.venue.trim());
  const hasTeamSizes =
    form.eventType !== 'team' ||
    (Number.isInteger(Number(form.minimumTeamSize)) && Number.isInteger(Number(form.maximumTeamSize)));
  return (
    (isIndependent || Boolean(form.festId)) &&
    Boolean(form.eventName.trim()) &&
    Boolean(form.description.trim()) &&
    hasLocation &&
    Boolean(form.eventDate && form.startTime && form.endTime) &&
    Boolean(form.regOpensDate && form.regOpensTime) &&
    hasTeamSizes
  );
}

/*
 * The event model carries NO durationDays field — duration is exactly
 * endsAt − startsAt, and the form's single event date makes that one day. This
 * returns a human string for the read-only duration line the setup step shows
 * (the "how many days" the admin asks for), or null while the schedule is
 * incomplete.
 */
export function describeEventDuration(form) {
  const startsAt = combineDateTime(form.eventDate, form.startTime);
  const endsAt = combineDateTime(form.endDate || form.eventDate, form.endTime);
  if (!startsAt || !endsAt) {
    return null;
  }
  const totalMinutes = Math.round((new Date(endsAt) - new Date(startsAt)) / 60000);
  if (totalMinutes <= 0) {
    return null;
  }
  /* Days lead once the event spans them — "2 days 1 hour" reads; "49 hours"
   * is technically true and practically useless. */
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) {
    parts.push(`${days} day${days === 1 ? '' : 's'}`);
  }
  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} min`);
  }
  return parts.join(' ');
}

// Translate validated form state into the exact create-event request body. Only
// meaningful fields are included; the backend whitelist drops anything else and
// defaults what is omitted (status → draft, team sizes → 1/1 for solo, etc.).
export function buildEventPayload(form) {
  const payload = {
    eventName: form.eventName.trim(),
    description: form.description.trim(),
    eventType: form.eventType,
    scoringFormat: form.scoringFormat,
    venue: resolveVenue(form),
    startsAt: combineDateTime(form.eventDate, form.startTime),
    endsAt: combineDateTime(form.endDate || form.eventDate, form.endTime),
    registrationOpensAt: combineDateTime(form.regOpensDate, form.regOpensTime),
    /*
     * The model still requires this field, and Event Access still writes it when
     * an admin closes registration by hand — so it is sent as the event's END,
     * the latest value the schema permits. It is a DISPLAYED deadline only
     * (nothing enforces it), which is exactly why the form no longer asks an
     * admin to invent one.
     */
    registrationClosesAt: combineDateTime(form.endDate || form.eventDate, form.endTime),
    requiresMedicalDeclaration: Boolean(form.requiresMedicalDeclaration),
  };

  if (form.category) {
    payload.category = form.category;
  }

  if (form.eventType === 'team') {
    payload.minimumTeamSize = Number(form.minimumTeamSize);
    payload.maximumTeamSize = Number(form.maximumTeamSize);
  }

  if (form.feeMode === 'paid') {
    payload.feeType = form.eventType === 'team' ? form.feeStructure : 'perPerson';
    payload.feeAmountPaise = Math.round(Number(form.feeAmountRupees) * 100);
  } else {
    payload.feeType = 'free';
    payload.feeAmountPaise = 0;
  }

  if (form.capacity !== '') {
    payload.capacity = Number(form.capacity);
    // Only sent alongside a capacity: an unlimited event can never be full, so
    // a queue on one is meaningless and the backend would just store noise.
    payload.waitlistEnabled = Boolean(form.waitlistEnabled);
  }
  if (form.posterImageUrl) {
    payload.posterImageUrl = form.posterImageUrl;
  }
  if (form.rules.trim()) {
    payload.rules = form.rules.trim();
  }
  // Event-scoped add-ons, mapped by the SAME helper the fest screens use.
  const filledOffers = (form.offers ?? []).filter((offer) => offer.offerName.trim().length > 0);
  if (filledOffers.length > 0) {
    payload.offers = filledOffers.map(toOfferPayload);
  }
  if (form.prizePoolDescription.trim()) {
    payload.prizePoolDescription = form.prizePoolDescription.trim();
  }

  const weightCategories = splitList(form.weightCategories);
  if (weightCategories.length > 0) {
    payload.weightCategories = weightCategories;
  }
  const genderCategories = splitList(form.genderCategories);
  if (genderCategories.length > 0) {
    payload.genderCategories = genderCategories;
  }
  const ageCategories = splitList(form.ageCategories);
  if (ageCategories.length > 0) {
    payload.ageCategories = ageCategories;
  }

  if (form.nestUnderParent && form.parentEventId) {
    payload.parentEventId = form.parentEventId;
  }

  /*
   * Entirely blank rows are dropped rather than rejected: an admin who taps
   * "Add FAQ" and changes their mind should not be blocked by an empty box.
   */
  const filledFaqs = form.faqs
    .map((faq) => ({ question: faq.question.trim(), answer: faq.answer.trim() }))
    .filter((faq) => faq.question.length > 0 && faq.answer.length > 0);
  if (filledFaqs.length > 0) {
    payload.faqs = filledFaqs;
  }

  if (form.customQuestions.length > 0) {
    payload.customQuestions = form.customQuestions.map((question) => ({
      questionText: question.questionText.trim(),
      questionType: question.questionType,
      isRequired: Boolean(question.isRequired),
      options:
        question.questionType === 'singleChoice'
          ? question.options.map((option) => option.trim()).filter((option) => option.length > 0)
          : [],
    }));
  }

  return payload;
}

/*
 * The reverse of buildEventPayload: an existing event mapped INTO the wizard's
 * form shape, so edit mode opens with every field showing what is really
 * stored. Dates split into the local date/time inputs the form uses; paise
 * become rupees; array categories become the comma strings the inputs hold.
 */
function isoToDateInput(isoValue) {
  if (!isoValue) return '';
  const d = new Date(isoValue);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoToTimeInput(isoValue) {
  if (!isoValue) return '';
  const d = new Date(isoValue);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function eventToForm(event, festId) {
  const venue = event.venue ?? '';
  const looksVirtual = /^https?:\/\//i.test(venue);
  const startDate = isoToDateInput(event.startsAt);
  const endDate = isoToDateInput(event.endsAt);
  return {
    ...emptyEventForm,
    festId: festId ?? String(event.festId ?? ''),
    eventName: event.eventName ?? '',
    description: event.description ?? '',
    category: event.category ?? '',
    eventType: event.eventType ?? 'solo',
    minimumTeamSize: String(event.minimumTeamSize ?? 2),
    maximumTeamSize: String(event.maximumTeamSize ?? 4),
    scoringFormat: event.scoringFormat ?? 'none',
    eventDate: startDate,
    endDate: endDate !== startDate ? endDate : '',
    startTime: isoToTimeInput(event.startsAt),
    endTime: isoToTimeInput(event.endsAt),
    regOpensDate: isoToDateInput(event.registrationOpensAt),
    regOpensTime: isoToTimeInput(event.registrationOpensAt),
    locationType: looksVirtual ? 'virtual' : 'physical',
    venue: looksVirtual ? '' : venue,
    meetingLink: looksVirtual ? venue : '',
    capacity: event.capacity == null ? '' : String(event.capacity),
    waitlistEnabled: Boolean(event.waitlistEnabled),
    feeMode: (event.feeAmountPaise ?? 0) > 0 ? 'paid' : 'free',
    feeAmountRupees:
      (event.feeAmountPaise ?? 0) > 0 ? String(event.feeAmountPaise / 100) : '',
    feeStructure: event.feeType === 'perPerson' ? 'perPerson' : 'perTeam',
    posterImageUrl: event.posterImageUrl ?? null,
    rules: event.rules ?? '',
    prizePoolDescription: event.prizePoolDescription ?? '',
    requiresMedicalDeclaration: Boolean(event.requiresMedicalDeclaration),
    offers: Array.isArray(event.offers)
      ? event.offers.map((offer) => ({ ...offer }))
      : [],
    weightCategories: (event.weightCategories ?? []).join(', '),
    genderCategories: (event.genderCategories ?? []).join(', '),
    ageCategories: (event.ageCategories ?? []).join(', '),
    nestUnderParent: Boolean(event.parentEventId),
    parentEventId: event.parentEventId ? String(event.parentEventId) : '',
    customQuestions: Array.isArray(event.customQuestions)
      ? event.customQuestions.map((q) => ({
          questionText: q.questionText ?? '',
          questionType: q.questionType ?? 'text',
          isRequired: Boolean(q.isRequired),
          options: Array.isArray(q.options) ? [...q.options] : [],
        }))
      : [],
    faqs: Array.isArray(event.faqs)
      ? event.faqs.map((faq) => ({ question: faq.question ?? '', answer: faq.answer ?? '' }))
      : [],
  };
}
