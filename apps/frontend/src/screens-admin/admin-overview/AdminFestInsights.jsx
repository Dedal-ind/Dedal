// AdminFestInsights.jsx
// The selected fest's analytics, rendered from the ONE summary response the
// overview screen already fetches.
//
// THE DATA WAS ALREADY ON THE WIRE. AdminOverviewScreen called
// GET /fests/:id/analytics/summary and then kept `summaryData.headline`,
// discarding the funnel, the revenue, the time series, the demographics and —
// once they existed — all six of the newer blocks. Nothing here adds a request;
// it stops the response being thrown away.
//
// ADMIN TOKENS THROUGHOUT. The console's palette is its own (see
// brand-admin/brand-colors.js). The participant app's --primary is #ff3b30 and
// means "live" there; it has no business in a surface built to be quiet.
//
// EVERY SECTION SURVIVES EMPTY DATA. A fest in its first week has no
// certificates, no add-ons and no scans, and that is the normal case rather
// than an error — so each block renders zeroes and a neutral sentence.

import { Award, CheckCircle2, Star, Trophy } from 'lucide-react';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import AdminCollapsibleCard from '../../components-admin/admin-collapsible-card/AdminCollapsibleCard.jsx';
import AdminBreakdownBars from '../../components-admin/admin-chart-primitives/AdminBreakdownBars.jsx';
import AdminStackedBar from '../../components-admin/admin-chart-primitives/AdminStackedBar.jsx';
import AdminLineChart from '../admin-data-controls/AdminLineChart.jsx';
import { formatPaiseAmount } from '../../helpers/event-format.js';

const TREND_SENTENCE = {
  accelerating: 'Registrations are accelerating',
  decelerating: 'Registrations are decelerating',
  steady: 'Registrations are steady',
};

/* Certificates grouped the way an organiser thinks about them, not the way the
   enum lists them: three winner tiers are one idea, and the three staff types
   are another. specialMention stands alone because it is neither. */
const CERTIFICATE_GROUPS = [
  { key: 'winners', label: 'Winners', Icon: Trophy, types: ['winner1st', 'winner2nd', 'winner3rd'] },
  { key: 'participation', label: 'Participation', Icon: CheckCircle2, types: ['participation'] },
  { key: 'crew', label: 'Crew', Icon: Star, types: ['coordinator', 'volunteer', 'administrator'] },
  { key: 'special', label: 'Special mention', Icon: Award, types: ['specialMention'] },
];

const PURPOSE_LABEL = {
  registration: 'Registrations',
  addOn: 'Add-ons',
  contingent: 'Contingents',
};

function percent(ratePair) {
  if (!ratePair || !ratePair.denominator) {
    return '0%';
  }
  return `${Math.round(ratePair.rate * 100)}%`;
}

/* 14 → "2:00 PM". The backend already resolved the hour into IST, so this is
   only the 24→12 conversion and must not shift the value again. */
function formatHour(hour) {
  if (hour === null || hour === undefined) {
    return null;
  }
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${suffix}`;
}

function LastDays({ series, take = 30 }) {
  return series.length > take ? series.slice(-take) : series;
}

function AdminFestInsights({ summary, eventNameById }) {
  if (!summary) {
    return null;
  }

  const funnel = summary.funnel ?? {};
  const revenue = summary.revenue ?? {};
  const addOns = summary.addOns ?? {};
  const contingents = summary.contingents ?? {};
  const attendance = summary.attendance ?? {};
  const certificates = summary.certificates ?? {};
  const revenueByPurpose = summary.revenueByPurpose ?? {};
  const velocity = summary.velocity ?? {};
  const nameFor = (eventId) => eventNameById?.get(eventId) ?? 'Unnamed event';

  const registrationSeries = LastDays({ series: summary.timeSeries?.registrationsPerDay ?? [] });
  const revenueSeries = LastDays({ series: summary.timeSeries?.revenuePerDayPaise ?? [] });

  const certificateRows = CERTIFICATE_GROUPS.map((group) => {
    const count = (certificates.byType ?? [])
      .filter((row) => group.types.includes(row.certificateType))
      .reduce((running, row) => running + row.count, 0);
    return { ...group, count };
  });

  return (
    <div className="flex flex-col gap-4">
      {/* ── Headline KPIs ──────────────────────────────────────────────────
          Four numbers, always rendered. A zero is an answer — a blank card is
          a question about whether the panel loaded. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpiCard
          label="Confirmed registrations"
          value={(funnel.registrationsConfirmed ?? 0).toLocaleString('en-IN')}
        />
        <AdminKpiCard
          label="Revenue collected"
          value={formatPaiseAmount(revenue.grossRevenuePaise ?? 0)}
        />
        <AdminKpiCard label="Check-in rate" value={percent(attendance.checkInRate)} />
        <AdminKpiCard
          label="Add-on revenue"
          value={formatPaiseAmount(addOns.revenuePaise ?? 0)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* ── Registrations ───────────────────────────────────────────── */}
        <AdminCollapsibleCard title="Registrations">
          <div className="flex flex-col gap-5">
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="font-admin-body text-[13px] text-admin-slate-600">Funnel</span>
                <span className="font-admin-mono text-[13px] text-admin-neutral-ink">
                  {percent(funnel.conversion)} converted
                </span>
              </div>
              {/*
                `registrationsInitiated` is the TOTAL — the service increments it
                for every registration and then sorts each into exactly one of
                the four below — so these partition it and the bar fills once.
                paymentExpired is included; without it the segments sum to less
                than the total and the bar shows a gap that reads as a fault.
              */}
              <AdminStackedBar
                total={funnel.registrationsInitiated ?? 0}
                emptyLabel="No registrations yet"
                formatValue={(value) => value.toLocaleString('en-IN')}
                segments={[
                  {
                    key: 'confirmed',
                    label: 'Confirmed',
                    value: funnel.registrationsConfirmed ?? 0,
                    className: 'bg-admin-primary-blue',
                  },
                  {
                    key: 'pending',
                    label: 'Pending payment',
                    value: funnel.registrationsPendingPayment ?? 0,
                    className: 'bg-admin-primary-blue/40',
                  },
                  {
                    key: 'expired',
                    label: 'Payment expired',
                    value: funnel.registrationsPaymentExpired ?? 0,
                    className: 'bg-admin-slate-200',
                  },
                  {
                    key: 'cancelled',
                    label: 'Cancelled',
                    value: funnel.registrationsCancelled ?? 0,
                    className: 'bg-admin-slate-600/40',
                  },
                ]}
              />
            </div>

            <div>
              <p className="mb-2 font-admin-body text-[13px] text-admin-slate-600">
                Registrations per day
              </p>
              <AdminLineChart
                series={registrationSeries}
                emptyLabel="No registrations yet"
                formatValue={(value) => value.toLocaleString('en-IN')}
              />
            </div>

            <div>
              <p className="mb-2 font-admin-body text-[13px] text-admin-slate-600">
                Top events by registrations
              </p>
              <AdminBreakdownBars
                emptyLabel="No registrations yet"
                formatValue={(value) => value.toLocaleString('en-IN')}
                rows={(funnel.perEvent ?? []).map((row) => ({
                  key: row.eventId,
                  label: row.eventName ?? nameFor(row.eventId),
                  value: row.registrationsConfirmed ?? 0,
                }))}
              />
            </div>
          </div>
        </AdminCollapsibleCard>

        {/* ── Revenue ─────────────────────────────────────────────────── */}
        <AdminCollapsibleCard title="Revenue">
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-2 font-admin-body text-[13px] text-admin-slate-600">
                Revenue by event
              </p>
              <AdminBreakdownBars
                emptyLabel="No revenue yet"
                formatValue={formatPaiseAmount}
                rows={(revenue.perEventRevenue ?? []).map((row) => ({
                  key: row.eventId,
                  label: row.eventName ?? nameFor(row.eventId),
                  value: row.grossPaise ?? 0,
                }))}
              />
            </div>

            {/*
              BY PURPOSE, not by payment method. PaymentOrderModel never stores
              the Razorpay method — card, UPI and netbanking are not written to
              our side — so a by-method breakdown cannot be computed from this
              database at all. The response says so with
              paymentMethodBreakdownAvailable, and the panel is omitted rather
              than rendered empty, which would read as a failed load.
            */}
            <div>
              <p className="mb-2 font-admin-body text-[13px] text-admin-slate-600">
                Revenue by purpose
              </p>
              <AdminBreakdownBars
                emptyLabel="No captured payments yet"
                formatValue={formatPaiseAmount}
                rows={(revenueByPurpose.byPurpose ?? []).map((row) => ({
                  key: row.purposeType,
                  label: PURPOSE_LABEL[row.purposeType] ?? row.purposeType,
                  value: row.totalPaise ?? 0,
                }))}
              />
            </div>

            <div>
              <p className="mb-2 font-admin-body text-[13px] text-admin-slate-600">
                Add-ons by offer
              </p>
              <AdminBreakdownBars
                variant="secondary"
                emptyLabel="No add-ons sold yet"
                formatValue={(value) => `${value} sold`}
                rows={(addOns.byOffer ?? []).map((row) => ({
                  key: `${row.scope}:${row.offerKey}`,
                  label: row.offerKey,
                  value: row.orderCount ?? 0,
                }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 border-t border-admin-slate-100 pt-4">
              <Stat label="Contingent revenue" value={formatPaiseAmount(contingents.revenuePaise ?? 0)} />
              <Stat label="Purchases" value={(contingents.totalPurchases ?? 0).toLocaleString('en-IN')} />
              <Stat label="Slots filled" value={percent(contingents.slotFill)} />
            </div>
          </div>
        </AdminCollapsibleCard>

        {/* ── Attendance ──────────────────────────────────────────────────
            Skipped entirely when no checkpoint has ever been scanned: a check-in
            panel at a fest that has not opened its gates is four zeroes and a
            question. */}
        {(attendance.perGate?.length ?? 0) > 0 ? (
          <AdminCollapsibleCard title="Attendance">
            <div className="flex flex-col gap-5">
              {attendance.peakHour ? (
                <p className="font-admin-display text-[20px] font-semibold leading-7 text-admin-neutral-ink">
                  Most check-ins at {formatHour(attendance.peakHour.hour)}
                </p>
              ) : null}

              <div>
                <p className="mb-2 font-admin-body text-[13px] text-admin-slate-600">
                  Check-ins by event
                </p>
                <AdminBreakdownBars
                  emptyLabel="No check-ins yet"
                  formatValue={(value) => value.toLocaleString('en-IN')}
                  rows={(attendance.perEvent ?? []).map((row) => ({
                    key: row.eventId,
                    label: nameFor(row.eventId),
                    value: row.attendeeCount ?? 0,
                    secondaryLabel: percent(row.checkInRate),
                  }))}
                />
              </div>

              {/* Only when there is more than one gate — a single gate's
                  throughput is the fest total already shown above. */}
              {attendance.perGate.length > 1 ? (
                <div>
                  <p className="mb-2 font-admin-body text-[13px] text-admin-slate-600">
                    Gate throughput
                  </p>
                  <AdminBreakdownBars
                    variant="secondary"
                    emptyLabel="No scans yet"
                    maxRows={6}
                    formatValue={(value) => value.toLocaleString('en-IN')}
                    rows={attendance.perGate.map((row) => ({
                      key: row.checkpointId,
                      label: row.checkpointName,
                      value: row.attendeeCount ?? 0,
                    }))}
                  />
                </div>
              ) : null}
            </div>
          </AdminCollapsibleCard>
        ) : null}

        {/* ── Certificates ────────────────────────────────────────────── */}
        <AdminCollapsibleCard title="Certificates">
          <div className="flex flex-col gap-4">
            <p className="font-admin-display text-[28px] font-bold leading-9 text-admin-neutral-ink">
              {(certificates.totalIssued ?? 0).toLocaleString('en-IN')}
              <span className="ml-2 font-admin-body text-[13px] font-normal text-admin-slate-600">
                issued
              </span>
            </p>

            <ul className="flex flex-col gap-2" role="list">
              {certificateRows.map(({ key, label, Icon, count }) => (
                <li key={key} className="flex items-center gap-3">
                  <Icon size={16} strokeWidth={1.75} className="shrink-0 text-admin-slate-600" />
                  <span className="flex-1 font-admin-body text-[13px] text-admin-neutral-ink">
                    {label}
                  </span>
                  <span className="font-admin-mono text-[13px] text-admin-neutral-ink">
                    {count.toLocaleString('en-IN')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </AdminCollapsibleCard>

        {/* ── Engagement ──────────────────────────────────────────────── */}
        <AdminCollapsibleCard title="Engagement">
          <div className="flex flex-col gap-4">
            <p className="font-admin-display text-[20px] font-semibold leading-7 text-admin-neutral-ink">
              {TREND_SENTENCE[velocity.trend] ?? TREND_SENTENCE.steady}
            </p>
            <p className="font-admin-body text-[13px] text-admin-slate-600">
              {(velocity.registrationsThisWindow ?? 0).toLocaleString('en-IN')} in the last{' '}
              {velocity.windowDays ?? 7} days, against{' '}
              {(velocity.registrationsPreviousWindow ?? 0).toLocaleString('en-IN')} the week before.
            </p>

            {/* A countdown only while there is something to count down to. Once
                the fest has started the number goes negative and the sentence
                stops being true, so it is replaced rather than hidden. */}
            {velocity.daysUntilFest !== null && velocity.daysUntilFest !== undefined ? (
              <p className="font-admin-body text-[13px] text-admin-slate-600">
                {velocity.festHasStarted
                  ? 'The fest has started.'
                  : `${velocity.daysUntilFest} ${velocity.daysUntilFest === 1 ? 'day' : 'days'} until the fest opens.`}
              </p>
            ) : null}

            <div>
              <p className="mb-2 font-admin-body text-[13px] text-admin-slate-600">
                Revenue per day
              </p>
              <AdminLineChart
                series={revenueSeries}
                emptyLabel="No revenue yet"
                formatValue={(value) => formatPaiseAmount(value)}
              />
            </div>
          </div>
        </AdminCollapsibleCard>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-admin-mono text-[15px] font-semibold text-admin-neutral-ink">
        {value}
      </span>
      <span className="font-admin-body text-[12px] leading-4 text-admin-slate-600">{label}</span>
    </div>
  );
}

export default AdminFestInsights;
