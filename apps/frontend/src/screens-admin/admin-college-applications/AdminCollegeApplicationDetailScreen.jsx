// AdminCollegeApplicationDetailScreen.jsx
// Route: /admin/college-applications/:applicationId — one application in full,
// with the approve/reject decision. Superadmin-only (PlatformAdminRoute +
// backend platform-admin gate).
//
// Backend contract:
//   · GET  /admin/college-applications/:id → { application }.
//   · POST /admin/college-applications/:id/approve (no body) → { application }.
//     Approving creates the college, an administrator account, and emails the
//     applicant — the confirm modal says exactly that.
//   · POST /admin/college-applications/:id/reject { reason } (min 10 chars).
//   · Both return 409 APPLICATION_ALREADY_REVIEWED if already decided — the
//     message surfaces via AdminErrorBanner rather than being swallowed.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, ExternalLink, X } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveTextarea from '../../components-admin/admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import ApplicationStatusChip from './ApplicationStatusChip.jsx';
import { ADMIN_COLLEGE_APPLICATIONS_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { formatShortDate } from '../../helpers/admin-format.js';

const QUEUE_ROUTE = '/admin/college-applications';
const REJECT_REASON_MIN_LENGTH = 10;

function FieldRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-[160px] shrink-0 font-admin-body text-[13px] font-medium leading-5 text-admin-slate-600">
        {label}
      </dt>
      <dd className="min-w-0 break-words font-admin-body text-[14px] leading-5 text-admin-neutral-ink">
        {value || COPY.notProvided}
      </dd>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <h2 className="font-admin-display text-[18px] font-semibold leading-6 text-admin-neutral-ink">
      {children}
    </h2>
  );
}

// One dot + label + optional date in the vertical status timeline.
function TimelineStep({ label, date, state }) {
  const dotClass =
    state === 'success'
      ? 'bg-admin-status-success-green'
      : state === 'error'
        ? 'bg-admin-status-error-red'
        : state === 'done'
          ? 'bg-admin-primary-blue'
          : 'border border-admin-slate-200 bg-admin-surface-white';
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="min-w-0">
        <span
          className={[
            'block font-admin-body text-[14px] leading-5',
            state === 'upcoming' ? 'text-admin-slate-600' : 'font-medium text-admin-neutral-ink',
          ].join(' ')}
        >
          {label}
        </span>
        {date ? (
          <span className="block font-admin-mono text-[12px] leading-4 text-admin-slate-600">{date}</span>
        ) : null}
      </span>
    </li>
  );
}

function AdminCollegeApplicationDetailScreen() {
  const { applicationId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [application, setApplication] = useState(null);
  const [modal, setModal] = useState(null); // 'approve' | 'reject' | null
  const [rejectReason, setRejectReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let isActive = true;
    apiClient
      .get(`/admin/college-applications/${applicationId}`)
      .then((payload) => {
        if (!isActive) {
          return;
        }
        setApplication(payload?.application ?? null);
        setStatus(payload?.application ? 'ready' : 'error');
      })
      .catch(() => isActive && setStatus('error'));
    return () => {
      isActive = false;
    };
  }, [applicationId]);

  const isDecidable = application?.status === 'pending' || application?.status === 'underReview';
  const isRejectReasonValid = rejectReason.trim().length >= REJECT_REASON_MIN_LENGTH;

  async function decide(kind) {
    setIsBusy(true);
    setActionError('');
    try {
      if (kind === 'approve') {
        await apiClient.post(`/admin/college-applications/${applicationId}/approve`);
      } else {
        await apiClient.post(`/admin/college-applications/${applicationId}/reject`, {
          reason: rejectReason.trim(),
        });
      }
      // Success on either → back to the queue.
      navigate(QUEUE_ROUTE);
    } catch (decisionException) {
      // 409 APPLICATION_ALREADY_REVIEWED and friends land here, verbatim.
      setActionError(decisionException.message || COPY.actionFailed);
      setModal(null);
      setIsBusy(false);
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
      <div className="mx-auto flex max-w-[1000px] flex-col gap-4">
        <AdminErrorBanner message={COPY.detailLoadFailed} />
        <div>
          <AdminExecutiveButton variant="ghost" iconLeft={<ArrowLeft size={15} />} onClick={() => navigate(QUEUE_ROUTE)}>
            {COPY.backToQueue}
          </AdminExecutiveButton>
        </div>
      </div>
    );
  }

  const documentUrls = Array.isArray(application.documentUrls) ? application.documentUrls : [];
  const reviewer =
    application.reviewedByUserId && typeof application.reviewedByUserId === 'object'
      ? application.reviewedByUserId
      : null;

  // Timeline: Submitted always done; Under review done once past pending; the
  // decision step shows only its real outcome, or an upcoming placeholder pair
  // is avoided — one "Approved/Rejected" upcoming line while undecided.
  const isDecided = application.status === 'approved' || application.status === 'rejected';
  const decisionLabel =
    application.status === 'rejected' ? COPY.timelineRejected : COPY.timelineApproved;

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <div>
        <AdminExecutiveButton variant="ghost" size="small" iconLeft={<ArrowLeft size={15} />} onClick={() => navigate(QUEUE_ROUTE)}>
          {COPY.backToQueue}
        </AdminExecutiveButton>
        <div className="mt-3 flex items-center gap-3">
          <h1 className="min-w-0 truncate font-admin-display text-[24px] font-semibold leading-8 text-admin-neutral-ink">
            {application.collegeName}
          </h1>
          <ApplicationStatusChip status={application.status} />
        </div>
      </div>

      <AdminErrorBanner message={actionError} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left column — the application itself. */}
        <div className="flex min-w-0 flex-col gap-6">
          <AdminExecutiveCard>
            <SectionHeading>{COPY.collegeHeading}</SectionHeading>
            <dl className="mt-4 flex flex-col gap-3">
              <FieldRow label={COPY.fieldCollegeName} value={application.collegeName} />
              <FieldRow label={COPY.fieldCollegeAddress} value={application.collegeAddress} />
              <FieldRow label={COPY.fieldCollegeCity} value={application.collegeCity} />
              <FieldRow label={COPY.fieldCollegeState} value={application.collegeState} />
              <FieldRow
                label={COPY.fieldCollegeWebsite}
                value={
                  application.collegeWebsite ? (
                    <a
                      href={application.collegeWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-admin-primary-blue hover:underline"
                    >
                      {application.collegeWebsite}
                      <ExternalLink size={13} className="shrink-0" />
                    </a>
                  ) : null
                }
              />
              <FieldRow label={COPY.fieldExpectedFestSize} value={application.expectedFestSize} />
            </dl>
            {application.linkedCollegeId ? (
              <p className="mt-4 border-t border-admin-slate-200 pt-3 font-admin-body text-[13px] leading-5 text-admin-slate-600">
                {COPY.directoryMatchNote}
              </p>
            ) : null}
          </AdminExecutiveCard>

          <AdminExecutiveCard>
            <SectionHeading>{COPY.applicantHeading}</SectionHeading>
            <dl className="mt-4 flex flex-col gap-3">
              <FieldRow label={COPY.fieldApplicantName} value={application.applicantFullName} />
              <FieldRow
                label={COPY.fieldApplicantEmail}
                value={
                  application.applicantEmail ? (
                    <span className="font-admin-mono text-[13px]">{application.applicantEmail}</span>
                  ) : null
                }
              />
              <FieldRow
                label={COPY.fieldApplicantPhone}
                value={
                  application.applicantPhone ? (
                    <span className="font-admin-mono text-[13px]">{application.applicantPhone}</span>
                  ) : null
                }
              />
              <FieldRow label={COPY.fieldApplicantRole} value={application.applicantRole} />
            </dl>
          </AdminExecutiveCard>

          <AdminExecutiveCard>
            <SectionHeading>{COPY.notesHeading}</SectionHeading>
            {application.notesFromApplicant ? (
              <p className="mt-3 whitespace-pre-wrap font-admin-body text-[14px] leading-6 text-admin-neutral-ink">
                {application.notesFromApplicant}
              </p>
            ) : (
              <p className="mt-3 font-admin-body text-[13px] text-admin-slate-600">{COPY.noNotes}</p>
            )}
          </AdminExecutiveCard>

          <AdminExecutiveCard>
            <SectionHeading>{COPY.documentsHeading}</SectionHeading>
            {documentUrls.length === 0 ? (
              <p className="mt-3 font-admin-body text-[13px] text-admin-slate-600">{COPY.noDocuments}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {documentUrls.map((url, index) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-full items-center gap-1.5 font-admin-body text-[14px] text-admin-primary-blue hover:underline"
                    >
                      <ExternalLink size={14} className="shrink-0" />
                      <span className="truncate">{COPY.documentLinkLabel(index + 1)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </AdminExecutiveCard>
        </div>

        {/* Right column — status timeline and review outcome. */}
        <AdminExecutiveCard className="lg:sticky lg:top-6">
          <SectionHeading>{COPY.timelineHeading}</SectionHeading>
          <ol className="mt-4">
            <TimelineStep
              label={COPY.timelineSubmitted}
              date={formatShortDate(application.createdAt)}
              state="done"
            />
            <TimelineStep
              label={COPY.timelineUnderReview}
              state={application.status === 'pending' ? 'upcoming' : 'done'}
            />
            <TimelineStep
              label={decisionLabel}
              date={isDecided ? formatShortDate(application.reviewedAt) : null}
              state={
                application.status === 'approved'
                  ? 'success'
                  : application.status === 'rejected'
                    ? 'error'
                    : 'upcoming'
              }
            />
          </ol>

          {reviewer ? (
            <div className="mt-5 border-t border-admin-slate-200 pt-4">
              <span className="block font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                {COPY.reviewedByLabel}
              </span>
              <span className="mt-1 block truncate font-admin-body text-[14px] text-admin-neutral-ink">
                {reviewer.fullName ?? reviewer.emailAddress ?? COPY.notProvided}
              </span>
              {reviewer.emailAddress ? (
                <span className="block truncate font-admin-mono text-[13px] text-admin-slate-600">
                  {reviewer.emailAddress}
                </span>
              ) : null}
            </div>
          ) : null}

          {application.status === 'rejected' && application.rejectionReason ? (
            <div className="mt-5 border-t border-admin-slate-200 pt-4">
              <span className="block font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                {COPY.rejectionReasonLabel}
              </span>
              <p className="mt-1 whitespace-pre-wrap font-admin-body text-[14px] leading-5 text-admin-neutral-ink">
                {application.rejectionReason}
              </p>
            </div>
          ) : null}
        </AdminExecutiveCard>
      </div>

      {/* Footer actions — only while the application is still decidable. Decided
          applications render read-only with the outcome in the timeline. */}
      {isDecidable ? (
        <div className="flex items-center justify-end gap-3 border-t border-admin-slate-200 pt-5">
          <AdminExecutiveButton
            variant="danger"
            iconLeft={<X size={15} />}
            onClick={() => {
              setRejectReason('');
              setModal('reject');
            }}
          >
            {COPY.rejectAction}
          </AdminExecutiveButton>
          <AdminExecutiveButton variant="primary" iconLeft={<Check size={15} />} onClick={() => setModal('approve')}>
            {COPY.approveAction}
          </AdminExecutiveButton>
        </div>
      ) : null}

      <AdminModal
        isOpen={modal === 'approve'}
        title={COPY.approveModalTitle}
        confirmLabel={COPY.approveConfirm}
        cancelLabel={COPY.cancel}
        tone="primary"
        isBusy={isBusy}
        onConfirm={() => decide('approve')}
        onCancel={() => (isBusy ? null : setModal(null))}
      >
        {COPY.approveModalBody}
      </AdminModal>

      <AdminModal
        isOpen={modal === 'reject'}
        title={COPY.rejectModalTitle}
        confirmLabel={COPY.rejectConfirm}
        cancelLabel={COPY.cancel}
        tone="danger"
        isBusy={isBusy}
        confirmDisabled={!isRejectReasonValid}
        onConfirm={() => (isRejectReasonValid ? decide('reject') : null)}
        onCancel={() => (isBusy ? null : setModal(null))}
      >
        <p>{COPY.rejectModalBody}</p>
        <div className="mt-4">
          <AdminExecutiveTextarea
            label={COPY.rejectReasonLabel}
            required
            rows={4}
            value={rejectReason}
            placeholder={COPY.rejectReasonPlaceholder}
            helperText={COPY.rejectReasonHelp}
            onChange={(event) => setRejectReason(event.target.value)}
          />
        </div>
      </AdminModal>
    </div>
  );
}

export default AdminCollegeApplicationDetailScreen;
