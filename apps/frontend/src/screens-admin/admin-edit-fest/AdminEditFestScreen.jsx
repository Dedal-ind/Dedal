// AdminEditFestScreen.jsx
// Route: /admin/fests/:festId/edit — edit an existing fest.
//
// Backend contract (fest-routes.js / fest-validators.js):
//   · GET /fests/:festId (admin-gated) → the fest, drafts included.
//   · PATCH /fests/:festId — whitelist UPDATE_ALLOWED_FIELDS: festName,
//     description, startsOn, endsOn, visibility, allowedCollegeIds, contactEmail,
//     bannerImageUrl, offersFood, offersAccommodation. hostCollegeId is absent by
//     design (a fest cannot move colleges), so it renders read-only here.
//
// Only CHANGED fields are sent. Two model rules shape the payload:
//   · a non-interCollege fest must not carry allowed colleges, so switching
//     visibility away from interCollege sends allowedCollegeIds: [] in the same
//     PATCH;
//   · the string parsers reject empty strings, so a cleared optional field is
//     simply not sent (the backend has no "unset description" operation).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTextarea from '../../components-admin/admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminPosterUpload from '../../components-admin/admin-poster-upload/AdminPosterUpload.jsx';
import AdminOffersEditor from '../../components-admin/admin-offers-editor/AdminOffersEditor.jsx';
import AdminSponsorsEditor from '../../components-admin/admin-sponsors-editor/AdminSponsorsEditor.jsx';
import { toSponsorPayload, toSponsorFormRows } from '../../helpers/sponsor-form.js';
import { toOfferPayload, toOfferFormRow } from '../../helpers/offer-form.js';
import AdminOfferCheckpointsPanel from '../../components-admin/admin-offer-checkpoints-panel/AdminOfferCheckpointsPanel.jsx';
import { ADMIN_EDIT_FEST_COPY as COPY, ADMIN_FEST_STRUCTURE_COPY } from '../../brand-admin/brand-copy.js';

const OVERVIEW_ROUTE = '/admin/overview';

// Backend validation-detail keys → the form field the message attaches to.
const SERVER_FIELD_MAP = {
  festName: 'festName',
  description: 'description',
  startsOn: 'startsOn',
  endsOn: 'endsOn',
  visibility: 'visibility',
  contactEmail: 'contactEmail',
  allowedCollegeIds: 'visibility',
};

function toDateInputValue(isoString) {
  if (typeof isoString !== 'string' || isoString.length < 10) {
    return '';
  }
  return isoString.slice(0, 10);
}

/* HH:MM for a <input type="time"> from a stored timestamp. */
function toTimeInputValue(rawValue) {
  if (!rawValue) return '';
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return '';
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function festToForm(fest) {
  return {
    festName: fest.festName ?? '',
    description: fest.description ?? '',
    bannerImageUrl: fest.bannerImageUrl ?? null,
    contactEmail: fest.contactEmail ?? '',
    startsOn: toDateInputValue(fest.startsOn),
    endsOn: toDateInputValue(fest.endsOn),
    /* The fest's opening and closing clock times. Date-only editing silently
     * reset both to midnight on every save; the admin asked for control of
     * start/end time from the dashboard's Edit. */
    startsAtTime: toTimeInputValue(fest.startsOn),
    endsAtTime: toTimeInputValue(fest.endsOn),
    visibility: fest.visibility ?? 'public',
    // Only ACTIVE offers are editable rows; a deactivated offer stays in the
    // backend record but is no longer offered, so re-adding the same name
    // reactivates its identity (same derived key → same subdocument).
    offers: (fest.offers ?? [])
      .filter((offer) => offer.isActive !== false)
      .map(toOfferFormRow),
    sponsors: toSponsorFormRows(fest.sponsors),
  };
}

function mapServerErrors(details) {
  const mapped = {};
  if (details && typeof details === 'object') {
    for (const [key, reason] of Object.entries(details)) {
      mapped[SERVER_FIELD_MAP[key] ?? key] =
        typeof reason === 'string' ? reason : COPY.errors.submitFailed;
    }
  }
  return mapped;
}

function validateForm(form) {
  const errors = {};
  if (form.festName.trim().length === 0) {
    errors.festName = COPY.errors.nameRequired;
  }
  if (!form.startsOn || !form.endsOn) {
    errors.endsOn = COPY.errors.datesRequired;
  } else if (form.endsOn < form.startsOn) {
    errors.endsOn = COPY.errors.endBeforeStart;
  }
  return errors;
}

/*
 * The diff. Only fields that differ from the loaded fest are sent, each shaped
 * for its parser (trimmed strings, booleans, dates as the yyyy-mm-dd string the
 * backend's Date parser accepts).
 */
function buildChangedPayload(form, initialForm) {
  const payload = {};

  const trimmedName = form.festName.trim();
  if (trimmedName !== initialForm.festName) {
    payload.festName = trimmedName;
  }
  // Empty optional strings cannot be sent (the parser rejects them) — a cleared
  // field is treated as "unchanged" rather than "unset".
  const trimmedDescription = form.description.trim();
  if (trimmedDescription !== initialForm.description && trimmedDescription.length > 0) {
    payload.description = trimmedDescription;
  }
  const trimmedEmail = form.contactEmail.trim();
  if (trimmedEmail !== initialForm.contactEmail && trimmedEmail.length > 0) {
    payload.contactEmail = trimmedEmail;
  }
  // Sent only when changed AND non-empty: like description, the parser rejects
  // an empty value, so a removed banner is treated as "unchanged" here.
  if (form.bannerImageUrl !== initialForm.bannerImageUrl && form.bannerImageUrl) {
    payload.bannerImageUrl = form.bannerImageUrl;
  }
  /*
   * Date and clock time are edited as two inputs but stored as ONE timestamp,
   * so a change to either sends the combined value. Times default to what the
   * fest already had, so editing only the date no longer resets the clock to
   * midnight.
   */
  if (form.startsOn !== initialForm.startsOn || form.startsAtTime !== initialForm.startsAtTime) {
    payload.startsOn = `${form.startsOn}T${form.startsAtTime || '00:00'}`;
  }
  if (form.endsOn !== initialForm.endsOn || form.endsAtTime !== initialForm.endsAtTime) {
    payload.endsOn = `${form.endsOn}T${form.endsAtTime || '23:59'}`;
  }
  if (form.visibility !== initialForm.visibility) {
    payload.visibility = form.visibility;
    // The model rejects a non-interCollege fest that still lists allowed
    // colleges, so leaving interCollege clears the list in the same PATCH.
    if (initialForm.visibility === 'interCollege' && form.visibility !== 'interCollege') {
      payload.allowedCollegeIds = [];
    }
  }
  if (JSON.stringify(form.offers) !== JSON.stringify(initialForm.offers)) {
    payload.offers = form.offers
      .filter((offer) => offer.offerName.trim().length > 0)
      .map(toOfferPayload);
  }
  if (JSON.stringify(form.sponsors) !== JSON.stringify(initialForm.sponsors)) {
    payload.sponsors = toSponsorPayload(form.sponsors);
  }

  return payload;
}

function AdminEditFestScreen() {
  const navigate = useNavigate();
  const { festId } = useParams();
  const [status, setStatus] = useState('loading');
  const [initialForm, setInitialForm] = useState(null);
  // Raw fest offers (with subdocument _ids) for the checkpoints panel.
  const [rawOffers, setRawOffers] = useState([]);
  // Independent-event wrapper: shows the one-way "Convert to full fest" action.
  const [isSoloContainer, setIsSoloContainer] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let isActive = true;
    apiClient
      .get(`/fests/${festId}`)
      .then((fest) => {
        if (!isActive) {
          return;
        }
        const loaded = festToForm(fest);
        setIsSoloContainer(Boolean(fest.isSoloContainer));
        setRawOffers(fest.offers ?? []);
        setInitialForm(loaded);
        setForm(loaded);
        setStatus('ready');
      })
      .catch(() => isActive && setStatus('error'));
    return () => {
      isActive = false;
    };
  }, [festId]);

  // interCollege appears as an option only when the fest already is interCollege:
  // there is no allowed-colleges picker yet, so it can be kept but not entered.
  const visibilityOptions = useMemo(() => {
    if (initialForm?.visibility === 'interCollege') {
      return [...COPY.visibilityOptions, COPY.interCollegeOption];
    }
    return COPY.visibilityOptions;
  }, [initialForm]);

  function updateField(name, value) {
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => {
      if (!previous[name]) {
        return previous;
      }
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }

  async function handleSubmit() {
    const formErrors = validateForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      return;
    }
    const payload = buildChangedPayload(form, initialForm);
    if (Object.keys(payload).length === 0) {
      setServerError(COPY.noChanges);
      return;
    }
    setSubmitting(true);
    setServerError('');
    try {
      await apiClient.patch(`/fests/${festId}`, payload);
      navigate(OVERVIEW_ROUTE);
    } catch (submitException) {
      setErrors(mapServerErrors(submitException.details));
      setServerError(submitException.message || COPY.errors.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <span
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
        />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-[720px]">
        <AdminErrorBanner message={COPY.errors.loadFailed} />
      </div>
    );
  }

  const isLeavingInterCollege =
    initialForm.visibility === 'interCollege' && form.visibility !== 'interCollege';

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-admin-display text-[24px] font-semibold leading-8 text-admin-neutral-ink">
          {COPY.pageTitle}
        </h1>
        <div className="flex items-center gap-2">
          {isSoloContainer ? (
            <AdminExecutiveButton
              variant="secondary"
              loading={isConverting}
              onClick={async () => {
                setIsConverting(true);
                setServerError('');
                try {
                  await apiClient.post(`/fests/${festId}/convert-to-full-fest`);
                  setIsSoloContainer(false);
                } catch (convertError) {
                  setServerError(convertError.message || COPY.convertFailed);
                } finally {
                  setIsConverting(false);
                }
              }}
            >
              {COPY.convertToFullFest}
            </AdminExecutiveButton>
          ) : null}
          <AdminExecutiveButton
            variant="secondary"
            onClick={() => navigate(`/admin/fests/${festId}/structure`)}
          >
            {ADMIN_FEST_STRUCTURE_COPY.viewStructure}
          </AdminExecutiveButton>
        </div>
      </div>
      {isSoloContainer ? (
        <p className="-mt-2 rounded-md border border-admin-primary-blue/30 bg-admin-primary-blue/5 px-4 py-3 font-admin-body text-[13px] leading-[18px] text-admin-neutral-ink">
          {COPY.soloContainerNote}
        </p>
      ) : null}
      <p className="-mt-4 font-admin-body text-[14px] leading-5 text-admin-slate-600">{COPY.intro}</p>

      <AdminErrorBanner message={serverError} />

      <AdminExecutiveCard>
        <div className="flex flex-col gap-6">
          <AdminExecutiveInput
            label={COPY.nameLabel}
            required
            value={form.festName}
            onChange={(event) => updateField('festName', event.target.value)}
            errorMessage={errors.festName}
          />

          <AdminExecutiveTextarea
            label={COPY.descriptionLabel}
            rows={3}
            maxLength={2000}
            placeholder={COPY.descriptionPlaceholder}
            value={form.description}
            onChange={(event) => updateField('description', event.target.value)}
            errorMessage={errors.description}
          />

          <AdminPosterUpload
            label={COPY.bannerLabel}
            value={form.bannerImageUrl}
            onChange={(url) => updateField('bannerImageUrl', url)}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <AdminExecutiveInput
              label={COPY.startsOnLabel}
              required
              type="date"
              value={form.startsOn}
              onChange={(event) => updateField('startsOn', event.target.value)}
              errorMessage={errors.startsOn}
            />
            <AdminExecutiveInput
              label="Start time"
              type="time"
              value={form.startsAtTime}
              onChange={(event) => updateField('startsAtTime', event.target.value)}
            />
            <AdminExecutiveInput
              label={COPY.endsOnLabel}
              required
              type="date"
              value={form.endsOn}
              onChange={(event) => updateField('endsOn', event.target.value)}
              errorMessage={errors.endsOn}
            />
            <AdminExecutiveInput
              label="End time"
              type="time"
              value={form.endsAtTime}
              onChange={(event) => updateField('endsAtTime', event.target.value)}
            />
          </div>

          <AdminExecutiveSelect
            label={COPY.visibilityLabel}
            required
            helperText={
              errors.visibility ? undefined : isLeavingInterCollege ? COPY.interCollegeNote : undefined
            }
            options={visibilityOptions}
            value={form.visibility}
            onChange={(event) => updateField('visibility', event.target.value)}
            errorMessage={errors.visibility}
          />

          <AdminExecutiveInput
            label={COPY.contactEmailLabel}
            type="email"
            placeholder={COPY.contactEmailPlaceholder}
            value={form.contactEmail}
            onChange={(event) => updateField('contactEmail', event.target.value)}
            errorMessage={errors.contactEmail}
          />

          <AdminOffersEditor
            offers={form.offers}
            onChange={(offers) => updateField('offers', offers)}
            confirmRemoval
          />

          <AdminOfferCheckpointsPanel festId={festId} offers={rawOffers} />

          <AdminSponsorsEditor
            sponsors={form.sponsors}
            onChange={(sponsors) => updateField('sponsors', sponsors)}
            confirmRemoval
          />
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-admin-slate-200 pt-6">
          <button
            type="button"
            onClick={() => navigate(OVERVIEW_ROUTE)}
            className="font-admin-body text-[14px] text-admin-slate-600 transition-colors hover:text-admin-neutral-ink"
          >
            {COPY.cancel}
          </button>
          <AdminExecutiveButton variant="primary" loading={submitting} onClick={handleSubmit}>
            {COPY.submit}
          </AdminExecutiveButton>
        </div>
      </AdminExecutiveCard>
    </div>
  );
}

export default AdminEditFestScreen;
