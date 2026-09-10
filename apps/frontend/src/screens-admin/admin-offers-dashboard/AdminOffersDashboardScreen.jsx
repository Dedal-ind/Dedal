// AdminOffersDashboardScreen.jsx
// Route: /admin/offers-dashboard — what was sold, and how much of it has been used.
//
// THE GAP IS THE POINT. Every offer here shows three numbers that should not
// match: booked, used, and still owed. 400 dinners sold and 260 eaten means 140
// people have not been fed and the kitchen must not pack up — and that is a
// decision someone makes at 9pm with a phone in their hand, not a figure they
// reconcile afterwards. So the screen is built around the difference between the
// three, not around a single utilisation percentage that hides which way it is
// going.
//
// COUNTED IN PEOPLE, NOT BOOKINGS. One registration can book an offer for four,
// and four people is four meals. The server does this arithmetic
// (offer-stats-service) so the screen and the entitlement that gets scanned agree
// about what "one" means.
//
// Contract (verified against backend routes/services):
//   · GET /fests/mine                                   → the admin's fests.
//   · GET /fests/:festId/offers                         → { festName, offers: [...] }
//     Both levels flattened into one list — the fest's own offers and each
//     event's — each carrying `scope` so two same-named offers are tellable apart.
//   · GET /fests/:festId/offers/:offerId/stats          → the numbers below.

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';

const COPY = {
  pageTitle: 'Offers',
  intro:
    'What each add-on sold, how much of it has been claimed, and how much is still owed. Counted in people, not bookings.',
  chooseFest: 'Choose a fest to see its offers.',
  noOffers: 'This fest has no add-ons configured yet.',
  loadFailed: 'The offers could not be loaded. Try again.',
  statsFailed: 'That offer’s numbers could not be loaded. Try again.',
  selectPrompt: 'Select an offer above to see how much of it has been used.',

  scopeFest: 'Fest-wide',
  scopeEvent: 'Event',
  inactive: 'Inactive',
  free: 'Free',

  bookings: 'Booked',
  bookingsSubtitle: 'people who paid for or selected this',
  checkIns: 'Claimed',
  checkInsSubtitle: 'accepted scans at its counters',
  currentlyUtilizing: 'Currently using',
  currentlyUtilizingSubtitle: 'claimed, not yet checked out',
  notYetUtilized: 'Still owed',
  notYetUtilizedSubtitle: 'booked but never claimed',

  breakdownHeading: 'By event',
  breakdownEmpty: 'No bookings or claims to break down yet.',
  columnEvent: 'Event',
  columnBookings: 'Booked',
  columnCheckIns: 'Claimed',
  columnCheckOuts: 'Checked out',
  noCounters:
    'This offer has no scannable counter yet, so nothing can be claimed against it. A counter is created when the fest is published.',
};

function formatRupees(paise) {
  if (!paise) {
    return COPY.free;
  }
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/* One offer as a selectable card. Booking/claim numbers are deliberately NOT on
 * the card: fetching stats for every offer to render a grid would be a dozen
 * aggregations for numbers most of which nobody is looking at. The card is the
 * catalogue; clicking it asks the question. */
function OfferCard({ offer, isSelected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={[
        'flex w-full flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition-colors',
        isSelected
          ? 'border-admin-primary-blue bg-admin-primary-blue/5'
          : 'border-admin-slate-200 bg-admin-surface-white hover:border-admin-primary-blue/40',
      ].join(' ')}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0 truncate font-admin-body text-[15px] font-semibold text-admin-neutral-ink">
          {offer.offerName}
        </span>
        {!offer.isActive ? (
          <AdminExecutiveChip tone="warning">{COPY.inactive}</AdminExecutiveChip>
        ) : null}
      </span>

      <span className="font-admin-mono text-[12px] text-admin-slate-600">
        {[
          offer.scope === 'event' ? `${COPY.scopeEvent} · ${offer.eventName ?? '—'}` : COPY.scopeFest,
          offer.isPaid ? formatRupees(offer.ratePaise) : COPY.free,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>

      {/* The axes matter for reading the numbers: an offer that collects a head
          count is booked in heads, which is why "Booked" can exceed the number
          of registrations. */}
      {offer.collectsNumberOfPeople || offer.collectsNumberOfDays ? (
        <span className="flex items-center gap-1 font-admin-mono text-[11px] text-admin-slate-600">
          <Users size={11} />
          {[
            offer.collectsNumberOfPeople ? 'per person' : null,
            offer.collectsNumberOfDays ? 'per day' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      ) : null}
    </button>
  );
}

function AdminOffersDashboardScreen() {
  const [searchParameters] = useSearchParams();
  const [fests, setFests] = useState([]);
  const { scope, handleScopeChange, setScope } = useAdminHierarchyScope(
    searchParameters.get('festId') ?? '',
  );
  const festId = scope.festId;

  const [offers, setOffers] = useState([]);
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const [stats, setStats] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [isLoadingOffers, setIsLoadingOffers] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/fests/mine')
      .then((list) => {
        if (!isActive) {
          return;
        }
        const safe = Array.isArray(list) ? list : [];
        setFests(safe);
        setScope((previous) => ({
          ...previous,
          festId: previous.festId || (safe.length === 1 ? safe[0].id : ''),
        }));
      })
      .catch(() => isActive && setFests([]));
    return () => {
      isActive = false;
    };
  }, [setScope]);

  const loadOffers = useCallback(async () => {
    if (!festId) {
      setOffers([]);
      return;
    }
    setIsLoadingOffers(true);
    setLoadError('');
    try {
      const result = await apiClient.get(`/fests/${festId}/offers`);
      setOffers(Array.isArray(result?.offers) ? result.offers : []);
    } catch (error) {
      setOffers([]);
      setLoadError(error?.message || COPY.loadFailed);
    } finally {
      setIsLoadingOffers(false);
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedOfferId('');
    setStats(null);
    loadOffers();
  }, [loadOffers]);

  async function selectOffer(offerId) {
    setSelectedOfferId(offerId);
    setStats(null);
    setLoadError('');
    setIsLoadingStats(true);
    try {
      setStats(await apiClient.get(`/fests/${festId}/offers/${offerId}/stats`));
    } catch (error) {
      setLoadError(error?.message || COPY.statsFailed);
    } finally {
      setIsLoadingStats(false);
    }
  }

  const breakdownColumns = [
    { key: 'eventName', header: COPY.columnEvent },
    { key: 'bookings', header: COPY.columnBookings, numeric: true, width: '110px' },
    { key: 'checkIns', header: COPY.columnCheckIns, numeric: true, width: '110px' },
    { key: 'checkOuts', header: COPY.columnCheckOuts, numeric: true, width: '130px' },
  ];

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <div>
        <p className="mt-1 max-w-prose font-admin-body text-[14px] leading-5 text-admin-slate-600">
          {COPY.intro}
        </p>
      </div>

      <AdminErrorBanner message={loadError} />

      {/* Fest only: an offer belongs to the fest or to one event, and the event
          level of the cascade would narrow a list that is already short. */}
      <AdminHierarchyFilter
        fests={fests}
        selectedFestId={scope.festId}
        selectedEventId=""
        selectedSubEventId=""
        onChange={(next) => handleScopeChange({ festId: next.festId, eventId: '', subEventId: '' })}
      />

      {!festId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.chooseFest}</p>
        </AdminExecutiveCard>
      ) : isLoadingOffers ? (
        <div className="flex h-[30vh] items-center justify-center">
          <span
            aria-label="Loading"
            className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
          />
        </div>
      ) : offers.length === 0 ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.noOffers}</p>
        </AdminExecutiveCard>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((offer) => (
              <OfferCard
                key={offer.offerId}
                offer={offer}
                isSelected={offer.offerId === selectedOfferId}
                onSelect={() => selectOffer(offer.offerId)}
              />
            ))}
          </div>

          {!selectedOfferId ? (
            <AdminExecutiveCard>
              <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">
                {COPY.selectPrompt}
              </p>
            </AdminExecutiveCard>
          ) : isLoadingStats ? (
            <div className="flex h-40 items-center justify-center">
              <span
                aria-label="Loading"
                className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
              />
            </div>
          ) : stats ? (
            <>
              {/* An offer with no counter can never be claimed, so the zeros
                  below would read as "nobody came" when the truth is "nobody
                  could". Said plainly rather than left to be inferred. */}
              {stats.counterCount === 0 ? (
                <p className="rounded-md border border-admin-status-warning-amber/30 bg-admin-status-warning-amber/5 px-4 py-3 font-admin-body text-[13px] leading-5 text-admin-neutral-ink">
                  {COPY.noCounters}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <AdminKpiCard
                  label={COPY.bookings}
                  value={stats.totalBookings}
                  subtitle={COPY.bookingsSubtitle}
                />
                <AdminKpiCard
                  label={COPY.checkIns}
                  value={stats.totalCheckIns}
                  subtitle={COPY.checkInsSubtitle}
                />
                <AdminKpiCard
                  label={COPY.currentlyUtilizing}
                  value={stats.currentlyUtilizing}
                  subtitle={COPY.currentlyUtilizingSubtitle}
                />
                <AdminKpiCard
                  label={COPY.notYetUtilized}
                  value={stats.notYetUtilized}
                  subtitle={COPY.notYetUtilizedSubtitle}
                />
              </div>

              <AdminExecutiveCard title={COPY.breakdownHeading}>
                <AdminExecutiveTable
                  className="mt-2"
                  columns={breakdownColumns}
                  rows={stats.eventBreakdown ?? []}
                  rowKey={(row) => row.eventId}
                  emptyMessage={COPY.breakdownEmpty}
                />
              </AdminExecutiveCard>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

export default AdminOffersDashboardScreen;
