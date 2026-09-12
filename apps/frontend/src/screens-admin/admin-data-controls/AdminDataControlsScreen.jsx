// AdminDataControlsScreen.jsx
// Route: /admin/system/data-controls — analytics, exports, hygiene and
// configuration for one fest at a time (the :festId is the hard scope of every
// backend endpoint this screen calls). Platform admins get a fifth, cross-fest
// tab; its visibility here is UX only — the backend's platform-admin middleware
// is the real control.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import apiClient, { getStoredAuthToken } from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminBarChart from './AdminBarChart.jsx';
import AdminEventInsights from './AdminEventInsights.jsx';
import { formatDepartmentLabel } from '../../helpers/department-format.js';
import { ADMIN_DATA_CONTROLS_COPY as COPY } from '../../brand-admin/brand-copy.js';

function formatRupees(paise) {
  return `₹${((paise ?? 0) / 100).toLocaleString('en-IN')}`;
}

function percentPair(pair, noun) {
  const percent = pair.denominator > 0 ? Math.round(pair.rate * 100) : 0;
  return {
    headline: `${percent}%`,
    detail: COPY.pairOf(pair.numerator, pair.denominator, noun),
  };
}

/*
 * Streaming download with the Bearer header. window.location.href cannot carry
 * the Authorization header this API requires, so the browser fetches the stream
 * and hands it over as a blob — the SERVER still streams row-by-row (the
 * constraint that matters); the browser holding one CSV in memory is fine.
 */
async function downloadExport(path, fallbackName) {
  const response = await fetch(`${apiClient.defaults.baseURL}${path}`, {
    headers: { Authorization: `Bearer ${getStoredAuthToken()}` },
  });
  if (!response.ok) {
    throw new Error(`Export failed with ${response.status}`);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

/* A compact count list with each bucket's share of a named total. */
function BucketList({ heading, buckets, total, labelOf }) {
  return (
    <div>
      <h3 className="font-admin-body text-[13px] font-semibold text-admin-neutral-ink">{heading}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {buckets.map((bucket, index) => {
          const share = total > 0 ? Math.round((bucket.count / total) * 100) : 0;
          return (
            <li key={index} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-admin-body text-[13px] text-admin-neutral-ink">
                {labelOf(bucket)}
              </span>
              <span className="shrink-0 font-admin-mono text-[12px] tabular-nums text-admin-slate-600">
                {bucket.count} · {share}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AnalyticsTab({ summary }) {
  const attendance = percentPair(summary.funnel.attendance, 'confirmed attended');
  const conversion = summary.funnel.conversion;
  const offersClaimed = summary.offers.reduce((sum, offer) => sum + offer.claimedCount, 0);
  const offersSelected = summary.offers.reduce((sum, offer) => sum + offer.selectedCount, 0);
  const demographics = summary.demographics;

  const perEventRows = summary.funnel.perEvent
    .map((event) => ({
      ...event,
      grossPaise:
        summary.revenue.perEventRevenue.find((row) => row.eventId === event.eventId)?.grossPaise ?? 0,
    }))
    .sort((left, right) => right.grossPaise - left.grossPaise);

  return (
    <div className="flex flex-col gap-6">
      {/* No event select here: the shared cascade at the top of the screen
          scopes every count below — KPIs, charts and per-event breakdowns. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <AdminKpiCard
          label={COPY.kpiConfirmed}
          value={summary.funnel.registrationsConfirmed.toLocaleString('en-IN')}
          subtitle={COPY.pairOf(conversion.numerator, conversion.denominator, 'initiated converted')}
        />
        <AdminKpiCard
          label={COPY.kpiRevenue}
          value={formatRupees(summary.revenue.grossRevenuePaise)}
          subtitle={`${formatRupees(summary.revenue.pendingRevenuePaise)} pending`}
        />
        <AdminKpiCard label={COPY.kpiAttendance} value={attendance.headline} subtitle={attendance.detail} />
        <AdminKpiCard
          label={COPY.kpiOffersClaimed}
          value={offersClaimed.toLocaleString('en-IN')}
          subtitle={COPY.pairOf(offersClaimed, offersSelected, 'selected claimed')}
        />
      </div>

      <AdminExecutiveCard title={COPY.registrationsPerDayHeading}>
        <AdminBarChart
          series={summary.timeSeries.registrationsPerDay.map((point) => ({ day: point.day, value: point.count }))}
          emptyLabel={COPY.chartEmpty}
        />
      </AdminExecutiveCard>

      <AdminExecutiveCard title={COPY.revenuePerDayHeading}>
        <AdminBarChart
          series={summary.timeSeries.revenuePerDayPaise.map((point) => ({ day: point.day, value: point.paise }))}
          formatValue={formatRupees}
          emptyLabel={COPY.chartEmpty}
        />
      </AdminExecutiveCard>

      <AdminExecutiveCard title={COPY.perEventHeading}>
        <AdminExecutiveTable
          columns={[
            { key: 'eventName', header: COPY.columnEvent },
            { key: 'registrationsConfirmed', header: COPY.columnConfirmed, numeric: true },
            {
              key: 'capacity',
              header: COPY.columnCapacity,
              render: (row) => (
                <span className="font-admin-mono text-[13px] tabular-nums">{row.capacity ?? '—'}</span>
              ),
            },
            {
              key: 'fill',
              header: COPY.columnFillRate,
              render: (row) => (
                <span className="font-admin-mono text-[13px] tabular-nums">
                  {row.capacity
                    ? COPY.pairOf(row.registrationsConfirmed, row.capacity, '')
                    : '—'}
                </span>
              ),
            },
            {
              key: 'grossPaise',
              header: COPY.columnGrossRevenue,
              align: 'right',
              render: (row) => (
                <span className="font-admin-mono text-[13px] tabular-nums">{formatRupees(row.grossPaise)}</span>
              ),
            },
          ]}
          rows={perEventRows}
          rowKey={(row) => row.eventId}
        />
      </AdminExecutiveCard>

      <AdminExecutiveCard title={COPY.demographicsHeading}>
        <p className="mb-4 font-admin-body text-[13px] text-admin-slate-600">
          {COPY.demographicsTotalPrefix}{' '}
          <span className="font-semibold text-admin-neutral-ink">
            {demographics.totalConfirmedParticipants}
          </span>{' '}
          {COPY.demographicsTotalSuffix}
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <BucketList
            heading={COPY.demographicByCollege}
            buckets={demographics.byCollege}
            total={demographics.totalConfirmedParticipants}
            labelOf={(bucket) => bucket.collegeName}
          />
          <BucketList
            heading={COPY.demographicByDepartment}
            buckets={demographics.byDepartment.slice(0, 10)}
            total={demographics.totalConfirmedParticipants}
            labelOf={(bucket) =>
              bucket.department === 'unspecified'
                ? COPY.unspecifiedBucket
                : formatDepartmentLabel(bucket.department) ?? bucket.department
            }
          />
          <BucketList
            heading={COPY.demographicByYear}
            buckets={demographics.byYearOfStudy}
            total={demographics.totalConfirmedParticipants}
            labelOf={(bucket) =>
              bucket.yearOfStudy === 'unspecified' ? COPY.unspecifiedBucket : `Year ${bucket.yearOfStudy}`
            }
          />
          <BucketList
            heading={COPY.demographicByGender}
            buckets={demographics.byGender}
            total={demographics.totalConfirmedParticipants}
            labelOf={(bucket) =>
              bucket.gender === 'unspecified' ? COPY.unspecifiedBucket : bucket.gender
            }
          />
        </div>
      </AdminExecutiveCard>

      {summary.offers.length > 0 ? (
        <AdminExecutiveCard title={COPY.offersHeading}>
          <AdminExecutiveTable
            columns={[
              { key: 'offerName', header: COPY.columnOffer },
              { key: 'selectedCount', header: COPY.columnSelected, numeric: true },
              { key: 'claimedCount', header: COPY.columnClaimed, numeric: true },
              {
                key: 'redemption',
                header: COPY.columnRedemption,
                render: (row) => {
                  const pair = percentPair(row.redemption, 'selected claimed');
                  return (
                    <span className="font-admin-mono text-[13px] tabular-nums">
                      {pair.headline} <span className="text-admin-slate-600">({pair.detail})</span>
                    </span>
                  );
                },
              },
            ]}
            rows={summary.offers}
            rowKey={(row) => row.offerId}
          />
        </AdminExecutiveCard>
      ) : null}

      <AdminExecutiveCard title={COPY.teamsHeading}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {[
            [COPY.teamsForming, summary.teams.teamsForming],
            [COPY.teamsLocked, summary.teams.teamsLocked],
            [COPY.teamsCancelled, summary.teams.teamsCancelled],
            [
              COPY.teamsAverageSize,
              summary.teams.averageTeamSizeOnConfirmed != null
                ? summary.teams.averageTeamSizeOnConfirmed.toFixed(1)
                : '—',
            ],
            [COPY.teamsAtMinimum, summary.teams.teamsLockedExactlyAtMinimum],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                {label}
              </p>
              <p className="mt-1 font-admin-display text-[20px] font-semibold text-admin-neutral-ink">
                {value}
              </p>
            </div>
          ))}
        </div>
      </AdminExecutiveCard>
    </div>
  );
}

const EXPORT_GROUPS = [
  {
    heading: COPY.exportGroupParticipant,
    exports: [
      { key: 'registrations', label: COPY.exportRegistrations, path: 'registrations.csv' },
      { key: 'certificates', label: COPY.exportCertificates, path: 'certificates.csv' },
      { key: 'feedback', label: COPY.exportFeedback, path: 'feedback.csv' },
    ],
  },
  {
    heading: COPY.exportGroupFinancial,
    exports: [{ key: 'payments', label: COPY.exportPayments, path: 'payments.csv' }],
  },
  {
    heading: COPY.exportGroupOperations,
    exports: [
      { key: 'scans', label: COPY.exportScans, path: 'scans.csv' },
      { key: 'staffAssignments', label: COPY.exportStaff, path: 'staff-assignments.csv' },
    ],
  },
  {
    heading: COPY.exportGroupCompliance,
    exports: [{ key: 'auditLogs', label: COPY.exportAuditLog, path: 'audit-log.csv' }],
  },
];

function ExportsTab({ festId, counts, onError, scopeQuery = '' }) {
  const [busyKey, setBusyKey] = useState(null);

  async function handleDownload(exportEntry) {
    setBusyKey(exportEntry.key);
    try {
      // Exports carry the cascade's scope, so a filtered screen downloads a
      // filtered sheet rather than silently the whole fest.
      await downloadExport(
        `/fests/${festId}/exports/${exportEntry.path}${scopeQuery}`,
        exportEntry.path,
      );
    } catch {
      onError(COPY.exportFailed);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-md border border-admin-status-warning-amber/40 bg-admin-status-warning-amber/10 px-4 py-3 font-admin-body text-[13px] leading-[18px] text-admin-neutral-ink">
        {COPY.exportsNotice}
      </p>
      {EXPORT_GROUPS.map((group) => (
        <AdminExecutiveCard key={group.heading} title={group.heading}>
          <div className="flex flex-col gap-3">
            {group.exports.map((exportEntry) => {
              const rowCount = counts?.[exportEntry.key] ?? 0;
              return (
                <div key={exportEntry.key} className="flex items-center justify-between gap-4">
                  <span className="font-admin-body text-[14px] text-admin-neutral-ink">
                    {exportEntry.label}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-admin-mono text-[12px] tabular-nums text-admin-slate-600">
                      {rowCount > 0 ? COPY.exportRowCount(rowCount) : COPY.exportEmpty}
                    </span>
                    <AdminExecutiveButton
                      variant="secondary"
                      size="small"
                      iconLeft={<Download size={14} />}
                      disabled={rowCount === 0}
                      loading={busyKey === exportEntry.key}
                      onClick={() => handleDownload(exportEntry)}
                    >
                      CSV
                    </AdminExecutiveButton>
                  </div>
                </div>
              );
            })}
            {/* The staff export also exists in a FILTERED form (role/status/
                event), which lives with its filters on the Staff Assignments
                screen — same endpoint, same columns, no schema drift. */}
            {group.heading === COPY.exportGroupOperations ? (
              <Link
                to={`/admin/events/assignments?festId=${festId}`}
                className="font-admin-body text-[13px] font-medium text-admin-primary-blue underline"
              >
                {COPY.exportStaffFiltered}
              </Link>
            ) : null}
          </div>
        </AdminExecutiveCard>
      ))}
    </div>
  );
}

function HygieneTab({ report }) {
  const [openCode, setOpenCode] = useState(null);
  return (
    <div className="flex flex-col gap-3">
      <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.hygieneIntro}</p>
      {report.findings.map((finding) => {
        const isClean = finding.count === 0;
        const isOpen = openCode === finding.code;
        return (
          <div key={finding.code} className="rounded-lg border border-admin-slate-200 bg-admin-surface-white">
            <div className="flex items-center gap-3 px-4 py-3">
              {isClean ? (
                <CheckCircle2 size={16} className="shrink-0 text-admin-status-success-green" />
              ) : (
                <AlertTriangle size={16} className="shrink-0 text-admin-status-error-red" />
              )}
              <p className="min-w-0 flex-1 font-admin-body text-[14px] text-admin-neutral-ink">
                {finding.description}
              </p>
              <span
                className={[
                  'shrink-0 rounded-md px-2 py-0.5 font-admin-mono text-[12px] font-semibold tabular-nums',
                  isClean
                    ? 'bg-admin-status-success-green/10 text-admin-status-success-green'
                    : 'bg-admin-status-error-red/10 text-admin-status-error-red',
                ].join(' ')}
              >
                {isClean ? COPY.hygieneClean : COPY.hygieneIssues(finding.count)}
              </span>
              {!isClean ? (
                <button
                  type="button"
                  onClick={() => setOpenCode(isOpen ? null : finding.code)}
                  aria-expanded={isOpen}
                  className="shrink-0 font-admin-body text-[13px] font-medium text-admin-primary-blue"
                >
                  {isOpen ? COPY.hygieneHideSample : COPY.hygieneViewSample}
                </button>
              ) : null}
            </div>
            {isOpen ? (
              <ul className="border-t border-admin-slate-200 px-4 py-3">
                {finding.sampleIds.map((sampleId) => (
                  <li key={sampleId} className="font-admin-mono text-[12px] text-admin-slate-600">
                    {sampleId}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {/* No fix buttons on purpose — a mass "reap now" is how a bad afternoon
          becomes a lost weekend. Findings are symptoms; fixes are decisions. */}
      <p className="font-admin-body text-[12px] italic text-admin-slate-600">{COPY.hygieneNoActionsNote}</p>
    </div>
  );
}

function ConfigurationTab({ festId, fest, counts, onError, scopeQuery = '' }) {
  const [isDownloading, setIsDownloading] = useState(false);

  /*
   * The "snapshot" fires every applicable export sequentially plus the fest
   * metadata as JSON. An in-repo zip library (none is in package.json, and none
   * is being added for this) would consolidate these into one .zip later.
   */
  async function handleSnapshot() {
    setIsDownloading(true);
    try {
      const metadataBlob = new Blob([JSON.stringify(fest, null, 2)], { type: 'application/json' });
      const metadataUrl = URL.createObjectURL(metadataBlob);
      const anchor = document.createElement('a');
      anchor.href = metadataUrl;
      anchor.download = `${COPY.snapshotMetadataName}-${fest.festSlug}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(metadataUrl);

      for (const group of EXPORT_GROUPS) {
        for (const exportEntry of group.exports) {
          if ((counts?.[exportEntry.key] ?? 0) > 0) {
            // Sequential on purpose: one browser-initiated download at a time.
            await downloadExport(
              `/fests/${festId}/exports/${exportEntry.path}${scopeQuery}`,
              exportEntry.path,
            );
          }
        }
      }
    } catch {
      onError(COPY.exportFailed);
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminExecutiveCard title={COPY.snapshotHeading} description={COPY.snapshotBody}>
        <AdminExecutiveButton
          variant="primary"
          iconLeft={<Download size={15} />}
          loading={isDownloading}
          onClick={handleSnapshot}
        >
          {COPY.snapshotButton}
        </AdminExecutiveButton>
      </AdminExecutiveCard>
      <AdminExecutiveCard title={COPY.retentionHeading}>
        <p className="font-admin-body text-[14px] leading-5 text-admin-slate-600">{COPY.retentionBody}</p>
      </AdminExecutiveCard>
    </div>
  );
}

function PlatformTab({ platform }) {
  const totalFests = Object.values(platform.totalFests).reduce((sum, count) => sum + count, 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-5">
        <AdminKpiCard label={COPY.platformKpiColleges} value={String(platform.totalColleges)} />
        <AdminKpiCard
          label={COPY.platformKpiFests}
          value={String(totalFests)}
          subtitle={Object.entries(platform.totalFests)
            .map(([status, count]) => `${count} ${status}`)
            .join(' · ')}
        />
        <AdminKpiCard label={COPY.platformKpiEvents} value={String(platform.totalPublishedEvents)} />
        <AdminKpiCard
          label={COPY.platformKpiConfirmed}
          value={platform.totalConfirmedRegistrationsAllTime.toLocaleString('en-IN')}
          subtitle={COPY.pairOf(
            platform.totalConfirmedRegistrationsAllTime,
            platform.totalRegistrationsAllTime,
            'initiated',
          )}
        />
        <AdminKpiCard label={COPY.platformKpiRevenue} value={formatRupees(platform.totalGrossRevenuePaise)} />
      </div>
      <AdminExecutiveCard title={COPY.platformRegistrationsHeading}>
        <AdminBarChart
          series={platform.registrationsPerDay.map((point) => ({ day: point.day, value: point.count }))}
          emptyLabel={COPY.chartEmpty}
        />
      </AdminExecutiveCard>
      <AdminExecutiveCard title={COPY.platformSignInsHeading}>
        <AdminBarChart
          series={platform.signInsPerDay.map((point) => ({ day: point.day, value: point.count }))}
          emptyLabel={COPY.chartEmpty}
        />
      </AdminExecutiveCard>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <AdminExecutiveCard title={COPY.platformTopFests}>
          <AdminExecutiveTable
            columns={[
              { key: 'festName', header: COPY.columnFest },
              { key: 'confirmedCount', header: COPY.columnConfirmed, numeric: true },
            ]}
            rows={platform.topFestsByConfirmedCount}
            rowKey={(row) => row.festId}
          />
        </AdminExecutiveCard>
        <AdminExecutiveCard title={COPY.platformTopColleges}>
          <AdminExecutiveTable
            columns={[
              { key: 'collegeName', header: COPY.columnCollege },
              { key: 'festCount', header: COPY.columnFests, numeric: true },
            ]}
            rows={platform.topCollegesByAdministratorActivity}
            rowKey={(row) => row.collegeId}
          />
        </AdminExecutiveCard>
      </div>
    </div>
  );
}

function AdminDataControlsScreen() {
  const { isPlatformAdmin } = useAuthentication();
  const [fests, setFests] = useState([]);
  // The shared cascade replaces this screen's own fest picker AND the
  // Analytics tab's separate event select.
  const { scope, handleScopeChange, setScope, scopeQuery } = useAdminHierarchyScope();
  const festId = scope.festId;
  const [status, setStatus] = useState('loading');
  const [activeTab, setActiveTab] = useState('analytics');
  const [summary, setSummary] = useState(null);
  /*
   * Section-C event filter: '' = all events (unchanged behaviour). The summary
   * endpoint applies ?eventId= at its single narrowing point, so EVERY count in
   * the response is scoped consistently — never a mix.
   */
  const [hygiene, setHygiene] = useState(null);
  const [counts, setCounts] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [tabError, setTabError] = useState('');

  // The admin's fests come from /fests/mine — administrator assignments are
  // college-level, so administeredFests off the auth context is empty for them.
  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/fests/mine')
      .then((list) => {
        if (!isActive) return;
        const safeFests = Array.isArray(list) ? list : [];
        setFests(safeFests);
        setScope((previous) => ({
          ...previous,
          festId: previous.festId || (safeFests.length >= 1 ? safeFests[0].id : ''),
        }));
        setStatus('ready');
      })
      .catch(() => isActive && setStatus('error'));
    return () => {
      isActive = false;
    };
  }, [setScope]);

  const loadFestData = useCallback(async () => {
    if (!festId) {
      return;
    }
    setTabError('');
    setSummary(null);
    setHygiene(null);
    setCounts(null);
    try {
      /*
       * scopeQuery is "" fest-wide, "?eventId=X&includeDescendants=true" for a
       * chosen event (so its sub-events count too), and "?eventId=X" for a
       * chosen sub-event. Every KPI on the tab rescopes from this one string.
       */
      const summaryPath = `/fests/${festId}/analytics/summary${scopeQuery}`;
      const [summaryData, hygieneData, countsData] = await Promise.all([
        apiClient.get(summaryPath),
        apiClient.get(`/fests/${festId}/analytics/hygiene`),
        apiClient.get(`/fests/${festId}/exports/counts`),
      ]);
      setSummary(summaryData);
      setHygiene(hygieneData);
      setCounts(countsData);
    } catch {
      setTabError(COPY.loadError);
    }
  }, [festId, scopeQuery]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFestData();
  }, [loadFestData]);

  useEffect(() => {
    if (!isPlatformAdmin) {
      return undefined;
    }
    let isActive = true;
    apiClient
      .get('/analytics/platform')
      .then((data) => isActive && setPlatform(data))
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [isPlatformAdmin]);

  const selectedFest = useMemo(() => fests.find((fest) => fest.id === festId) ?? null, [fests, festId]);

  const tabs = [
    { id: 'analytics', label: COPY.tabAnalytics },
    { id: 'exports', label: COPY.tabExports },
    { id: 'hygiene', label: COPY.tabHygiene },
    { id: 'configuration', label: COPY.tabConfiguration },
    ...(isPlatformAdmin ? [{ id: 'platform', label: COPY.tabPlatform }] : []),
  ];

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
      <div className="mx-auto max-w-[900px]">
        <AdminErrorBanner message={COPY.loadError} />
      </div>
    );
  }
  if (fests.length === 0) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col items-center gap-2 rounded-lg border-2 border-dashed border-admin-slate-200 bg-admin-surface-white px-6 py-16 text-center">
        <p className="font-admin-display text-[20px] font-semibold text-admin-neutral-ink">
          {COPY.noFestsTitle}
        </p>
        <p className="font-admin-body text-[14px] text-admin-slate-600">{COPY.noFestsBody}</p>
      </div>
    );
  }

  return (
    /*
     * Capped at 1200px and centred, matching AdminOverviewScreen. The layout's
     * <main> is unconstrained, which suits the export tables but not this tab:
     * on a wide monitor the five KPI cards stretch to hold a four-digit number
     * and a breakdown bar puts its label and its value a screen apart. The cap
     * is on the screen rather than in AdminLayout so the wide tabular screens
     * keep the width they need.
     */
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      </div>

      {/* The shared cascade replaces this screen's fest-only picker AND the
          Analytics tab's separate event select. */}
      <AdminHierarchyFilter
        fests={fests}
        selectedFestId={scope.festId}
        selectedEventId={scope.eventId}
        selectedSubEventId={scope.subEventId}
        onChange={handleScopeChange}
        className="sticky top-0 z-10 bg-admin-surface-off-white py-2"
      />

      {/* Tabs, following the AdminScoringScreen pattern. */}
      <div className="flex gap-1 border-b border-admin-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={[
              'rounded-t-md px-4 py-2 font-admin-body text-[14px] font-medium transition-colors',
              activeTab === tab.id
                ? 'border border-b-0 border-admin-slate-200 bg-admin-surface-white text-admin-neutral-ink'
                : 'text-admin-slate-600 hover:text-admin-neutral-ink',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AdminErrorBanner message={tabError} />
      {tabError ? (
        <div>
          <AdminExecutiveButton variant="secondary" onClick={loadFestData}>
            {COPY.retry}
          </AdminExecutiveButton>
        </div>
      ) : null}

      {activeTab === 'analytics' && summary ? (
        <>
          {/*
            PER-EVENT DEPTH FIRST, when an event is selected.
            `perEventDeep` is only computed by the backend when ?eventId=
            narrowed the scope, so its presence IS the condition — no second
            request, no separate loading state, and nothing to keep in sync with
            the filter above. The fest-wide tab still renders underneath, since
            its funnel and exports remain correct under the narrowed scope.
          */}
          {summary.perEventDeep ? (
            <AdminEventInsights deep={summary.perEventDeep} summary={summary} />
          ) : null}
          <AnalyticsTab summary={summary} />
        </>
      ) : null}
      {activeTab === 'exports' && counts ? (
        <ExportsTab festId={festId} counts={counts} onError={setTabError} scopeQuery={scopeQuery} />
      ) : null}
      {activeTab === 'hygiene' && hygiene ? <HygieneTab report={hygiene} /> : null}
      {activeTab === 'configuration' && selectedFest ? (
        <ConfigurationTab festId={festId} fest={selectedFest} counts={counts} onError={setTabError} />
      ) : null}
      {activeTab === 'platform' && isPlatformAdmin && platform ? <PlatformTab platform={platform} /> : null}
    </div>
  );
}

export default AdminDataControlsScreen;
