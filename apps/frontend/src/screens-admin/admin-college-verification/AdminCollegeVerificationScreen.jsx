// AdminCollegeVerificationScreen.jsx
// Route: /admin/system/colleges — the platform owner's college onboarding queue.
//
// Superadmin-only at every layer:
//   · the sidebar item is flagged platformAdminOnly (hidden for regular admins),
//   · the route wraps this screen in a isPlatformAdmin guard in App.jsx,
//   · and the backend gates GET /colleges/all and POST /colleges/:id/verification
//     behind requirePlatformAdminMiddleware anyway.
//
// Backend contract (college-controller.js / college-service.js):
//   · GET /colleges/all → { colleges } — every college, pending first, with
//     createdByUserId populated as { fullName, emailAddress }.
//   · POST /colleges/:collegeId/verification { isVerified } → { college }.

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import { buildCsv, downloadCsv } from '../../helpers/admin-csv.js';
import { formatCollegeAddressLines } from '../../helpers/college-address.js';
import { ADMIN_COLLEGE_VERIFICATION_COPY as COPY } from '../../brand-admin/brand-copy.js';

function AdminCollegeVerificationScreen() {
  const [status, setStatus] = useState('loading');
  const [colleges, setColleges] = useState([]);
  const [actionError, setActionError] = useState('');
  const [busyCollegeId, setBusyCollegeId] = useState('');

  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/colleges/all')
      .then((payload) => {
        if (!isActive) {
          return;
        }
        setColleges(Array.isArray(payload?.colleges) ? payload.colleges : []);
        setStatus('ready');
      })
      .catch(() => isActive && setStatus('error'));
    return () => {
      isActive = false;
    };
  }, []);

  async function setVerification(college, isVerified) {
    setBusyCollegeId(college.id);
    setActionError('');
    try {
      const payload = await apiClient.post(`/colleges/${college.id}/verification`, { isVerified });
      const updated = payload?.college;
      // The verification response does not re-populate createdByUserId, so keep
      // the row's existing creator and take only the flipped flag.
      setColleges((previous) =>
        previous.map((row) =>
          row.id === college.id ? { ...row, isVerified: updated?.isVerified ?? isVerified } : row,
        ),
      );
    } catch (actionException) {
      setActionError(actionException.message || COPY.actionFailed);
    } finally {
      setBusyCollegeId('');
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
    return <AdminErrorBanner message={COPY.loadFailed} />;
  }

  /*
   * The college directory as a sheet, address included so it can be reconciled
   * against AISHE records offline. Built client-side from the list already
   * loaded — there is no server-side college export to stream.
   */
  function handleDownloadCsv() {
    const headers = [
      'collegeName', 'commonName', 'isVerified', 'status',
      'addressLine1', 'addressLine2', 'addressLine3', 'addressLine4',
      'city', 'townOrLocality', 'district', 'state', 'pinCode', 'country',
    ];
    const rows = colleges.map((college) => [
      college.collegeName ?? '',
      college.commonName ?? '',
      college.isVerified ? 'yes' : 'no',
      college.status ?? '',
      college.address?.addressLine1 ?? '',
      college.address?.addressLine2 ?? '',
      college.address?.addressLine3 ?? '',
      college.address?.addressLine4 ?? '',
      college.address?.city ?? college.city ?? '',
      college.address?.townOrLocality ?? '',
      college.address?.district ?? '',
      college.address?.state ?? college.state ?? '',
      college.address?.pinCode ?? '',
      college.address?.country ?? '',
    ]);
    downloadCsv(`colleges-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, rows));
  }

  const columns = [
    {
      key: 'college',
      header: COPY.columnCollege,
      render: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
            {row.commonName}
          </span>
          <span className="block truncate font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
            {row.collegeName}
          </span>
        </span>
      ),
    },
    {
      key: 'city',
      header: COPY.columnCity,
      render: (row) => (
        <span className="font-admin-body text-[14px] text-admin-neutral-ink">
          {[row.city, row.state].filter(Boolean).join(', ')}
        </span>
      ),
    },
    {
      /*
       * The FULL structured address, so the verifier can read it straight
       * across from the uploaded proof document without opening another screen.
       * A migrated college shows its placeholder PIN (000000) plainly — that is
       * the signal that the college has not supplied a real address yet.
       */
      key: 'address',
      header: COPY.columnAddress,
      render: (row) => {
        const addressLines = formatCollegeAddressLines(row.address);
        if (addressLines.length === 0) {
          return (
            <span className="font-admin-body text-[13px] text-admin-slate-600">{COPY.addressMissing}</span>
          );
        }
        return (
          <span className="block max-w-[280px]">
            {addressLines.map((addressLine) => (
              <span
                key={addressLine}
                className="block truncate font-admin-body text-[13px] leading-[18px] text-admin-neutral-ink"
              >
                {addressLine}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: COPY.columnStatus,
      render: (row) => (
        <AdminExecutiveChip tone={row.isVerified ? 'success' : 'warning'}>
          {row.isVerified ? COPY.verifiedBadge : COPY.pendingBadge}
        </AdminExecutiveChip>
      ),
    },
    {
      key: 'registeredBy',
      header: COPY.columnRegisteredBy,
      render: (row) => {
        // Populated { fullName, emailAddress } — null for seeded colleges.
        const creator = row.createdByUserId;
        if (!creator || typeof creator !== 'object') {
          return (
            <span className="font-admin-body text-[14px] text-admin-slate-600">{COPY.unknownUser}</span>
          );
        }
        return (
          <span className="min-w-0">
            <span className="block truncate font-admin-body text-[14px] text-admin-neutral-ink">
              {creator.fullName ?? creator.emailAddress ?? COPY.unknownUser}
            </span>
            <span className="block truncate font-admin-mono text-[13px] text-admin-slate-600">
              {creator.emailAddress ?? ''}
            </span>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: COPY.columnActions,
      align: 'right',
      width: '120px',
      render: (row) => (
        <AdminExecutiveButton
          variant={row.isVerified ? 'secondary' : 'primary'}
          size="small"
          loading={busyCollegeId === row.id}
          onClick={() => setVerification(row, !row.isVerified)}
        >
          {row.isVerified ? COPY.unverifyAction : COPY.verifyAction}
        </AdminExecutiveButton>
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <div>
        <h1 className="font-admin-display text-[24px] font-semibold leading-8 text-admin-neutral-ink">
          {COPY.pageTitle}
        </h1>
        <p className="mt-1 font-admin-body text-[14px] leading-5 text-admin-slate-600">{COPY.intro}</p>
      </div>

      <AdminErrorBanner message={actionError} />

      <div className="flex justify-end">
        <AdminExecutiveButton
          variant="secondary"
          iconLeft={<Download size={15} />}
          disabled={colleges.length === 0}
          onClick={handleDownloadCsv}
        >
          {COPY.downloadCsv}
        </AdminExecutiveButton>
      </div>

      <AdminExecutiveTable columns={columns} rows={colleges} emptyMessage={COPY.empty} />
    </div>
  );
}

export default AdminCollegeVerificationScreen;
