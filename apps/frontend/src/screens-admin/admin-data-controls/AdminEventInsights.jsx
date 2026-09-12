// AdminEventInsights.jsx
// Everything the analytics summary carries about ONE event, rendered when the
// hierarchy filter has narrowed to one.
//
// IT RENDERS FROM `summary.perEventDeep`, WHICH IS ABSENT FEST-WIDE. The
// backend only computes that block when ?eventId= was passed, so its presence
// is the whole condition for showing this view — there is no second request and
// no second loading state.
//
// GREEN AND RED APPEAR EXACTLY ONCE HERE, in the comparison card, and that is
// deliberate. The admin palette is otherwise blue and slate on purpose; a
// dashboard that colours every number by sentiment teaches the reader to ignore
// colour. "Above or below the fest average" is genuinely semantic, so it gets
// the one place where those two colours mean something.
//
// AND THE COMPARISON HAS THREE STATES, NOT TWO. A metric 1% off the average is
// not "underperforming", and painting it red is how a dashboard manufactures
// panic about noise. Anything inside a small band reads as level, in slate.
//
// EVERY CARD IS INDEPENDENTLY EMPTY. A fest in its first week has
// registrations and nothing else — no scans, no teams, no certificates — and
// each card says so on its own rather than the screen going blank.

import { TrendingUp, TrendingDown, Minus, Trophy, Users, Clock } from 'lucide-react';
import AdminCollapsibleCard from '../../components-admin/admin-collapsible-card/AdminCollapsibleCard.jsx';
import AdminBreakdownBars from '../../components-admin/admin-chart-primitives/AdminBreakdownBars.jsx';
import AdminStackedBar from '../../components-admin/admin-chart-primitives/AdminStackedBar.jsx';
import AdminProgressRing from '../../components-admin/admin-chart-primitives/AdminProgressRing.jsx';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import AdminBarChart from './AdminBarChart.jsx';
import AdminLineChart from './AdminLineChart.jsx';

/* A difference smaller than this reads as level. Five percent of the fest
   average is the smallest gap worth drawing a reader's eye to on a metric that
   moves every time somebody registers. */
const COMPARISON_DEADBAND = 0.05;

/* The velocity trend arrow. `steady` gets a dash rather than an arrow: a flat
   week is not a direction, and drawing it as one invites the reader to read
   movement that is not there. */
const VELOCITY_ICONS = {
  accelerating: TrendingUp,
  decelerating: TrendingDown,
  steady: Minus,
};

const COPY = {
  noData: 'No data yet',
  registrations: 'Registrations',
  attendance: 'Attendance',
  revenue: 'Revenue',
  teams: 'Teams',
  certificates: 'Certificates',
  comparison: 'Compared with the fest',
};

function formatRupees(paise) {
  const rupees = Math.round((paise ?? 0) / 100);
  return `₹${rupees.toLocaleString('en-IN')}`;
}

function formatPercent(ratePair) {
  if (!ratePair || !Number.isFinite(ratePair.rate)) {
    return '0%';
  }
  return `${Math.round(ratePair.rate * 100)}%`;
}

function formatHour(hour) {
  if (hour === null || hour === undefined) {
    return '—';
  }
  const suffix = hour < 12 ? 'am' : 'pm';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

function formatMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

/* ── The capacity sentence ───────────────────────────────────────────────── */

/*
 * One sentence, chosen by the projection's own status rather than by the client
 * re-deriving it. The backend already decided whether a forecast is honest
 * here (see buildCapacityProjection), and two places deciding that would drift.
 */
function capacitySentence(capacity) {
  if (!capacity) {
    return COPY.noData;
  }
  if (capacity.status === 'noCapacity') {
    return 'No capacity set, so there is no fill to project.';
  }
  if (capacity.status === 'full') {
    return 'Full — every slot is taken.';
  }
  if (capacity.status === 'stalled') {
    return `${capacity.remainingSlots} slots left, and no registrations in the last week.`;
  }
  const on = new Date(capacity.projectedFullOn).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  return `At the last week's rate, full around ${on} (${capacity.daysToFill} days).`;
}

/* ── Comparison row ──────────────────────────────────────────────────────── */

function ComparisonRow({ label, value, average, formatValue }) {
  const hasAverage = Number.isFinite(average) && average !== 0;
  const delta = hasAverage ? (value - average) / Math.abs(average) : 0;
  const isLevel = !hasAverage || Math.abs(delta) < COMPARISON_DEADBAND;

  const Icon = isLevel ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const tone = isLevel
    ? 'text-admin-slate-600'
    : delta > 0
      ? 'text-admin-status-success-green'
      : 'text-admin-status-error-red';

  return (
    <tr className="border-b border-admin-slate-100 last:border-b-0">
      <td className="py-2 font-admin-body text-[13px] text-admin-neutral-ink">{label}</td>
      <td className="py-2 text-right font-admin-mono text-[13px] text-admin-neutral-ink">
        {formatValue(value)}
      </td>
      <td className="py-2 text-right font-admin-mono text-[13px] text-admin-slate-600">
        {formatValue(average)}
      </td>
      <td className={`py-2 pl-3 text-right ${tone}`}>
        <span className="inline-flex items-center gap-1 font-admin-mono text-[12px]">
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
          {isLevel ? 'level' : `${delta > 0 ? '+' : ''}${Math.round(delta * 100)}%`}
        </span>
      </td>
    </tr>
  );
}

/* ── Round drop-off ──────────────────────────────────────────────────────── */

/*
 * Connected dots rather than bars: the point is the SHAPE of the decline across
 * rounds, and bars invite the reader to compare each round against the others
 * when the question is how steeply the line falls.
 */
function RoundDropOff({ rounds }) {
  if (rounds.length === 0) {
    return <p className="py-6 text-center font-admin-body text-[13px] text-admin-slate-600">
      This event has no rounds.
    </p>;
  }

  return (
    <ol className="flex flex-wrap items-end gap-x-6 gap-y-3" role="list">
      {rounds.map((round) => (
        <li key={round.roundNumber} className="flex min-w-[72px] flex-col items-center gap-1">
          <span className="font-admin-display text-[18px] font-semibold text-admin-neutral-ink">
            {round.participantCount}
          </span>
          <span
            className="h-2 w-2 rounded-full bg-admin-primary-blue"
            style={{ opacity: Math.max(0.25, round.shareOfFirstRound.rate) }}
            aria-hidden="true"
          />
          <span className="font-admin-body text-[12px] text-admin-slate-600">
            {round.roundName}
          </span>
          <span className="font-admin-mono text-[11px] text-admin-slate-600">
            {formatPercent(round.shareOfFirstRound)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────── */

function AdminEventInsights({ deep, summary }) {
  if (!deep) {
    return null;
  }

  /*
   * Half of the registration card comes from the summary rather than from the
   * deep block, and that is not an oversight: the funnel, the daily series and
   * the demographics are ALREADY scoped by ?eventId= at analytics-service's
   * single narrowing point, so recomputing them per-event would be paying twice
   * for the same numbers and risking two answers to one question.
   */
  const funnel = summary?.funnel ?? {};
  const velocity = summary?.velocity ?? {};
  const demographics = summary?.demographics ?? {};
  const registrationSeries = (summary?.timeSeries?.registrationsPerDay ?? [])
    .slice(-30)
    .map((point) => ({ day: point.day, value: point.count ?? 0 }));
  const VelocityIcon = VELOCITY_ICONS[velocity.trend] ?? Minus;

  const {
    event,
    capacity,
    soloVersusTeam,
    attendance,
    rounds,
    teams,
    revenue,
    certificates,
    comparison,
    coRegistration,
  } = deep;

  const confirmed = capacity?.fill?.numerator ?? 0;
  const fillRate = capacity?.fill?.rate ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="flex flex-col gap-1">
          <AdminKpiCard label="Confirmed" value={confirmed.toLocaleString('en-IN')} />
          {/* The capacity bar sits UNDER the count rather than replacing it:
              "120" and "120 of 150" are different facts and an organiser needs
              both. Hidden entirely when no capacity is set, because a bar with
              no denominator is a decoration. */}
          {capacity?.status !== 'noCapacity' ? (
            <span
              className="h-1 w-full overflow-hidden rounded-full bg-admin-slate-200"
              title={`${Math.round(fillRate * 100)}% of capacity`}
            >
              <span
                className="block h-full rounded-full bg-admin-primary-blue"
                style={{ width: `${Math.min(100, fillRate * 100)}%` }}
              />
            </span>
          ) : null}
        </div>
        <AdminKpiCard label="Gross revenue" value={formatRupees(revenue?.grossRevenuePaise)} />
        <AdminKpiCard label="Check-in rate" value={formatPercent(attendance?.checkInRate)} />
        <AdminKpiCard label="Add-on revenue" value={formatRupees(revenue?.addOnRevenuePaise)} />
        {/* Teams for a team event, no-show rate for a solo one — the fifth slot
            shows whichever is meaningful rather than a permanent zero. */}
        {teams?.isTeamEvent ? (
          <AdminKpiCard label="Teams formed" value={String(teams.totalTeams)} />
        ) : (
          <AdminKpiCard label="No-show rate" value={formatPercent(attendance?.noShowRate)} />
        )}
      </div>

      {/* ── Two columns on desktop, one on mobile ───────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AdminCollapsibleCard title={COPY.registrations}>
          <div className="flex flex-col gap-5">
            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Capacity
              </p>
              <p className="font-admin-body text-[13px] leading-[18px] text-admin-neutral-ink">
                {capacitySentence(capacity)}
              </p>
            </div>

            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Funnel
              </p>
              {/*
                Stackable because the parts are disjoint and sum to the whole:
                analytics-service increments registrationsInitiated for EVERY
                registration and then sorts each into exactly one of the four
                below. paymentExpired is included because leaving it out makes
                the segments sum to less than the total and the bar renders with
                a gap the reader takes for a rendering fault.
              */}
              <AdminStackedBar
                total={funnel.registrationsInitiated ?? 0}
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
                    className: 'bg-admin-primary-blue/50',
                  },
                  {
                    key: 'cancelled',
                    label: 'Cancelled',
                    value: funnel.registrationsCancelled ?? 0,
                    className: 'bg-admin-slate-400',
                  },
                  {
                    key: 'expired',
                    label: 'Payment expired',
                    value: funnel.registrationsPaymentExpired ?? 0,
                    className: 'bg-admin-slate-300',
                  },
                ]}
                emptyLabel="No registrations yet"
              />
            </div>

            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Registrations per day
                {velocity.trend ? (
                  <span className="ml-2 inline-flex items-center gap-1 font-admin-mono text-[11px] normal-case tracking-normal text-admin-slate-600">
                    <VelocityIcon size={13} strokeWidth={2} aria-hidden="true" />
                    {velocity.trend}
                  </span>
                ) : null}
              </p>
              <AdminLineChart
                series={registrationSeries}
                emptyLabel="No registrations in this window"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                  Top colleges
                </p>
                <AdminBreakdownBars
                  rows={(demographics.byCollege ?? []).map((row) => ({
                    key: row.collegeId ?? row.collegeName,
                    label: row.collegeName,
                    value: row.count,
                  }))}
                  maxRows={3}
                  emptyLabel={COPY.noData}
                />
              </div>
              <div>
                <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                  Top departments
                </p>
                <AdminBreakdownBars
                  rows={(demographics.byDepartment ?? []).map((row) => ({
                    key: row.department,
                    label: row.department,
                    value: row.count,
                  }))}
                  maxRows={3}
                  emptyLabel={COPY.noData}
                />
              </div>
            </div>

            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Year of study
              </p>
              <AdminBreakdownBars
                rows={(demographics.byYearOfStudy ?? []).map((row) => ({
                  key: row.yearOfStudy,
                  label: row.yearOfStudy === 'unspecified' ? 'Unspecified' : `Year ${row.yearOfStudy}`,
                  value: row.count,
                }))}
                maxRows={6}
                emptyLabel={COPY.noData}
                variant="secondary"
              />
            </div>

            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Solo vs team
              </p>
              <AdminStackedBar
                segments={[
                  {
                    key: 'solo',
                    label: 'Solo',
                    value: soloVersusTeam?.soloCount ?? 0,
                    className: 'bg-admin-primary-blue',
                  },
                  {
                    key: 'team',
                    label: 'In a team',
                    value: soloVersusTeam?.teamCount ?? 0,
                    className: 'bg-admin-primary-blue/40',
                  },
                ]}
                emptyLabel={COPY.noData}
              />
            </div>
          </div>
        </AdminCollapsibleCard>

        <AdminCollapsibleCard title={COPY.attendance}>
          <div className="flex flex-col gap-5">
            <AdminProgressRing
              rate={attendance?.checkInRate?.rate ?? 0}
              label="Checked in"
              caption={`${attendance?.checkInRate?.numerator ?? 0} of ${
                attendance?.checkInRate?.denominator ?? 0
              } confirmed · ${attendance?.noShowRate?.numerator ?? 0} no-shows`}
            />

            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Arrival pattern
                {attendance?.peakHour !== null && attendance?.peakHour !== undefined ? (
                  <span className="ml-2 font-admin-mono text-[11px] normal-case tracking-normal">
                    peak {formatHour(attendance.peakHour)}
                  </span>
                ) : null}
              </p>
              <AdminBarChart
                series={(attendance?.scansByHour ?? []).map((bucket) => ({
                  day: formatHour(bucket.hour),
                  value: bucket.count,
                }))}
                highlightKey={
                  attendance?.peakHour !== null && attendance?.peakHour !== undefined
                    ? formatHour(attendance.peakHour)
                    : null
                }
                emptyLabel="No scans recorded yet"
              />
            </div>

            {attendance?.dwell?.observed ? (
              <p className="flex items-center gap-2 font-admin-body text-[13px] text-admin-neutral-ink">
                <Clock size={15} strokeWidth={1.75} className="text-admin-slate-600" />
                Average time at event: {formatMinutes(attendance.dwell.averageMinutes)}
                <span className="font-admin-mono text-[12px] text-admin-slate-600">
                  ({attendance.dwell.sampleCount} measured)
                </span>
              </p>
            ) : null}

            {rounds?.length > 0 ? (
              <div>
                <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                  Round drop-off
                </p>
                <RoundDropOff rounds={rounds} />
              </div>
            ) : null}
          </div>
        </AdminCollapsibleCard>

        <AdminCollapsibleCard title={COPY.revenue}>
          <div className="flex flex-col gap-5">
            <div>
              <p className="font-admin-display text-[24px] font-semibold text-admin-neutral-ink">
                {formatRupees(revenue?.revenuePerRegistrantPaise)}
              </p>
              <p className="font-admin-body text-[13px] text-admin-slate-600">per registrant</p>
            </div>

            <div>
              <p className="pb-1 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Add-on attach rate {formatPercent(revenue?.addOnAttachRate)}
              </p>
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-admin-slate-200">
                <span
                  className="block h-full rounded-full bg-admin-primary-blue"
                  style={{
                    width: `${Math.min(100, (revenue?.addOnAttachRate?.rate ?? 0) * 100)}%`,
                  }}
                />
              </span>
            </div>

            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Add-ons by offer
              </p>
              <AdminBreakdownBars
                rows={(revenue?.perOffer ?? []).map((offer) => ({
                  key: offer.offerId,
                  label: offer.offerKey,
                  value: offer.revenuePaise,
                  secondaryLabel: `${offer.orderCount}×`,
                }))}
                formatValue={formatRupees}
                emptyLabel="No add-ons sold for this event"
              />
            </div>

            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Free vs paid seats
              </p>
              <AdminStackedBar
                segments={[
                  {
                    key: 'paid',
                    label: 'Paid',
                    value: revenue?.freeVersusPaid?.paidCount ?? 0,
                    className: 'bg-admin-primary-blue',
                  },
                  {
                    key: 'free',
                    label: 'Free',
                    value: revenue?.freeVersusPaid?.freeCount ?? 0,
                    className: 'bg-admin-primary-blue/40',
                  },
                ]}
                emptyLabel={COPY.noData}
              />
            </div>

            {/*
              Payment status is FEST-scoped and labelled as such. A payment order
              carries a paymentGroupId and a purpose, never an eventId, so there
              is no honest per-event attribution — and an unlabelled fest number
              on an event screen is read as the event's.
            */}
            <div>
              <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                Payments (whole fest)
              </p>
              <AdminBreakdownBars
                rows={[
                  { key: 'captured', label: 'Captured', value: revenue?.paymentStatus?.captured ?? 0 },
                  { key: 'created', label: 'Unfinished', value: revenue?.paymentStatus?.created ?? 0 },
                  { key: 'failed', label: 'Failed', value: revenue?.paymentStatus?.failed ?? 0 },
                  {
                    key: 'refundPending',
                    label: 'Refund pending',
                    value: revenue?.paymentStatus?.refundPending ?? 0,
                  },
                ]}
                emptyLabel="No payment orders yet"
                maxRows={4}
              />
            </div>
          </div>
        </AdminCollapsibleCard>

        {teams?.isTeamEvent ? (
          <AdminCollapsibleCard title={COPY.teams}>
            <div className="flex flex-col gap-5">
              <div className="flex items-baseline gap-2">
                <span className="font-admin-display text-[24px] font-semibold text-admin-neutral-ink">
                  {teams.averageTeamSize}
                </span>
                <span className="font-admin-body text-[13px] text-admin-slate-600">
                  average team size across {teams.totalTeams} teams
                </span>
              </div>

              <div>
                <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                  Team sizes
                </p>
                <AdminBreakdownBars
                  rows={teams.sizeDistribution.map((bucket) => ({
                    key: String(bucket.size),
                    label: `${bucket.size} members`,
                    value: bucket.teamCount,
                  }))}
                  emptyLabel="No teams formed yet"
                  maxRows={8}
                />
              </div>

              <div>
                <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                  Locked vs forming
                </p>
                <AdminStackedBar
                  segments={[
                    {
                      key: 'locked',
                      label: 'Locked',
                      value: teams.teamsLocked,
                      className: 'bg-admin-primary-blue',
                    },
                    {
                      key: 'forming',
                      label: 'Still forming',
                      value: teams.teamsForming,
                      className: 'bg-admin-primary-blue/40',
                    },
                  ]}
                  emptyLabel={COPY.noData}
                />
              </div>

              {/*
                "Proxy" is in the label on purpose. Every team is created with
                exactly one invite code and there is no redemption ledger, so
                this is teams-that-grew-past-their-leader, not a tracked funnel.
              */}
              <p className="flex items-center gap-2 font-admin-body text-[13px] text-admin-neutral-ink">
                <Users size={15} strokeWidth={1.75} className="text-admin-slate-600" />
                {teams.inviteCodes.redeemedProxy} of {teams.inviteCodes.generated} teams grew
                beyond their leader ({formatPercent(teams.inviteCodes.conversion)})
              </p>
            </div>
          </AdminCollapsibleCard>
        ) : null}

        <AdminCollapsibleCard title={COPY.certificates}>
          <div className="flex flex-col gap-5">
            <p className="flex items-center gap-2 font-admin-body text-[13px] text-admin-neutral-ink">
              <Trophy size={15} strokeWidth={1.75} className="text-admin-slate-600" />
              {certificates?.participationCoverage?.numerator ?? 0} of{' '}
              {certificates?.participationCoverage?.denominator ?? 0} participants have a
              certificate
            </p>
            <AdminBreakdownBars
              rows={(certificates?.byType ?? []).map((row) => ({
                key: row.certificateType,
                label: row.certificateType,
                value: row.count,
              }))}
              emptyLabel="No certificates issued yet"
              maxRows={8}
            />
          </div>
        </AdminCollapsibleCard>

        {comparison ? (
          <AdminCollapsibleCard title={COPY.comparison}>
            <div className="flex flex-col gap-5">
              <p className="font-admin-body text-[14px] font-medium text-admin-neutral-ink">
                #{comparison.rank} of {comparison.rankedEventCount} events by registrations
              </p>

              <table className="w-full">
                <thead>
                  <tr className="border-b border-admin-slate-200">
                    <th className="pb-1 text-left font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                      Metric
                    </th>
                    <th className="pb-1 text-right font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                      This event
                    </th>
                    <th className="pb-1 text-right font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                      Fest avg
                    </th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody>
                  <ComparisonRow
                    label="Registrations"
                    value={comparison.thisEvent.registrations}
                    average={comparison.festAverage.registrations}
                    formatValue={(value) => Math.round(value).toLocaleString('en-IN')}
                  />
                  <ComparisonRow
                    label="Revenue per head"
                    value={comparison.thisEvent.revenuePerHeadPaise}
                    average={comparison.festAverage.revenuePerHeadPaise}
                    formatValue={formatRupees}
                  />
                  <ComparisonRow
                    label="Capacity fill"
                    value={fillRate}
                    average={comparison.festAverage.fillRate}
                    formatValue={(value) => `${Math.round(value * 100)}%`}
                  />
                </tbody>
              </table>

              <div>
                <p className="pb-2 font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                  Participants also registered for
                </p>
                <AdminBreakdownBars
                  rows={(coRegistration ?? []).map((row) => ({
                    key: row.eventId,
                    label: row.eventName,
                    value: row.sharedParticipantCount,
                    secondaryLabel: formatPercent(row.shareOfThisEvent),
                  }))}
                  emptyLabel="No overlap with other events yet"
                  variant="secondary"
                />
              </div>
            </div>
          </AdminCollapsibleCard>
        ) : null}
      </div>

      {event?.eventName ? (
        <p className="font-admin-body text-[12px] text-admin-slate-600">
          Scoped to {event.eventName}. Clear the event filter above for fest-wide figures.
        </p>
      ) : null}
    </div>
  );
}

export default AdminEventInsights;
