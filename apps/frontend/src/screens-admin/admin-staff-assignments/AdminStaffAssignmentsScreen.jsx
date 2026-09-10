// AdminStaffAssignmentsScreen.jsx
// Route: /admin/events/assignments — the fest's staff roster: who holds which
// role, over which events, and the two mutations the backend offers (assign by
// email, revoke by assignment id).
//
// Honesty notes, all forced by the real backend:
//   · Only coordinator and volunteer are assignable here (ASSIGNABLE_ROLES in
//     staff-assignment-validator.js) — administrators are granted at the college
//     level, never invited into a single fest.
//   · Assignments are never deleted, only revoked (the model blocks deletion), so
//     revoked rows stay visible in the table as history.
//   · A successful assign/revoke may carry warning: "email_delivery_failed" —
//     the mutation stood but the notification email did not go out, which the
//     admin must be told rather than shown a clean success.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus, Download, Clock, Plus, X, Check } from 'lucide-react';
import apiClient, { getStoredAuthToken } from '../../api-client/api-client.js';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_STAFF_ASSIGNMENTS_COPY as COPY } from '../../brand-admin/brand-copy.js';

const EMAIL_WARNING = 'email_delivery_failed';

import { EMAIL_ADDRESS_PATTERN } from '@dedal/shared';

/*
 * Copy local to the paired-slot editor (the shared brand-copy file must not be
 * edited from this screen). Everything else keeps using COPY.
 */
const LOCAL_COPY = {
  /*
   * The gate is described by what the person will DO, not by the data shape
   * ("fest-wide assignment with a checkpoint-type restriction"), and the second
   * line names the trade so the admin sees the cost of the choice before making
   * it rather than discovering it when a volunteer is turned away at a door.
   */
  mainGateLabel: 'Main Gate (campus entrance)',
  mainGateHelp:
    'Posts this person at the fest entrance instead of an event. They can scan campus entry and exit only — not event doors, food, or any other counter.',
  slotsLabel: 'Staff to assign',
  slotEmailLabel: 'Email address',
  slotEmailPlaceholder: 'name@college.edu',
  slotPhoneLabel: 'Contact number (optional)',
  slotPhonePlaceholder: 'Fest hotline or personal number',
  removeSlot: 'Remove this row',
  addMore: 'Add More',
  assignAll: 'ASSIGN ALL',
  allRowsEmpty: 'Enter at least one email address.',
  invalidEmail: 'Enter a valid email address.',
  assigned: 'Assigned',
};

// One editable assignment slot. `result` is null until ASSIGN ALL runs, then
// { ok, message } for the inline per-row status.
let nextSlotId = 1;
function makeEmptySlot() {
  return { id: nextSlotId++, emailAddress: '', assignmentContactPhone: '', result: null };
}

const ROLE_CHIP_TONES = { coordinator: 'info', volunteer: 'neutral' };
const STATUS_CHIP_TONES = { active: 'success', revoked: 'error' };

// Flatten the backend's { details: { field: "complaint" } } map into one line the
// banner can show alongside the top-level message.
function describeError(error, fallbackMessage) {
  const detailEntries = Object.entries(error?.details ?? {});
  const detailText = detailEntries.map(([field, complaint]) => `${field} ${complaint}`).join('; ');
  const message = error?.message || fallbackMessage;
  return detailText ? `${message} (${detailText})` : message;
}

/*
 * The inline replacement for the deleted Volunteer Shifts screen: the shifts the
 * auto-assignment created for this volunteer, retimeable in place. A cancelled
 * shift is shown but not editable — the backend refuses to retime one.
 */
function ShiftTimingPanel({ status, shifts, drafts, savingShiftId, onDraftChange, onSave }) {
  if (status === 'loading') {
    return (
      <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.editTimingHeading}…</p>
    );
  }
  if (status === 'error') {
    return (
      <p className="font-admin-body text-[13px] text-admin-status-error-red">
        {COPY.editTimingLoadFailed}
      </p>
    );
  }
  if (shifts.length === 0) {
    return (
      <p className="max-w-[320px] text-left font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
        {COPY.editTimingEmpty}
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-md border border-admin-slate-200 bg-admin-surface-off-white p-3 text-left">
      <p className="font-admin-body text-[13px] font-semibold text-admin-neutral-ink">
        {COPY.editTimingHeading}
      </p>
      {shifts.map((shift) => (
        <div key={shift.shiftId} className="flex flex-col gap-2">
          <span className="font-admin-mono text-[12px] text-admin-slate-600">
            {shift.checkpointName ?? '—'}
            {shift.status === 'cancelled' ? ` · ${shift.status}` : ''}
          </span>
          {shift.status === 'cancelled' ? null : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <AdminExecutiveInput
                  label={COPY.editTimingStartLabel}
                  type="datetime-local"
                  value={drafts[shift.shiftId]?.startsAt ?? ''}
                  onChange={(changeEvent) =>
                    onDraftChange(shift.shiftId, { startsAt: changeEvent.target.value })
                  }
                />
                <AdminExecutiveInput
                  label={COPY.editTimingEndLabel}
                  type="datetime-local"
                  value={drafts[shift.shiftId]?.endsAt ?? ''}
                  onChange={(changeEvent) =>
                    onDraftChange(shift.shiftId, { endsAt: changeEvent.target.value })
                  }
                />
              </div>
              <div>
                <AdminExecutiveButton
                  variant="secondary"
                  size="small"
                  loading={savingShiftId === shift.shiftId}
                  onClick={() => onSave(shift)}
                >
                  {COPY.editTimingSave}
                </AdminExecutiveButton>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function AdminStaffAssignmentsScreen() {
  const [status, setStatus] = useState('loading');
  const [fests, setFests] = useState([]);
  const [searchParameters] = useSearchParams();
  /*
   * The shared cascade owns fest + event + sub-event. festId is derived from it
   * so every existing read of `festId` on this screen keeps working unchanged.
   */
  const { scope, handleScopeChange, setScope, activeEventId } = useAdminHierarchyScope();
  const festId = scope.festId;
  const [events, setEvents] = useState([]);
  const [assignments, setAssignments] = useState([]);

  /*
   * Add-staff form. Paired slots — one email + optional contact number per row,
   * grown with "Add More". Each slot is still its own assign call: the backend
   * has no batch endpoint and a partial failure must stay attributable, so the
   * result lands inline on the row that caused it.
   */
  const [slots, setSlots] = useState(() => [makeEmptySlot()]);
  const [role, setRole] = useState('');

  /*
   * Inline shift retiming — what the deleted Volunteer Shifts page used to do.
   * timingTarget is the assignment id whose row is expanded; drafts are keyed by
   * shiftId so two shifts on one row edit independently.
   */
  const [timingTarget, setTimingTarget] = useState('');
  const [timingStatus, setTimingStatus] = useState('idle');
  const [timingShifts, setTimingShifts] = useState([]);
  const [timingDrafts, setTimingDrafts] = useState({});
  const [savingShiftId, setSavingShiftId] = useState('');
  const [selectedEventIds, setSelectedEventIds] = useState([]);
  /*
   * MAIN GATE is a POST, not an event. It is the fest's common checkpoint —
   * eventId null — so it cannot appear in the event list beside Robotics and
   * Debate; it is a different KIND of assignment, and the form says so by making
   * it its own choice above the events.
   *
   * Choosing it means: this person works the campus entrance and nothing else.
   * That is why the event list is disabled while it is on, rather than merely
   * ignored — an admin who ticked three events and then ticked Main Gate would
   * otherwise submit an assignment silently missing the events they picked.
   */
  const [isMainGateAssignment, setIsMainGateAssignment] = useState(false);
  const [selectedOfferIds, setSelectedOfferIds] = useState([]);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  /*
   * The display name of a just-added VOLUNTEER. Their shift is created for them
   * (3 hours before the event through to its end), so this states what they got
   * rather than sending the admin to a second screen to schedule it.
   */
  const [volunteerNudgeName, setVolunteerNudgeName] = useState('');

  /*
   * The filtered CSV export modal. Role/status/event filters combine as AND
   * (the endpoint's grammar); everything defaults to selected = export all.
   * The row-count preview comes from /exports/staff-assignments/count with the
   * same query, so "Will export N rows" is exactly what the CSV will hold.
   */
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportRoles, setExportRoles] = useState({ coordinator: true, volunteer: true });
  const [exportStatuses, setExportStatuses] = useState({ active: true, revoked: true, expired: true });
  const [exportEventIds, setExportEventIds] = useState([]); // empty = all events
  const [exportRowCount, setExportRowCount] = useState(null);
  const [isDownloadingExport, setIsDownloadingExport] = useState(false);

  // Revoke flow: the assignment being confirmed, plus its optional reason.
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);

  // Load the admin's fests once; preselect when there is exactly one.
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
        /*
         * ?festId= wins over the single-fest convenience default: the secondary
         * entry points (a fest's "N staff" link, an event's "manage staff" link)
         * send an admin here already thinking about one fest, and making them
         * re-pick it would defeat the point of the link.
         */
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

  const loadFestData = useCallback(async (id) => {
    if (!id) {
      setEvents([]);
      setAssignments([]);
      return;
    }
    const [eventList, assignmentList] = await Promise.all([
      apiClient.get(`/fests/${id}/events/all`).catch(() => []),
      apiClient.get(`/fests/${id}/staff-assignments`).catch(() => []),
    ]);
    setEvents(Array.isArray(eventList) ? eventList : []);
    setAssignments(Array.isArray(assignmentList) ? assignmentList : []);
  }, []);

  useEffect(() => {
    // A fest switch resets the per-fest form scope and messages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedEventIds([]);
    setActionError('');
    setNotice('');
    loadFestData(festId);
  }, [festId, loadFestData]);

  const eventNameById = useMemo(
    () => new Map(events.map((event) => [event.id, event.eventName])),
    [events],
  );

  function toggleEvent(eventId) {
    setSelectedEventIds((current) =>
      current.includes(eventId) ? current.filter((id) => id !== eventId) : [...current, eventId],
    );
  }

  function toggleOffer(offerId) {
    setSelectedOfferIds((current) =>
      current.includes(offerId) ? current.filter((id) => id !== offerId) : [...current, offerId],
    );
  }

  function updateSlot(slotId, changes) {
    setSlots((current) =>
      current.map((slot) => (slot.id === slotId ? { ...slot, ...changes, result: null } : slot)),
    );
  }

  function addSlot() {
    setSlots((current) => [...current, makeEmptySlot()]);
  }

  function removeSlot(slotId) {
    // Removing the last remaining row leaves one fresh empty slot rather than none.
    setSlots((current) => {
      const remaining = current.filter((slot) => slot.id !== slotId);
      return remaining.length > 0 ? remaining : [makeEmptySlot()];
    });
  }

  async function submitAddStaff(formEvent) {
    formEvent.preventDefault();
    setFormError('');
    setActionError('');
    setNotice('');
    // Completely empty rows are skipped, not errors — a spare "Add More" row is fine.
    const filledSlots = slots.filter(
      (slot) => slot.emailAddress.trim() || slot.assignmentContactPhone.trim(),
    );
    if (filledSlots.length === 0) {
      setFormError(LOCAL_COPY.allRowsEmpty);
      return;
    }
    if (!role) {
      setFormError(COPY.roleRequired);
      return;
    }
    setIsSubmitting(true);
    /*
     * Sequential, not Promise.all: the results are reported per slot, and a
     * burst of parallel writes against the same fest would make a duplicate
     * collision depend on scheduling rather than on what the admin typed.
     */
    const resultsBySlotId = {};
    let lastVolunteerName = '';
    let sawEmailWarning = false;
    for (const slot of filledSlots) {
      const address = slot.emailAddress.trim().toLowerCase();
      if (!EMAIL_ADDRESS_PATTERN.test(address)) {
        resultsBySlotId[slot.id] = { ok: false, message: LOCAL_COPY.invalidEmail };
        continue;
      }
      try {
        // eventIds is optional: an empty selection is omitted so the backend records
        // a whole-fest assignment (its documented meaning for an absent array).
        const payload = { emailAddress: address, role };
        // The endpoint accepts assignmentContactPhone, so the per-slot number is sent.
        if (slot.assignmentContactPhone.trim()) {
          payload.assignmentContactPhone = slot.assignmentContactPhone.trim();
        }
        if (isMainGateAssignment) {
          /*
           * Empty eventIds is the existing encoding for "the whole fest", and
           * allowedCheckpointTypes: ['gate'] is what narrows that whole-fest
           * reach down to the entrance alone. Both are required: without the
           * type lock an empty eventIds would grant every checkpoint in the
           * fest, which is the opposite of a gate posting.
           */
          payload.allowedCheckpointTypes = ['gate'];
        } else if (selectedEventIds.length > 0) {
          payload.eventIds = selectedEventIds;
        }
        // offerIds is optional the same way: empty = no narrowing.
        if (selectedOfferIds.length > 0) {
          payload.offerIds = selectedOfferIds;
        }
        const created = await apiClient.post(`/fests/${festId}/staff-assignments`, payload);
        sawEmailWarning = sawEmailWarning || created?.warning === EMAIL_WARNING;
        if (role === 'volunteer') {
          lastVolunteerName = created?.userId?.fullName || address;
        }
        resultsBySlotId[slot.id] = { ok: true, message: '' };
      } catch (submitException) {
        resultsBySlotId[slot.id] = {
          ok: false,
          message: describeError(submitException, COPY.loadError),
        };
      }
    }
    setSlots((current) =>
      current.map((slot) =>
        resultsBySlotId[slot.id] ? { ...slot, result: resultsBySlotId[slot.id] } : slot,
      ),
    );
    const addedCount = Object.values(resultsBySlotId).filter((result) => result.ok).length;
    if (addedCount > 0) {
      setNotice(sawEmailWarning ? COPY.addSucceededEmailFailed : COPY.addSucceeded);
      setVolunteerNudgeName(lastVolunteerName);
      setSelectedEventIds([]);
      setSelectedOfferIds([]);
      setIsMainGateAssignment(false);
      await loadFestData(festId);
    }
    setIsSubmitting(false);
  }

  /* ── Inline shift timing ────────────────────────────────────────────────── */

  // <input type="datetime-local"> speaks local wall-clock without a zone; the API
  // speaks ISO. These two convert, and only these two.
  function toLocalInputValue(isoValue) {
    if (!isoValue) {
      return '';
    }
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const offsetMinutes = date.getTimezoneOffset();
    return new Date(date.getTime() - offsetMinutes * 60000).toISOString().slice(0, 16);
  }

  function fromLocalInputValue(localValue) {
    const date = new Date(localValue);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  async function toggleTimingPanel(assignment) {
    if (timingTarget === assignment.id) {
      setTimingTarget('');
      return;
    }
    setTimingTarget(assignment.id);
    setTimingStatus('loading');
    setTimingShifts([]);
    setTimingDrafts({});
    setNotice('');
    const volunteerUserId = assignment.userId?.id ?? assignment.userId;
    try {
      const result = await apiClient.get(`/fests/${festId}/shifts?userId=${volunteerUserId}`);
      const shifts = Array.isArray(result?.shifts) ? result.shifts : [];
      setTimingShifts(shifts);
      setTimingDrafts(
        Object.fromEntries(
          shifts.map((shift) => [
            shift.shiftId,
            {
              startsAt: toLocalInputValue(shift.startsAt),
              endsAt: toLocalInputValue(shift.endsAt),
            },
          ]),
        ),
      );
      setTimingStatus('ready');
    } catch {
      setTimingStatus('error');
    }
  }

  async function saveShiftTiming(shift) {
    const draft = timingDrafts[shift.shiftId];
    const startsAt = fromLocalInputValue(draft?.startsAt);
    const endsAt = fromLocalInputValue(draft?.endsAt);
    if (!startsAt || !endsAt) {
      setActionError(COPY.editTimingFailed);
      return;
    }
    setSavingShiftId(shift.shiftId);
    setActionError('');
    try {
      const result = await apiClient.patch(`/fests/${festId}/shifts/${shift.shiftId}`, {
        startsAt,
        endsAt,
      });
      const updated = result?.shift;
      if (updated) {
        setTimingShifts((previous) =>
          previous.map((row) => (row.shiftId === updated.shiftId ? updated : row)),
        );
      }
      setNotice(COPY.editTimingSaved);
    } catch (timingException) {
      setActionError(describeError(timingException, COPY.editTimingFailed));
    } finally {
      setSavingShiftId('');
    }
  }

  /*
   * "Respecting the filter" here is client-side: /fests/:festId/staff-assignments
   * returns the fest's whole team, and an assignment covers an event when its
   * eventIds names it — or when eventIds is EMPTY, which means fest-wide and
   * therefore covers every event. A fest-wide coordinator must not vanish when
   * the admin drills into one event.
   */
  const visibleAssignments = activeEventId
    ? assignments.filter((assignment) => {
        const coveredEventIds = (assignment.eventIds ?? []).map((event) =>
          String(event?.id ?? event?._id ?? event),
        );
        return coveredEventIds.length === 0 || coveredEventIds.includes(activeEventId);
      })
    : assignments;

  const selectedExportRoles = Object.keys(exportRoles).filter((role) => exportRoles[role]);
  const selectedExportStatuses = Object.keys(exportStatuses).filter(
    (statusKey) => exportStatuses[statusKey],
  );

  function buildStaffExportQuery() {
    const query = new URLSearchParams();
    // A full selection sends nothing — "no filter" and "all" are the same set,
    // and the audit row then honestly reads filtersApplied: none.
    if (selectedExportRoles.length > 0 && selectedExportRoles.length < 2) {
      selectedExportRoles.forEach((role) => query.append('role', role));
    }
    if (selectedExportStatuses.length > 0 && selectedExportStatuses.length < 3) {
      selectedExportStatuses.forEach((statusKey) => query.append('status', statusKey));
    }
    // The cascade's selection scopes the sheet unless the modal names events.
    if (exportEventIds.length > 0) {
      exportEventIds.forEach((exportEventId) => query.append('eventId', exportEventId));
    } else if (activeEventId) {
      query.append('eventId', activeEventId);
      if (!scope.subEventId) {
        query.append('includeDescendants', 'true');
      }
    }
    return query.toString();
  }

  // Live "Will export N rows" preview; an empty role/status selection is a
  // client-side zero (sending nothing would mean "all", the opposite intent).
  useEffect(() => {
    if (!isExportModalOpen || !festId) {
      return undefined;
    }
    if (selectedExportRoles.length === 0 || selectedExportStatuses.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExportRowCount(0);
      return undefined;
    }
    let isActive = true;
    setExportRowCount(null);
    const queryString = buildStaffExportQuery();
    apiClient
      .get(`/fests/${festId}/exports/staff-assignments/count${queryString ? `?${queryString}` : ''}`)
      .then((result) => isActive && setExportRowCount(result?.rowCount ?? 0))
      .catch(() => isActive && setExportRowCount(0));
    return () => {
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExportModalOpen, festId, exportRoles, exportStatuses, exportEventIds]);

  async function downloadStaffExport() {
    setIsDownloadingExport(true);
    setActionError('');
    try {
      const queryString = buildStaffExportQuery();
      const response = await fetch(
        `${apiClient.defaults.baseURL}/fests/${festId}/exports/staff-assignments.csv${queryString ? `?${queryString}` : ''}`,
        { headers: { Authorization: `Bearer ${getStoredAuthToken()}` } },
      );
      if (!response.ok) {
        throw new Error(`Export failed with ${response.status}`);
      }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'staff-assignments.csv';
      const csvBlob = await response.blob();
      const objectUrl = URL.createObjectURL(csvBlob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setIsExportModalOpen(false);
    } catch {
      setActionError(COPY.exportFailed);
    } finally {
      setIsDownloadingExport(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) {
      return;
    }
    setIsRevoking(true);
    setActionError('');
    setNotice('');
    try {
      const trimmedReason = revokeReason.trim();
      const revoked = await apiClient.post(
        `/fests/${festId}/staff-assignments/${revokeTarget.id}/revoke`,
        trimmedReason ? { reason: trimmedReason } : {},
      );
      if (revoked?.warning === EMAIL_WARNING) {
        setNotice(COPY.revokeSucceededEmailFailed);
      }
      setRevokeTarget(null);
      setRevokeReason('');
      await loadFestData(festId);
    } catch (revokeException) {
      setActionError(describeError(revokeException, COPY.loadError));
      setRevokeTarget(null);
      setRevokeReason('');
    } finally {
      setIsRevoking(false);
    }
  }

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: COPY.columnName,
        render: (assignment) => (
          <span className="font-medium text-admin-neutral-ink">
            {assignment.userId?.fullName ?? COPY.pendingName}
          </span>
        ),
      },
      {
        key: 'email',
        header: COPY.columnEmail,
        render: (assignment) => (
          <span className="font-admin-mono text-[13px] text-admin-slate-600">
            {assignment.userId?.emailAddress ?? '—'}
          </span>
        ),
      },
      {
        key: 'role',
        header: COPY.columnRole,
        render: (assignment) => (
          <AdminExecutiveChip tone={ROLE_CHIP_TONES[assignment.role] ?? 'neutral'}>
            {assignment.role}
          </AdminExecutiveChip>
        ),
      },
      {
        key: 'events',
        header: COPY.columnEvents,
        render: (assignment) => {
          const scoped = assignment.eventIds ?? [];
          if (scoped.length === 0) {
            return <span className="text-admin-slate-600">{COPY.wholeFestScope}</span>;
          }
          // eventIds may be populated docs or bare ids depending on the endpoint;
          // fall back to the fest's event list when only an id is present.
          const names = scoped
            .map((entry) => entry?.eventName ?? eventNameById.get(entry?.id ?? entry) ?? null)
            .filter(Boolean);
          return names.length > 0 ? names.join(', ') : COPY.wholeFestScope;
        },
      },
      {
        key: 'hours',
        header: COPY.columnHours,
        render: (assignment) =>
          /*
           * Volunteers only. Every other role has no shifts, so it shows an
           * em dash rather than 0 — "not applicable" and "worked nothing" are
           * different statements, and a column of zeroes against coordinators
           * would read as the second.
           */
          assignment.totalHoursWorked === null || assignment.totalHoursWorked === undefined ? (
            <span className="text-admin-slate-600">—</span>
          ) : (
            <span className="font-admin-mono text-[13px] text-admin-neutral-ink">
              {assignment.totalHoursWorked}
            </span>
          ),
      },
      {
        key: 'status',
        header: COPY.columnStatus,
        render: (assignment) => (
          <AdminExecutiveChip tone={STATUS_CHIP_TONES[assignment.status] ?? 'neutral'}>
            {assignment.status}
          </AdminExecutiveChip>
        ),
      },
      {
        key: 'actions',
        header: COPY.columnActions,
        align: 'right',
        render: (assignment) =>
          assignment.status === 'active' ? (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center justify-end gap-1">
                {/*
                  Volunteers only: a coordinator holds no shift — their access IS
                  the assignment, so there is no timing to edit.
                */}
                {assignment.role === 'volunteer' ? (
                  <AdminExecutiveButton
                    variant="ghost"
                    size="small"
                    iconLeft={<Clock size={14} />}
                    onClick={() => toggleTimingPanel(assignment)}
                  >
                    {timingTarget === assignment.id ? COPY.editTimingClose : COPY.editTimingAction}
                  </AdminExecutiveButton>
                ) : null}
                <AdminExecutiveButton
                  variant="ghost"
                  size="small"
                  className="text-admin-status-error-red hover:bg-admin-status-error-red/5"
                  onClick={() => setRevokeTarget(assignment)}
                >
                  {COPY.revokeAction}
                </AdminExecutiveButton>
              </div>
              {timingTarget === assignment.id ? (
                <ShiftTimingPanel
                  status={timingStatus}
                  shifts={timingShifts}
                  drafts={timingDrafts}
                  savingShiftId={savingShiftId}
                  onDraftChange={(shiftId, changes) =>
                    setTimingDrafts((previous) => ({
                      ...previous,
                      [shiftId]: { ...previous[shiftId], ...changes },
                    }))
                  }
                  onSave={saveShiftTiming}
                />
              ) : null}
            </div>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventNameById, timingTarget, timingStatus, timingShifts, timingDrafts, savingShiftId],
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

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">

      <AdminErrorBanner message={actionError} />
      {notice ? (
        <div
          role="status"
          className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green"
        >
          {notice}
        </div>
      ) : null}
      {volunteerNudgeName ? (
        <div
          role="status"
          className="rounded-md border border-admin-primary-blue/30 bg-admin-primary-blue/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-neutral-ink"
        >
          {COPY.volunteerAutoShiftNotice(volunteerNudgeName)}
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

      {!festId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.selectPrompt}</p>
        </AdminExecutiveCard>
      ) : (
        <>
          <div className="flex justify-end">
            <AdminExecutiveButton
              variant="primary"
              iconLeft={<Download size={15} />}
              onClick={() => setIsExportModalOpen(true)}
            >
              {COPY.exportButton}
            </AdminExecutiveButton>
          </div>

          <AdminExecutiveCard title={COPY.rosterHeading} bodyClassName="p-0">
            <AdminExecutiveTable
              columns={columns}
              rows={visibleAssignments}
              emptyMessage={COPY.rosterEmpty}
            />
          </AdminExecutiveCard>

          <AdminExecutiveCard title={COPY.addHeading} description={COPY.addDescription}>
            <form onSubmit={submitAddStaff} className="flex flex-col gap-4">
              <p className="rounded-md bg-admin-surface-off-white px-3 py-2 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                {COPY.accessNote}
              </p>

              {/* Paired slots: one email + optional contact number per row. */}
              <div className="flex flex-col gap-2">
                <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
                  {LOCAL_COPY.slotsLabel}
                </span>
                {slots.map((slot) => (
                  <div key={slot.id} className="flex flex-col gap-1">
                    <div className="flex items-end gap-2">
                      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                        <AdminExecutiveInput
                          label={LOCAL_COPY.slotEmailLabel}
                          type="email"
                          placeholder={LOCAL_COPY.slotEmailPlaceholder}
                          value={slot.emailAddress}
                          onChange={(changeEvent) =>
                            updateSlot(slot.id, { emailAddress: changeEvent.target.value })
                          }
                        />
                        <AdminExecutiveInput
                          label={LOCAL_COPY.slotPhoneLabel}
                          type="tel"
                          placeholder={LOCAL_COPY.slotPhonePlaceholder}
                          value={slot.assignmentContactPhone}
                          onChange={(changeEvent) =>
                            updateSlot(slot.id, {
                              assignmentContactPhone: changeEvent.target.value,
                            })
                          }
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={LOCAL_COPY.removeSlot}
                        title={LOCAL_COPY.removeSlot}
                        onClick={() => removeSlot(slot.id)}
                        className="mb-1.5 shrink-0 rounded-md p-1.5 text-admin-slate-600 transition-colors hover:bg-admin-status-error-red/10 hover:text-admin-status-error-red"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {slot.result ? (
                      <p
                        className={[
                          'flex items-center gap-1.5 font-admin-body text-[13px] leading-[18px]',
                          slot.result.ok
                            ? 'text-admin-status-success-green'
                            : 'text-admin-status-error-red',
                        ].join(' ')}
                      >
                        {slot.result.ok ? (
                          <>
                            <Check size={14} className="shrink-0" />
                            {LOCAL_COPY.assigned}
                          </>
                        ) : (
                          <>
                            <X size={14} className="shrink-0" />
                            {slot.result.message}
                          </>
                        )}
                      </p>
                    ) : null}
                  </div>
                ))}
                <div>
                  <AdminExecutiveButton
                    type="button"
                    variant="secondary"
                    size="small"
                    iconLeft={<Plus size={14} />}
                    onClick={addSlot}
                  >
                    {LOCAL_COPY.addMore}
                  </AdminExecutiveButton>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
                    {COPY.roleLabel}
                  </legend>
                  <div className="flex gap-2">
                    {COPY.roleOptions.map((roleOption) => (
                      <label
                        key={roleOption.value}
                        className={[
                          'flex flex-1 cursor-pointer items-center gap-2.5 rounded-md border p-3 transition-colors',
                          role === roleOption.value
                            ? 'border-admin-primary-blue bg-admin-primary-blue/5'
                            : 'border-admin-slate-200 hover:bg-admin-surface-off-white',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="add-staff-role"
                          value={roleOption.value}
                          checked={role === roleOption.value}
                          onChange={() => setRole(roleOption.value)}
                          className="h-4 w-4 accent-admin-primary-blue"
                        />
                        <span className="font-admin-body text-[14px] text-admin-neutral-ink">
                          {roleOption.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              {/* Above the events, because it is an alternative TO them rather
                  than one more of them. */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-admin-slate-200 px-3 py-2.5 transition-colors hover:bg-admin-surface-off-white">
                <input
                  type="checkbox"
                  checked={isMainGateAssignment}
                  onChange={(changeEvent) => {
                    setIsMainGateAssignment(changeEvent.target.checked);
                    // Picked events are cleared, not just ignored — see the state
                    // declaration for why silently dropping them is worse.
                    if (changeEvent.target.checked) {
                      setSelectedEventIds([]);
                    }
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-admin-primary-blue"
                />
                <span className="min-w-0">
                  <span className="block font-admin-body text-[14px] font-medium text-admin-neutral-ink">
                    {LOCAL_COPY.mainGateLabel}
                  </span>
                  <span className="mt-0.5 block font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                    {LOCAL_COPY.mainGateHelp}
                  </span>
                </span>
              </label>

              <div
                className={[
                  'flex flex-col gap-1.5',
                  isMainGateAssignment ? 'pointer-events-none opacity-40' : '',
                ].join(' ')}
                aria-disabled={isMainGateAssignment}
              >
                <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
                  {COPY.eventsLabel}
                </span>
                {events.length === 0 ? (
                  <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                    {COPY.noEvents}
                  </p>
                ) : (
                  <>
                    <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                      {COPY.eventsHelp}
                    </p>
                    <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {events.map((event) => (
                        <label
                          key={event.id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md border border-admin-slate-200 px-3 py-2 transition-colors hover:bg-admin-surface-off-white"
                        >
                          <input
                            type="checkbox"
                            checked={selectedEventIds.includes(event.id)}
                            onChange={() => toggleEvent(event.id)}
                            className="h-4 w-4 accent-admin-primary-blue"
                          />
                          <span className="truncate font-admin-body text-[14px] text-admin-neutral-ink">
                            {event.eventName}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {(() => {
                const festOffers = (fests.find((fest) => fest.id === festId)?.offers ?? []).filter(
                  (offer) => offer.isActive !== false,
                );
                if (festOffers.length === 0) return null;
                return (
                  <div>
                    <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                      {COPY.offersHelp}
                    </p>
                    <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {festOffers.map((offer) => (
                        <label
                          key={offer.id ?? offer._id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md border border-admin-slate-200 px-3 py-2 transition-colors hover:bg-admin-surface-off-white"
                        >
                          <input
                            type="checkbox"
                            checked={selectedOfferIds.includes(String(offer.id ?? offer._id))}
                            onChange={() => toggleOffer(String(offer.id ?? offer._id))}
                            className="h-4 w-4 accent-admin-primary-blue"
                          />
                          <span className="truncate font-admin-body text-[14px] text-admin-neutral-ink">
                            {offer.offerName}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {formError ? (
                <p className="font-admin-body text-[13px] leading-[18px] text-admin-status-error-red">
                  {formError}
                </p>
              ) : null}

              <div>
                <AdminExecutiveButton
                  type="submit"
                  loading={isSubmitting}
                  iconLeft={<UserPlus size={15} />}
                >
                  {LOCAL_COPY.assignAll}
                </AdminExecutiveButton>
              </div>
            </form>
          </AdminExecutiveCard>
        </>
      )}

      <AdminModal
        isOpen={Boolean(revokeTarget)}
        title={COPY.revokeModalTitle}
        confirmLabel={COPY.revokeConfirm}
        cancelLabel={COPY.revokeCancel}
        tone="danger"
        isBusy={isRevoking}
        onConfirm={confirmRevoke}
        onCancel={() => {
          if (!isRevoking) {
            setRevokeTarget(null);
            setRevokeReason('');
          }
        }}
      >
        <p>
          {COPY.revokeModalBody}{' '}
          <span className="font-medium text-admin-neutral-ink">
            {revokeTarget?.userId?.fullName ?? revokeTarget?.userId?.emailAddress ?? ''}
          </span>
        </p>
        <AdminExecutiveInput
          label={COPY.revokeReasonLabel}
          placeholder={COPY.revokeReasonPlaceholder}
          value={revokeReason}
          onChange={(changeEvent) => setRevokeReason(changeEvent.target.value)}
          className="mt-4"
        />
      </AdminModal>

      {/* Filtered CSV export: role/status/event checkboxes + live row count. */}
      <AdminModal
        isOpen={isExportModalOpen}
        title={COPY.exportModalTitle}
        confirmLabel={COPY.exportDownload}
        cancelLabel={COPY.exportCancel}
        isBusy={isDownloadingExport}
        confirmDisabled={exportRowCount === 0 || exportRowCount === null}
        onConfirm={downloadStaffExport}
        onCancel={() => (isDownloadingExport ? null : setIsExportModalOpen(false))}
      >
        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="font-admin-body text-[13px] font-semibold text-admin-neutral-ink">
              {COPY.exportRolesLegend}
            </legend>
            <div className="mt-1 flex gap-4">
              {['coordinator', 'volunteer'].map((role) => (
                <label key={role} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={exportRoles[role]}
                    onChange={() => setExportRoles((previous) => ({ ...previous, [role]: !previous[role] }))}
                    className="h-4 w-4 accent-admin-primary-blue"
                  />
                  <span className="font-admin-body text-[13px] capitalize text-admin-neutral-ink">{role}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-admin-body text-[13px] font-semibold text-admin-neutral-ink">
              {COPY.exportStatusesLegend}
            </legend>
            <div className="mt-1 flex gap-4">
              {['active', 'revoked', 'expired'].map((statusKey) => (
                <label key={statusKey} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={exportStatuses[statusKey]}
                    onChange={() =>
                      setExportStatuses((previous) => ({ ...previous, [statusKey]: !previous[statusKey] }))
                    }
                    className="h-4 w-4 accent-admin-primary-blue"
                  />
                  <span className="font-admin-body text-[13px] capitalize text-admin-neutral-ink">
                    {statusKey}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-admin-body text-[13px] font-semibold text-admin-neutral-ink">
              {COPY.exportEventsLegend}
            </legend>
            <label className="mt-1 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={exportEventIds.length === 0}
                onChange={() => setExportEventIds([])}
                className="h-4 w-4 accent-admin-primary-blue"
              />
              <span className="font-admin-body text-[13px] text-admin-neutral-ink">
                {COPY.exportAllEvents}
              </span>
            </label>
            {events.length > 0 ? (
              <div className="mt-1 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                {events.map((eventRow) => (
                  <label key={eventRow.id} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportEventIds.includes(eventRow.id)}
                      onChange={() =>
                        setExportEventIds((previous) =>
                          previous.includes(eventRow.id)
                            ? previous.filter((candidate) => candidate !== eventRow.id)
                            : [...previous, eventRow.id],
                        )
                      }
                      className="h-4 w-4 accent-admin-primary-blue"
                    />
                    <span className="truncate font-admin-body text-[13px] text-admin-neutral-ink">
                      {eventRow.eventName}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </fieldset>

          <p className="font-admin-mono text-[13px] font-semibold text-admin-neutral-ink">
            {exportRowCount === null
              ? COPY.exportCounting
              : exportRowCount === 0
                ? COPY.exportNoMatches
                : COPY.exportRowPreview(exportRowCount)}
          </p>
        </div>
      </AdminModal>
    </div>
  );
}

export default AdminStaffAssignmentsScreen;
