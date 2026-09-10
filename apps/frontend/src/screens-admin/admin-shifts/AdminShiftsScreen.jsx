// AdminShiftsScreen.jsx
// Route: /admin/events/shifts — schedule the fest's volunteers onto checkpoints.
//
// Honesty notes, all forced by the real backend (volunteer-shift-*):
//   · A shift binds an ACTIVE volunteer to a checkpoint for a window; the create
//     payload is exactly { userId, checkpointId, startsAt, endsAt }.
//   · PATCH accepts checkpointId/startsAt/endsAt only — the volunteer on a shift
//     cannot be changed, so the edit form locks that field.
//   · Shifts are cancelled, never deleted (POST .../cancel with an optional
//     cancellationReason); a cancelled shift cannot be edited or re-cancelled.
//   · The list defaults to scheduled server-side; "all" is the backend's special
//     status value that lifts the filter.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarPlus, BellRing } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_SHIFTS_COPY as COPY } from '../../brand-admin/brand-copy.js';

const STATUS_CHIP_TONES = { scheduled: 'info', cancelled: 'error' };

const EMPTY_FORM = { userId: '', checkpointId: '', startsAt: '', endsAt: '' };

// "21 Jul, 14:00" in IST — shift windows are times of day, so the short date
// alone (admin-format's formatShortDate) would hide the half that matters.
function formatShiftTime(value) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// datetime-local value ("2026-07-28T14:00") from an ISO string, in the admin's
// own timezone — what the input needs to round-trip an existing window.
function toDatetimeLocalValue(isoValue) {
  if (!isoValue) {
    return '';
  }
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const offsetMilliseconds = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}

function describeError(error, fallbackMessage) {
  const detailEntries = Object.entries(error?.details ?? {});
  const detailText = detailEntries.map(([field, complaint]) => `${field} ${complaint}`).join('; ');
  const message = error?.message || fallbackMessage;
  return detailText ? `${message} (${detailText})` : message;
}

function AdminShiftsScreen() {
  const [status, setStatus] = useState('loading');
  const [fests, setFests] = useState([]);
  const [searchParameters] = useSearchParams();
  // Shared cascade; festId stays as the derived name every read below uses.
  const { scope, handleScopeChange, setScope, activeEventId } = useAdminHierarchyScope();
  const festId = scope.festId;
  const [shifts, setShifts] = useState([]);
  const [volunteers, setVolunteers] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');

  // One form serves create and edit; editingShiftId decides which mutation runs.
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  // Cancel flow.
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  // Drives the LIVE badge below; ticks once a minute, which is as precise as a
  // shift window needs to be.
  const [nowMilliseconds, setNowMilliseconds] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMilliseconds(Date.now()), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

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
        // ?festId= wins over the single-fest default: the staff-assignments
        // screen's "schedule them" nudge links here already meaning one fest.
        const requestedFestId = searchParameters.get('festId');
        const isRequestedFestReal = safe.some((fest) => fest.id === requestedFestId);
        setScope((previous) => ({
          ...previous,
          festId:
            previous.festId ||
            (isRequestedFestReal ? requestedFestId : '') ||
            (safe.length === 1 ? safe[0].id : ''),
        }));
        setStatus('ready');
      })
      .catch(() => isActive && setStatus('error'));
    return () => {
      isActive = false;
    };
  }, [searchParameters, setScope]);

  const loadShifts = useCallback(async (id, filterValue) => {
    if (!id) {
      setShifts([]);
      return;
    }
    const result = await apiClient
      .get(`/fests/${id}/shifts?status=${encodeURIComponent(filterValue)}`)
      .catch(() => ({ shifts: [] }));
    setShifts(Array.isArray(result?.shifts) ? result.shifts : []);
  }, []);

  const loadFestData = useCallback(
    async (id, filterValue) => {
      if (!id) {
        setShifts([]);
        setVolunteers([]);
        setCheckpoints([]);
        return;
      }
      const [volunteerResult, checkpointResult] = await Promise.all([
        apiClient.get(`/fests/${id}/volunteers`).catch(() => ({ volunteers: [] })),
        apiClient.get(`/fests/${id}/checkpoints`).catch(() => ({ checkpoints: [] })),
      ]);
      setVolunteers(Array.isArray(volunteerResult?.volunteers) ? volunteerResult.volunteers : []);
      setCheckpoints(Array.isArray(checkpointResult?.checkpoints) ? checkpointResult.checkpoints : []);
      await loadShifts(id, filterValue);
    },
    [loadShifts],
  );

  useEffect(() => {
    // A fest switch drops any in-progress edit and its messages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(EMPTY_FORM);
    setEditingShiftId(null);
    setActionError('');
    setNotice('');
    loadFestData(festId, statusFilter);
    // statusFilter is intentionally absent: filter changes reload only the list below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [festId, loadFestData]);

  // Filter changes reload only the list, from the handler rather than an effect.
  function changeStatusFilter(nextFilter) {
    setStatusFilter(nextFilter);
    loadShifts(festId, nextFilter);
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEdit(shift) {
    setEditingShiftId(shift.shiftId);
    setForm({
      userId: shift.userId,
      checkpointId: shift.checkpointId,
      startsAt: toDatetimeLocalValue(shift.startsAt),
      endsAt: toDatetimeLocalValue(shift.endsAt),
    });
    setFormError('');
    setNotice('');
  }

  function discardEdit() {
    setEditingShiftId(null);
    setForm(EMPTY_FORM);
    setFormError('');
  }

  async function submitForm(formEvent) {
    formEvent.preventDefault();
    setFormError('');
    setActionError('');
    setNotice('');
    if (!editingShiftId && !form.userId) {
      setFormError(COPY.volunteerRequired);
      return;
    }
    if (!form.checkpointId) {
      setFormError(COPY.checkpointRequired);
      return;
    }
    if (!form.startsAt || !form.endsAt) {
      setFormError(COPY.windowRequired);
      return;
    }
    setIsSubmitting(true);
    try {
      const window = {
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      };
      if (editingShiftId) {
        await apiClient.patch(`/fests/${festId}/shifts/${editingShiftId}`, {
          checkpointId: form.checkpointId,
          ...window,
        });
        setNotice(COPY.editSucceeded);
      } else {
        await apiClient.post(`/fests/${festId}/shifts`, {
          userId: form.userId,
          checkpointId: form.checkpointId,
          ...window,
        });
        setNotice(COPY.createSucceeded);
      }
      setForm(EMPTY_FORM);
      setEditingShiftId(null);
      await loadShifts(festId, statusFilter);
    } catch (submitException) {
      setActionError(describeError(submitException, COPY.loadError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) {
      return;
    }
    setIsCancelling(true);
    setActionError('');
    setNotice('');
    try {
      const trimmedReason = cancelReason.trim();
      await apiClient.post(
        `/fests/${festId}/shifts/${cancelTarget.shiftId}/cancel`,
        trimmedReason ? { cancellationReason: trimmedReason } : {},
      );
      setCancelTarget(null);
      setCancelReason('');
      if (editingShiftId === cancelTarget.shiftId) {
        discardEdit();
      }
      await loadShifts(festId, statusFilter);
    } catch (cancelException) {
      setActionError(describeError(cancelException, COPY.loadError));
      setCancelTarget(null);
      setCancelReason('');
    } finally {
      setIsCancelling(false);
    }
  }

  const shiftColumns = useMemo(
    () => [
      {
        key: 'volunteer',
        header: COPY.columnVolunteer,
        render: (shift) => (
          <span className="min-w-0">
            <span className="block truncate font-medium text-admin-neutral-ink">
              {shift.userFullName ?? '—'}
            </span>
            <span className="block truncate font-admin-mono text-[12px] text-admin-slate-600">
              {shift.userEmailAddress ?? ''}
            </span>
          </span>
        ),
      },
      {
        key: 'checkpoint',
        header: COPY.columnCheckpoint,
        render: (shift) => {
          /*
           * A LIVE badge when the shift window contains right now — the admin's
           * at-a-glance "someone should be scanning there this minute".
           *
           * Informational ONLY. A real push notification (FCM/APNs) needs mobile
           * app registration, notification permissions and a delivery backend —
           * out of scope here. The "Alert volunteers" button above sends the
           * email version.
           */
          const startsAtMs = shift.startsAt ? new Date(shift.startsAt).getTime() : null;
          const endsAtMs = shift.endsAt ? new Date(shift.endsAt).getTime() : null;
          const isLiveNow =
            shift.status === 'scheduled' &&
            startsAtMs !== null &&
            endsAtMs !== null &&
            nowMilliseconds >= startsAtMs &&
            nowMilliseconds <= endsAtMs;
          return (
            <span className="flex items-center gap-2">
              <span>{shift.checkpointName ?? '—'}</span>
              {isLiveNow ? (
                <AdminExecutiveChip tone="success">{COPY.shiftLiveNow}</AdminExecutiveChip>
              ) : null}
            </span>
          );
        },
      },
      {
        key: 'startsAt',
        header: COPY.columnStarts,
        render: (shift) => (
          <span className="font-admin-mono text-[13px]">{formatShiftTime(shift.startsAt)}</span>
        ),
      },
      {
        key: 'endsAt',
        header: COPY.columnEnds,
        render: (shift) => (
          <span className="font-admin-mono text-[13px]">{formatShiftTime(shift.endsAt)}</span>
        ),
      },
      {
        key: 'status',
        header: COPY.columnStatus,
        render: (shift) => (
          <AdminExecutiveChip tone={STATUS_CHIP_TONES[shift.status] ?? 'neutral'}>
            {shift.status}
          </AdminExecutiveChip>
        ),
      },
      {
        key: 'actions',
        header: COPY.columnActions,
        align: 'right',
        render: (shift) =>
          shift.status === 'scheduled' ? (
            <span className="inline-flex items-center gap-1">
              <AdminExecutiveButton variant="ghost" size="small" onClick={() => startEdit(shift)}>
                {COPY.editAction}
              </AdminExecutiveButton>
              <AdminExecutiveButton
                variant="ghost"
                size="small"
                className="text-admin-status-error-red hover:bg-admin-status-error-red/5"
                onClick={() => setCancelTarget(shift)}
              >
                {COPY.cancelAction}
              </AdminExecutiveButton>
            </span>
          ) : null,
      },
    ],
    [nowMilliseconds],
  );

  const volunteerColumns = useMemo(
    () => [
      {
        key: 'fullName',
        header: COPY.volunteerColumnName,
        render: (volunteer) => volunteer.fullName ?? '—',
      },
      {
        key: 'emailAddress',
        header: COPY.volunteerColumnEmail,
        render: (volunteer) => (
          <span className="font-admin-mono text-[13px] text-admin-slate-600">
            {volunteer.emailAddress ?? '—'}
          </span>
        ),
      },
      {
        key: 'collegeName',
        header: COPY.volunteerColumnCollege,
        render: (volunteer) => volunteer.collegeName ?? '—',
      },
    ],
    [],
  );

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
      <AdminExecutiveCard>
        <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.loadError}</p>
      </AdminExecutiveCard>
    );
  }

  /*
   * A shift belongs to an event through its CHECKPOINT, so the cascade narrows
   * by resolving the selected event's checkpoints from the list already loaded
   * for the scheduling form. Fest-level gates carry no eventId and are dropped
   * once the admin drills into one event — gate duty is not that event's roster.
   */
  const scopedCheckpointIds = activeEventId
    ? new Set(
        checkpoints
          .filter((checkpoint) => String(checkpoint.eventId ?? '') === activeEventId)
          .map((checkpoint) => String(checkpoint.checkpointId)),
      )
    : null;
  const visibleShifts = scopedCheckpointIds
    ? shifts.filter((shift) => scopedCheckpointIds.has(String(shift.checkpointId)))
    : shifts;

  /*
   * The MAIN GATE first, because it is the one checkpoint every participant can
   * already scan at (gate access is granted automatically with the pass, not
   * chosen as an add-on) — so it is the one an admin most often forgets to
   * staff, and it should not be buried among the event doors.
   */
  const gateCheckpoints = checkpoints.filter((checkpoint) => checkpoint.checkpointType === 'gate');
  const orderedCheckpoints = [
    ...gateCheckpoints,
    ...checkpoints.filter((checkpoint) => checkpoint.checkpointType !== 'gate'),
  ];
  // #5.2: is anyone actually scheduled on the gate?
  const gateCheckpointIds = new Set(gateCheckpoints.map((checkpoint) => String(checkpoint.checkpointId)));
  const hasGateShift = shifts.some(
    (shift) => shift.status === 'scheduled' && gateCheckpointIds.has(String(shift.checkpointId)),
  );

  async function handleAlertVolunteers(checkpointId) {
    setActionError('');
    setNotice('');
    try {
      const result = await apiClient.post(
        `/fests/${festId}/checkpoints/${checkpointId}/alert-volunteers`,
        {},
      );
      setNotice(COPY.alertVolunteersSent(result?.notifiedCount ?? 0, result?.checkpointName ?? ''));
    } catch (alertError) {
      setActionError(describeError(alertError, COPY.alertVolunteersFailed));
    }
  }

  const isEditing = Boolean(editingShiftId);

  /*
   * Volunteers with an active assignment but no scheduled shift — their scanner
   * never opens. Client-side compute from the two lists already fetched (no new
   * endpoint). Suppressed under the 'cancelled' filter, where the scheduled
   * shifts are absent from `shifts` and the compute would be wrong.
   */
  const unscheduledVolunteers =
    statusFilter === 'cancelled'
      ? []
      : volunteers.filter(
          (volunteer) =>
            !shifts.some(
              (shift) => shift.status === 'scheduled' && shift.userId === volunteer.userId,
            ),
        );

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <h1 className="font-admin-display text-[24px] font-semibold leading-8 text-admin-neutral-ink">
        {COPY.pageTitle}
      </h1>

      <AdminErrorBanner message={actionError} />
      {notice ? (
        <div
          role="status"
          className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green"
        >
          {notice}
        </div>
      ) : null}

      <AdminHierarchyFilter
        fests={fests}
        selectedFestId={scope.festId}
        selectedEventId={scope.eventId}
        selectedSubEventId={scope.subEventId}
        onChange={handleScopeChange}
        className="sticky top-0 z-10 bg-admin-surface-off-white py-2"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {festId ? (
          <AdminExecutiveSelect
            label={COPY.statusFilterLabel}
            options={COPY.statusFilterOptions}
            value={statusFilter}
            onChange={(changeEvent) => changeStatusFilter(changeEvent.target.value)}
          />
        ) : null}
      </div>

      {!festId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.selectPrompt}</p>
        </AdminExecutiveCard>
      ) : (
        <>
          {unscheduledVolunteers.length > 0 ? (
            <details className="rounded-md border border-admin-status-warning-amber/40 bg-admin-status-warning-amber/5 px-4 py-3">
              <summary className="cursor-pointer font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
                {COPY.unscheduledSummary(unscheduledVolunteers.length)}
              </summary>
              <p className="mt-2 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                {COPY.unscheduledDetail}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {unscheduledVolunteers.map((volunteer) => (
                  <li key={volunteer.userId} className="font-admin-mono text-[13px] text-admin-neutral-ink">
                    {volunteer.fullName ?? volunteer.emailAddress}
                    {volunteer.fullName ? (
                      <span className="text-admin-slate-600"> · {volunteer.emailAddress}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {gateCheckpoints.length > 0 && !hasGateShift ? (
            <div className="rounded-md border border-admin-status-warning-amber/40 bg-admin-status-warning-amber/5 px-4 py-3">
              <p className="font-admin-body text-[14px] leading-5 text-admin-neutral-ink">
                {COPY.noGateVolunteerBanner}
              </p>
              <Link
                to={`/admin/events/assignments?festId=${festId}`}
                className="mt-1 inline-block font-admin-body text-[13px] font-medium text-admin-primary-blue underline"
              >
                {COPY.noGateVolunteerLink}
              </Link>
            </div>
          ) : null}

          {/* One "start scanning" nudge per checkpoint that actually has staff. */}
          {orderedCheckpoints.length > 0 ? (
            <AdminExecutiveCard title={COPY.alertVolunteersHeading} description={COPY.alertVolunteersBody}>
              <div className="flex flex-wrap gap-2">
                {orderedCheckpoints
                  .filter((checkpoint) =>
                    shifts.some(
                      (shift) =>
                        shift.status === 'scheduled' &&
                        String(shift.checkpointId) === String(checkpoint.checkpointId),
                    ),
                  )
                  .map((checkpoint) => (
                    <AdminExecutiveButton
                      key={checkpoint.checkpointId}
                      variant="secondary"
                      size="small"
                      iconLeft={<BellRing size={14} />}
                      onClick={() => handleAlertVolunteers(checkpoint.checkpointId)}
                    >
                      {checkpoint.name}
                    </AdminExecutiveButton>
                  ))}
              </div>
            </AdminExecutiveCard>
          ) : null}

          <AdminExecutiveCard title={COPY.shiftsHeading} bodyClassName="p-0">
            <AdminExecutiveTable
              columns={shiftColumns}
              rows={visibleShifts}
              rowKey={(shift) => shift.shiftId}
              emptyMessage={COPY.shiftsEmpty}
            />
          </AdminExecutiveCard>

          <AdminExecutiveCard
            title={isEditing ? COPY.editHeading : COPY.createHeading}
            description={isEditing ? COPY.editDescription : COPY.createDescription}
          >
            <form onSubmit={submitForm} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <AdminExecutiveSelect
                  label={COPY.volunteerLabel}
                  required
                  placeholder={COPY.volunteerPlaceholder}
                  helperText={volunteers.length === 0 ? COPY.noVolunteers : undefined}
                  options={volunteers.map((volunteer) => ({
                    value: volunteer.userId,
                    label: volunteer.fullName
                      ? `${volunteer.fullName} (${volunteer.emailAddress})`
                      : volunteer.emailAddress,
                  }))}
                  value={form.userId}
                  disabled={isEditing}
                  onChange={(changeEvent) => updateForm('userId', changeEvent.target.value)}
                />
                <AdminExecutiveSelect
                  label={COPY.checkpointLabel}
                  required
                  placeholder={COPY.checkpointPlaceholder}
                  helperText={checkpoints.length === 0 ? COPY.noCheckpoints : undefined}
                  options={orderedCheckpoints.map((checkpoint) => ({
                    value: checkpoint.checkpointId,
                    label:
                      checkpoint.checkpointType === 'gate'
                        ? `${checkpoint.name} — ${COPY.mainGateDefaultTag}`
                        : `${checkpoint.name} (${checkpoint.checkpointType})`,
                  }))}
                  value={form.checkpointId}
                  onChange={(changeEvent) => updateForm('checkpointId', changeEvent.target.value)}
                />
                <AdminExecutiveInput
                  label={COPY.startsAtLabel}
                  type="datetime-local"
                  required
                  value={form.startsAt}
                  onChange={(changeEvent) => updateForm('startsAt', changeEvent.target.value)}
                />
                <AdminExecutiveInput
                  label={COPY.endsAtLabel}
                  type="datetime-local"
                  required
                  helperText={COPY.windowHelp}
                  value={form.endsAt}
                  onChange={(changeEvent) => updateForm('endsAt', changeEvent.target.value)}
                />
              </div>

              {formError ? (
                <p className="font-admin-body text-[13px] leading-[18px] text-admin-status-error-red">
                  {formError}
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <AdminExecutiveButton
                  type="submit"
                  loading={isSubmitting}
                  iconLeft={isEditing ? null : <CalendarPlus size={15} />}
                >
                  {isEditing ? COPY.submitEdit : COPY.submitCreate}
                </AdminExecutiveButton>
                {isEditing ? (
                  <AdminExecutiveButton variant="ghost" onClick={discardEdit} disabled={isSubmitting}>
                    {COPY.discardEdit}
                  </AdminExecutiveButton>
                ) : null}
              </div>
            </form>
          </AdminExecutiveCard>

          <AdminExecutiveCard title={COPY.volunteersHeading} bodyClassName="p-0">
            <AdminExecutiveTable
              columns={volunteerColumns}
              rows={volunteers}
              rowKey={(volunteer) => volunteer.userId}
              emptyMessage={COPY.volunteersEmpty}
            />
          </AdminExecutiveCard>
        </>
      )}

      <AdminModal
        isOpen={Boolean(cancelTarget)}
        title={COPY.cancelModalTitle}
        confirmLabel={COPY.cancelConfirm}
        cancelLabel={COPY.cancelKeep}
        tone="danger"
        isBusy={isCancelling}
        onConfirm={confirmCancel}
        onCancel={() => {
          if (!isCancelling) {
            setCancelTarget(null);
            setCancelReason('');
          }
        }}
      >
        <p>
          {COPY.cancelModalBody}{' '}
          <span className="font-medium text-admin-neutral-ink">
            {cancelTarget
              ? `${cancelTarget.userFullName ?? ''} — ${cancelTarget.checkpointName ?? ''}`
              : ''}
          </span>
        </p>
        <AdminExecutiveInput
          label={COPY.cancelReasonLabel}
          placeholder={COPY.cancelReasonPlaceholder}
          value={cancelReason}
          onChange={(changeEvent) => setCancelReason(changeEvent.target.value)}
          className="mt-4"
        />
      </AdminModal>
    </div>
  );
}

export default AdminShiftsScreen;
