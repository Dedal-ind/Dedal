// AdminCreateFestScreen.jsx
// Route: /admin/fests/create — create a fest under one of the colleges the
// signed-in administrator actually administers.
//
// The form maps to POST /fests, whose validator accepts exactly the fields sent
// here (festName, hostCollegeId, startsOn, endsOn, visibility are required;
// description, contactEmail, offersFood, offersAccommodation are optional).
// Host colleges come from GET /colleges/mine-admin because the service re-checks
// administrator authority over hostCollegeId — any other college is a 403.
//
// A fest is always created as a draft; publishing happens from Event Access.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { toSponsorPayload } from '../../helpers/sponsor-form.js';
import { toOfferPayload } from '../../helpers/offer-form.js';
import { ADMIN_CREATE_FEST_COPY as COPY } from '../../brand-admin/brand-copy.js';

const OVERVIEW_ROUTE = '/admin/overview';

const emptyFestForm = {
  hostCollegeId: '',
  festName: '',
  description: '',
  bannerImageUrl: null,
  contactEmail: '',
  contactPhone: '',
  startsOn: '',
  endsOn: '',
  visibility: 'public',
  offers: [],
  sponsors: [],
};

// Backend validation-detail keys → the form field the message attaches to. The
// two names the backend uses that the form does not are passed through as-is.
const SERVER_FIELD_MAP = {
  festName: 'festName',
  hostCollegeId: 'hostCollegeId',
  startsOn: 'startsOn',
  endsOn: 'endsOn',
  visibility: 'visibility',
  description: 'description',
  contactEmail: 'contactEmail',
  contactPhone: 'contactPhone',
  allowedCollegeIds: 'visibility',
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

function validateFestForm(form) {
  const errors = {};
  if (!form.hostCollegeId) {
    errors.hostCollegeId = COPY.errors.collegeRequired;
  }
  if (form.festName.trim().length === 0) {
    errors.festName = COPY.errors.nameRequired;
  }
  if (!form.startsOn || !form.endsOn) {
    errors.endsOn = COPY.errors.datesRequired;
  } else if (form.endsOn < form.startsOn) {
    errors.endsOn = COPY.errors.endBeforeStart;
  }
  if (!form.visibility) {
    errors.visibility = COPY.errors.visibilityRequired;
  }
  /*
   * Optional, but validated the moment anything is typed: a half-entered number
   * is worse than a blank one, because it reads on the fest page as a working
   * contact and reaches nobody.
   */
  if (form.contactPhone.trim().length > 0 && !/^\d{10}$/.test(form.contactPhone.trim())) {
    errors.contactPhone = COPY.errors.contactPhoneInvalid;
  }
  return errors;
}

// Optional trimmed strings are omitted rather than sent empty: the backend
// parser rejects an empty string instead of treating it as "unset".
function buildFestPayload(form) {
  const payload = {
    festName: form.festName.trim(),
    hostCollegeId: form.hostCollegeId,
    startsOn: form.startsOn,
    endsOn: form.endsOn,
    visibility: form.visibility,
    // Empty-name rows are drafts the admin abandoned; the backend derives the key.
    // Empty-name rows are drafts the admin abandoned; the backend derives the
    // key. Rupees→paise and the axis bounds are mapped by the shared helper.
    offers: form.offers
      .filter((offer) => offer.offerName.trim().length > 0)
      .map(toOfferPayload),
    sponsors: toSponsorPayload(form.sponsors),
  };
  if (form.description.trim().length > 0) {
    payload.description = form.description.trim();
  }
  if (form.contactEmail.trim().length > 0) {
    payload.contactEmail = form.contactEmail.trim();
  }
  if (form.contactPhone.trim().length > 0) {
    payload.contactPhone = form.contactPhone.trim();
  }
  if (form.bannerImageUrl) {
    payload.bannerImageUrl = form.bannerImageUrl;
  }
  return payload;
}

function AdminCreateFestScreen() {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyFestForm);
  const [colleges, setColleges] = useState([]);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Load the administered colleges once; preselect when there is exactly one.
  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/colleges/mine-admin')
      .then((payload) => {
        if (!isActive) {
          return;
        }
        const collegeList = payload?.colleges ?? [];
        setColleges(collegeList);
        if (collegeList.length === 1) {
          setForm((previous) => ({ ...previous, hostCollegeId: collegeList[0].id }));
        }
      })
      .catch((loadException) => {
        if (isActive) {
          setServerError(loadException.message || COPY.errors.collegesLoadFailed);
        }
      });
    return () => {
      isActive = false;
    };
  }, []);

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
    const formErrors = validateFestForm(form);
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) {
      return;
    }
    setSubmitting(true);
    setServerError('');
    try {
      await apiClient.post('/fests', buildFestPayload(form));
      navigate(OVERVIEW_ROUTE);
    } catch (submitException) {
      setErrors(mapServerErrors(submitException.details));
      setServerError(submitException.message || COPY.errors.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      <p className="font-admin-body text-[14px] leading-5 text-admin-slate-600">{COPY.intro}</p>

      <AdminErrorBanner message={serverError} />

      <AdminExecutiveCard>
        <div className="flex flex-col gap-6">
          <AdminExecutiveSelect
            label={COPY.collegeLabel}
            required
            placeholder={COPY.collegePlaceholder}
            helperText={colleges.length === 0 ? COPY.noColleges : COPY.collegeHelper}
            options={colleges.map((college) => ({ value: college.id, label: college.commonName }))}
            value={form.hostCollegeId}
            onChange={(event) => updateField('hostCollegeId', event.target.value)}
            errorMessage={errors.hostCollegeId}
          />

          <AdminExecutiveInput
            label={COPY.nameLabel}
            required
            placeholder={COPY.namePlaceholder}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AdminExecutiveInput
              label={COPY.startsOnLabel}
              required
              type="date"
              value={form.startsOn}
              onChange={(event) => updateField('startsOn', event.target.value)}
              errorMessage={errors.startsOn}
            />
            <AdminExecutiveInput
              label={COPY.endsOnLabel}
              required
              type="date"
              value={form.endsOn}
              onChange={(event) => updateField('endsOn', event.target.value)}
              errorMessage={errors.endsOn}
            />
          </div>

          <AdminExecutiveSelect
            label={COPY.visibilityLabel}
            required
            helperText={errors.visibility ? undefined : COPY.interCollegeNote}
            options={COPY.visibilityOptions}
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

          <AdminExecutiveInput
            label={COPY.contactPhoneLabel}
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            placeholder={COPY.contactPhonePlaceholder}
            value={form.contactPhone}
            /* Digits only at the point of entry, so the stored value is always
               the bare 10 digits the backend validates against. */
            onChange={(event) =>
              updateField('contactPhone', event.target.value.replace(/[^0-9]/g, '').slice(0, 10))
            }
            errorMessage={errors.contactPhone}
          />

          <AdminOffersEditor
            offers={form.offers}
            onChange={(offers) => updateField('offers', offers)}
          />

          <AdminSponsorsEditor
            sponsors={form.sponsors}
            onChange={(sponsors) => updateField('sponsors', sponsors)}
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

export default AdminCreateFestScreen;
