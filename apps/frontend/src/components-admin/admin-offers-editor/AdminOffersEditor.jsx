// AdminOffersEditor.jsx
// The ONE offers editor, shared by the fest screens (create/edit fest) and the
// event screens (create event → Additional). Offers have the same shape at both
// levels, so they have one form; `scopeLabel` is the only thing that differs.
//
// The generic form the client specced:
//   · name, with quick-pick chips that only PRE-FILL it (the data is still just
//     offerName — reserved-key behaviour is derived from the name server-side)
//   · Paid/Free toggle — Free hides the rate entirely
//   · "Ask number of people" / "Ask number of days" toggles, each revealing its
//     own min/max
//   · a rate input whose live suffix reads "₹X per person per day / per person /
//     per day / total" from the two toggles — the single most confusing input on
//     the form, so the ambiguity is removed rather than documented
// Capped at 12. When confirmRemoval is true (edit screens), removal goes through
// AdminModal: it is destructive to answers already collected, and the offer's
// scan counter is deactivated, never deleted.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveCheckbox from '../admin-executive-checkbox/AdminExecutiveCheckbox.jsx';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';
import AdminModal from '../admin-modal/AdminModal.jsx';
import { generateOfferKey } from '../../helpers/generate-offer-key.js';
import { buildEmptyOffer } from '../../helpers/offer-form.js';
import { ADMIN_FEST_OFFERS_COPY as COPY } from '../../brand-admin/brand-copy.js';

const OFFERS_MAX = 12;

/*
 * The live suffix under the rate input, in all four permutations of the two
 * toggles. Mirrors the participant-side wording (fee-math.formatOfferRateLabel)
 * so the admin reads exactly what the participant will.
 */
function rateSuffixFor(offer) {
  if (offer.collectsNumberOfPeople && offer.collectsNumberOfDays) {
    return COPY.rateSuffixPerPersonPerDay;
  }
  if (offer.collectsNumberOfPeople) {
    return COPY.rateSuffixPerPerson;
  }
  if (offer.collectsNumberOfDays) {
    return COPY.rateSuffixPerDay;
  }
  return COPY.rateSuffixTotal;
}

function AdminOffersEditor({ offers, onChange, confirmRemoval = false, scopeLabel = null }) {
  const [removalIndex, setRemovalIndex] = useState(null);

  function updateOffer(offerIndex, changes) {
    onChange(offers.map((offer, index) => (index === offerIndex ? { ...offer, ...changes } : offer)));
  }

  function removeOffer(offerIndex) {
    onChange(offers.filter((unused, index) => index !== offerIndex));
    setRemovalIndex(null);
  }

  function handleRemoveClick(offerIndex) {
    if (confirmRemoval) {
      setRemovalIndex(offerIndex);
    } else {
      removeOffer(offerIndex);
    }
  }

  const derivedKeys = offers.map((offer) => generateOfferKey(offer.offerName));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
          {COPY.heading}
        </span>
        {/* The offer→scan-point connection is the whole reason offers exist. */}
        <p className="mt-0.5 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
          {scopeLabel ?? COPY.intro}
        </p>
      </div>

      {offers.map((offer, index) => {
        const derivedKey = derivedKeys[index];
        const isDuplicate = derivedKey && derivedKeys.indexOf(derivedKey) !== index;
        return (
          <div key={index} className="rounded-md border border-admin-slate-200 p-3">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <AdminExecutiveInput
                  label={COPY.nameLabel}
                  placeholder={COPY.namePlaceholder}
                  maxLength={80}
                  value={offer.offerName}
                  onChange={(event) => updateOffer(index, { offerName: event.target.value })}
                  errorMessage={
                    isDuplicate ? COPY.duplicateKey : offer.offerName.trim() ? undefined : COPY.emptyName
                  }
                />
              </div>
              <div className="w-[160px]">
                <span className="mb-1.5 block font-admin-body text-[13px] font-medium text-admin-neutral-ink">
                  {COPY.keyLabel}
                </span>
                <span className="block truncate rounded-md border border-admin-slate-200 bg-admin-surface-off-white px-3 py-2 font-admin-mono text-[13px] text-admin-slate-600">
                  {derivedKey || '—'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveClick(index)}
                aria-label={COPY.removeOffer}
                className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-status-error-red/10 hover:text-admin-status-error-red"
              >
                <Trash2 size={16} />
              </button>
            </div>

            {/* Quick-picks are UX sugar only: they pre-fill the name, which the
                admin can still edit. Nothing else about the offer changes. */}
            <div className="mt-2 flex flex-wrap gap-2">
              {COPY.quickPicks.map((quickPick) => (
                <button
                  key={quickPick}
                  type="button"
                  onClick={() => updateOffer(index, { offerName: quickPick })}
                  className="rounded-full border border-admin-slate-200 px-3 py-1 font-admin-body text-[12px] text-admin-slate-600 transition-colors hover:border-admin-primary-blue hover:text-admin-primary-blue"
                >
                  {quickPick}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <AdminExecutiveCheckbox
                label={COPY.isPaidLabel}
                description={COPY.isPaidDescription}
                checked={Boolean(offer.isPaid)}
                onChange={(checked) => updateOffer(index, { isPaid: checked })}
              />
            </div>

            {/* Free hides the rate field entirely — an unused number box next to
                a "Free" toggle is exactly the ambiguity this form removes. */}
            {offer.isPaid ? (
              <div className="mt-3 sm:w-1/2">
                <AdminExecutiveInput
                  label={COPY.rateLabel}
                  type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                  min={0}
                  placeholder={COPY.ratePlaceholder}
                  value={offer.rateRupees ?? ''}
                  onChange={(event) => updateOffer(index, { rateRupees: event.target.value })}
                  helperText={`${COPY.rateSuffixPrefix} ${rateSuffixFor(offer)}`}
                />
              </div>
            ) : null}

            <div className="mt-3 flex flex-col gap-2">
              <AdminExecutiveCheckbox
                label={COPY.collectsNumberOfPeopleLabel}
                description={COPY.collectsNumberOfPeopleDescription}
                checked={Boolean(offer.collectsNumberOfPeople)}
                onChange={(checked) => updateOffer(index, { collectsNumberOfPeople: checked })}
              />
              {offer.collectsNumberOfPeople ? (
                <div className="grid grid-cols-2 gap-3 pl-6 sm:w-1/2">
                  <AdminExecutiveInput
                    label={COPY.minimumLabel}
                    type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                    min={1}
                    value={offer.numberOfPeopleMinimum ?? '1'}
                    onChange={(event) =>
                      updateOffer(index, { numberOfPeopleMinimum: event.target.value })
                    }
                  />
                  <AdminExecutiveInput
                    label={COPY.maximumLabel}
                    type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                    min={1}
                    placeholder={COPY.maximumPlaceholder}
                    value={offer.numberOfPeopleMaximum ?? ''}
                    onChange={(event) =>
                      updateOffer(index, { numberOfPeopleMaximum: event.target.value })
                    }
                  />
                </div>
              ) : null}

              <AdminExecutiveCheckbox
                label={COPY.collectsNumberOfDaysLabel}
                description={COPY.collectsNumberOfDaysDescription}
                checked={Boolean(offer.collectsNumberOfDays)}
                onChange={(checked) => updateOffer(index, { collectsNumberOfDays: checked })}
              />
              {offer.collectsNumberOfDays ? (
                <div className="grid grid-cols-2 gap-3 pl-6 sm:w-1/2">
                  <AdminExecutiveInput
                    label={COPY.minimumLabel}
                    type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                    min={1}
                    value={offer.numberOfDaysMinimum ?? '1'}
                    onChange={(event) =>
                      updateOffer(index, { numberOfDaysMinimum: event.target.value })
                    }
                  />
                  <AdminExecutiveInput
                    label={COPY.maximumLabel}
                    type="text"
            inputMode="numeric"
            pattern="[0-9]*"
                    min={1}
                    placeholder={COPY.maximumPlaceholder}
                    value={offer.numberOfDaysMaximum ?? ''}
                    onChange={(event) =>
                      updateOffer(index, { numberOfDaysMaximum: event.target.value })
                    }
                  />
                </div>
              ) : null}
            </div>

            <div className="mt-3">
              <AdminExecutiveInput
                label={COPY.descriptionLabel}
                maxLength={200}
                placeholder={COPY.descriptionPlaceholder}
                value={offer.description ?? ''}
                onChange={(event) => updateOffer(index, { description: event.target.value })}
              />
            </div>
          </div>
        );
      })}

      {offers.length >= OFFERS_MAX ? (
        <p className="font-admin-body text-[13px] text-admin-status-warning-amber">
          {COPY.limitReached}
        </p>
      ) : (
        <div>
          <AdminExecutiveButton variant="ghost" onClick={() => onChange([...offers, buildEmptyOffer()])}>
            {COPY.addOffer}
          </AdminExecutiveButton>
        </div>
      )}

      <AdminModal
        isOpen={removalIndex !== null}
        title={COPY.removeModalTitle}
        confirmLabel={COPY.removeConfirm}
        cancelLabel={COPY.removeCancel}
        tone="danger"
        onConfirm={() => removeOffer(removalIndex)}
        onCancel={() => setRemovalIndex(null)}
      >
        {removalIndex !== null ? COPY.removeModalBody(offers[removalIndex]?.offerName ?? '') : null}
      </AdminModal>
    </div>
  );
}

export default AdminOffersEditor;
