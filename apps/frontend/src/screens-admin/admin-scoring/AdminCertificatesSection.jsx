// AdminCertificatesSection.jsx
// The certificate desk for ONE event: who gets one, what it looks like, and the
// single action that makes and releases them.
//
// FOUR AUDIENCES, FOUR LISTS. Winners, participants, coordinators, volunteers.
// They are separate lists rather than one roster with role tags because they are
// chosen separately in practice — an admin pushes participation certificates the
// evening of the event and winner certificates only after the results are
// settled, and one merged list with four different reasons to tick a box is how
// the wrong batch gets sent.
//
// WINNERS COME FROM THE RESULT BOARD, never from a second calculation here.
// Both screens rank through helpers/round-scoreboard.js, so the podium on the
// board and the winners on this checklist cannot drift apart. Participants are
// then the confirmed roster MINUS those winners, so nobody is offered twice.
//
// THE TEMPLATE IS THE CERTIFICATE. The uploaded artwork carries the titles,
// seals and signatures; the renderer overlays the recipient's name and nothing
// else (see helpers/certificate-pdf.js on the server). That is why PUSH is
// closed until artwork exists — without it every certificate in the batch comes
// out as a name on a blank page, and a batch cannot be recalled once released.
//
// Contract (verified against backend routes/services):
//   · GET   /fests/:festId/events/:eventId → the event, incl. certificateTemplateUrl.
//   · GET   /fests/:festId/events/:eventId/rounds/scoreboard → the ranked board.
//   · GET   /fests/:festId/events/:eventId/participants?includeAll=true
//   · GET   /fests/:festId/staff-assignments → filtered client-side by role +
//     coverage (empty eventIds = fest-wide = covers every event).
//   · POST  /uploads (multipart "file") → { url }.
//   · PATCH /fests/:festId/events/:eventId { certificateTemplateUrl }.
//   · POST  /fests/:festId/certificates/generate|release with
//     { eventIds: [id], userIds: [ids] } → { generatedCount } / { releasedCount }.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Medal, Send, Upload, X } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import { flattenEventParticipants } from '../../helpers/event-roster.js';
import { formatCertificateErrorMessage } from '../../helpers/certificate-error-messages.js';
import {
  ROUND_SCOREBOARD_PATH,
  rankScoreboardRows,
  scoreboardRowName,
  scoreboardRowUserIds,
} from '../../helpers/round-scoreboard.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';

const COPY = {
  loadFailed: 'The certificate lists could not be loaded. Try again.',

  templateHeading: 'Certificate template',
  templateIntro:
    'The artwork you upload is the whole certificate — titles, seals and signatures included. Only the recipient’s name is added on top.',
  /*
   * JPEG and PNG only, and the hint says so. PDF is deliberately NOT offered:
   * the renderer draws the template with pdfkit's image(), which reads JPEG and
   * PNG and nothing else, so a PDF template would upload cleanly and then
   * produce a batch of certificates with a name on a blank page.
   */
  templateHint: 'JPG or PNG, up to 5 MB.',
  templateCta: 'Upload template',
  templateReplace: 'Replace',
  templateRemove: 'Remove template',
  templateSaved: 'Template saved for this event.',
  templateSaveFailed: 'The template could not be saved.',
  templateTypeError: 'Upload a JPG or PNG. PDFs cannot be used as certificate artwork.',
  templateSizeError: 'That file is over 5 MB. Upload a smaller image.',
  templateMissing: 'Upload a certificate template first.',
  templatePreviewAlt: 'Certificate template',

  winnersHeading: 'Winners',
  winnersEmpty:
    'No winners yet. Winners appear once the coordinator has entered marks — see the result board.',
  participantsHeading: 'Participants',
  participantsEmpty: 'No confirmed participants for this event yet.',
  coordinatorsHeading: 'Coordinators',
  coordinatorsEmpty: 'No coordinators cover this event.',
  volunteersHeading: 'Volunteers',
  volunteersEmpty: 'No volunteers cover this event.',

  selectAll: 'Select all',
  selectedCount: (selected, total) => `${selected} of ${total} selected`,
  nobodySelected: 'Tick at least one recipient.',

  pushButton: 'Push certificates',
  pushModalTitle: 'Push certificates?',
  pushModalBody: (count) =>
    `Certificates will be generated and released for the ${count} selected ${
      count === 1 ? 'person' : 'people'
    }. Released certificates are visible to their owners immediately and are emailed to them.`,
  pushResult: (count) =>
    `${count} certificate${count === 1 ? '' : 's'} generated and released.`,
  actionFailed: 'The certificate push failed. Try again.',
  confirm: 'Push certificates',
  cancel: 'Cancel',
  pendingStaffName: 'Invitation pending',
};

const ACCEPTED_TEMPLATE_TYPES = ['image/jpeg', 'image/png'];
// Matches the server's own multer cap exactly, so a file this screen accepts is
// never refused after the upload has already been paid for.
const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;

const MEDAL_COLOURS = { 1: '#B8860B', 2: '#7D8590', 3: '#A1673A' };
const RANK_LABELS = { 1: '1st', 2: '2nd', 3: '3rd' };

/* Whether a staff assignment covers this event: an empty eventIds list means the
 * assignment is fest-wide (covers every event); otherwise it must name it. */
function assignmentCoversEvent(assignment, eventId) {
  const assignedEventIds = Array.isArray(assignment.eventIds) ? assignment.eventIds : [];
  if (assignedEventIds.length === 0) {
    return true;
  }
  return assignedEventIds.some(
    (entry) => String(entry?.id ?? entry?._id ?? entry) === String(eventId),
  );
}

function toStaffRow(assignment) {
  return {
    userId: String(assignment.userId?.id ?? assignment.userId?._id ?? assignment.userId),
    primaryText: assignment.userId?.fullName ?? COPY.pendingStaffName,
    secondaryText: assignment.userId?.emailAddress ?? '',
  };
}

function ResultNotice({ message }) {
  if (!message) {
    return null;
  }
  return (
    <p className="mt-3 rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/10 px-3 py-2 font-admin-body text-[13px] leading-[18px] text-admin-neutral-ink">
      {message}
    </p>
  );
}

/* One labelled checklist with its own "Select all". Shared by all four lists so
 * the four behave identically — the winners list differs only by the medal it
 * puts in the leading slot. */
function RecipientChecklist({ heading, emptyMessage, rows, selectedIds, onToggle, onToggleAll }) {
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.has(row.userId));
  const selectedCount = rows.filter((row) => selectedIds.has(row.userId)).length;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{heading}</h3>
        <span className="shrink-0 font-admin-mono text-[12px] text-admin-slate-600">
          {COPY.selectedCount(selectedCount, rows.length)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 font-admin-body text-[13px] text-admin-slate-600">{emptyMessage}</p>
      ) : (
        <>
          <label className="mt-3 flex w-fit cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onToggleAll(!allSelected)}
              className="h-4 w-4 accent-admin-primary-blue"
            />
            <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
              {COPY.selectAll}
            </span>
          </label>
          <ul className="mt-2 max-h-64 divide-y divide-admin-slate-200 overflow-y-auto rounded-md border border-admin-slate-200">
            {rows.map((row) => (
              <li key={row.userId}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.userId)}
                    onChange={() => onToggle(row.userId)}
                    className="h-4 w-4 shrink-0 accent-admin-primary-blue"
                  />
                  {row.rank ? (
                    <Medal
                      size={16}
                      style={{ color: MEDAL_COLOURS[row.rank] ?? '#7D8590' }}
                      className="shrink-0"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-admin-body text-[14px] text-admin-neutral-ink">
                      {row.primaryText}
                    </span>
                    <span className="block truncate font-admin-mono text-[12px] text-admin-slate-600">
                      {row.secondaryText}
                    </span>
                  </span>
                  {row.trailingText ? (
                    <span className="shrink-0 font-admin-mono text-[13px] font-semibold tabular-nums text-admin-neutral-ink">
                      {row.trailingText}
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/*
 * The template well. Its own component rather than the shared AdminPosterUpload
 * because the rules differ in ways that matter here: 5 MB rather than 2 (the
 * server's real cap, and certificate artwork is print-resolution), and an
 * explicit refusal of PDF with a reason, since PDF is the format an admin will
 * most reasonably expect to work and the one that silently produces blank
 * certificates.
 */
function TemplateWell({ value, isSaving, onUploaded, onRemoved }) {
  const inputReference = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleFileSelected(changeEvent) {
    const file = changeEvent.target.files?.[0];
    // Reset so re-picking the same file after a remove still fires.
    changeEvent.target.value = '';
    if (!file) {
      return;
    }
    if (!ACCEPTED_TEMPLATE_TYPES.includes(file.type)) {
      setErrorMessage(COPY.templateTypeError);
      return;
    }
    if (file.size > MAX_TEMPLATE_BYTES) {
      setErrorMessage(COPY.templateSizeError);
      return;
    }
    setErrorMessage('');
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // Clear the client's default application/json so axios sets the multipart
      // boundary itself.
      const result = await apiClient.post('/uploads', formData, {
        headers: { 'Content-Type': undefined },
      });
      await onUploaded(result.url);
    } catch (uploadError) {
      setErrorMessage(uploadError.message || COPY.templateSaveFailed);
    } finally {
      setIsUploading(false);
    }
  }

  const isBusy = isUploading || isSaving;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputReference}
        type="file"
        accept="image/jpeg,image/png"
        onChange={handleFileSelected}
        className="hidden"
      />

      {value ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="relative w-full max-w-[280px] shrink-0 overflow-hidden rounded-md border border-admin-slate-200 bg-admin-surface-off-white">
            {/* object-contain, so what the admin approves is the whole artwork
                and not a cover-cropped guess at it. */}
            <img
              src={value}
              alt={COPY.templatePreviewAlt}
              className="h-40 w-full bg-admin-surface-off-white object-contain"
            />
          </div>
          <div className="flex flex-col gap-2">
            <AdminExecutiveButton
              variant="secondary"
              size="small"
              iconLeft={isBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              disabled={isBusy}
              onClick={() => inputReference.current?.click()}
            >
              {COPY.templateReplace}
            </AdminExecutiveButton>
            <button
              type="button"
              disabled={isBusy}
              onClick={onRemoved}
              className="inline-flex w-fit items-center gap-1 font-admin-body text-[13px] text-admin-status-error-red underline disabled:opacity-50"
            >
              <X size={13} />
              {COPY.templateRemove}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputReference.current?.click()}
          disabled={isBusy}
          className="flex h-40 w-full max-w-[380px] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-admin-slate-200 bg-admin-surface-off-white text-admin-slate-600 transition-colors hover:border-admin-primary-blue hover:text-admin-primary-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isBusy ? (
            <Loader2 size={22} className="animate-spin" />
          ) : (
            <>
              <Upload size={22} strokeWidth={1.75} />
              <span className="font-admin-body text-[14px] font-medium">{COPY.templateCta}</span>
              <span className="font-admin-body text-[12px]">{COPY.templateHint}</span>
            </>
          )}
        </button>
      )}

      {errorMessage ? (
        <p className="font-admin-body text-[13px] leading-[18px] text-admin-status-error-red">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

const EMPTY_SELECTION = {
  winners: new Set(),
  participants: new Set(),
  coordinators: new Set(),
  volunteers: new Set(),
};

function AdminCertificatesSection({ festId, eventId = null }) {
  const [certificateTemplateUrl, setCertificateTemplateUrl] = useState(null);
  const [rosters, setRosters] = useState({
    winners: [],
    participants: [],
    coordinators: [],
    volunteers: [],
  });
  // One Set per list so each "Select all" is independent; identities are userIds.
  const [selected, setSelected] = useState(EMPTY_SELECTION);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [isPushModalOpen, setIsPushModalOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const loadRosters = useCallback(async () => {
    if (!festId || !eventId) {
      setRosters({ winners: [], participants: [], coordinators: [], volunteers: [] });
      setSelected(EMPTY_SELECTION);
      return;
    }
    setIsLoading(true);
    setLoadError('');
    try {
      const [event, roster, assignments, scoreboard] = await Promise.all([
        apiClient.get(`/fests/${festId}/events/${eventId}`),
        // includeAll: winner1st/2nd/3rd and eliminated rows must be selectable
        // once results are finalised, not just the still-CONFIRMED default every
        // other roster caller wants.
        apiClient.get(`/fests/${festId}/events/${eventId}/participants?includeAll=true`),
        apiClient.get(`/fests/${festId}/staff-assignments`),
        // An event with no rounds has no winners; that is a normal state, not a
        // failure, so it resolves to an empty board rather than failing the load.
        apiClient.get(ROUND_SCOREBOARD_PATH(festId, eventId)).catch(() => null),
      ]);

      setCertificateTemplateUrl(event?.certificateTemplateUrl ?? null);

      /*
       * Winners: the result board's own top three, through the shared ranker.
       * A team row contributes every member — the whole team won, not its
       * leader — so one winner row can carry several userIds.
       */
      const rankedRows = rankScoreboardRows(scoreboard?.rows ?? []);
      const winnerRows = rankedRows.filter((row) => row.rank !== null && row.rank <= 3);
      const winnerUserIds = new Set(winnerRows.flatMap(scoreboardRowUserIds));
      const winners = winnerRows.flatMap((row) =>
        scoreboardRowUserIds(row).map((userId) => ({
          userId,
          rank: row.rank,
          primaryText: row.isTeam
            ? `${scoreboardRowName(row)} — ${
                row.members.find((member) => String(member.participantUserId) === userId)?.fullName ??
                '—'
              }`
            : scoreboardRowName(row),
          secondaryText: [RANK_LABELS[row.rank] ?? `#${row.rank}`, row.collegeName]
            .filter(Boolean)
            .join(' · '),
          trailingText: String(row.totalScore),
        })),
      );

      /* Participants are the confirmed roster MINUS the winners, so nobody is
       * offered a certificate twice under two different reasons. */
      const { participants: registrations } = flattenEventParticipants(roster);
      const participants = registrations
        .map((registration) => ({
          userId: String(
            registration.userId?.id ?? registration.userId?._id ?? registration.userId,
          ),
          primaryText: registration.userId?.fullName ?? '—',
          secondaryText: [
            registration.userId?.collegeId?.commonName ?? registration.userId?.emailAddress ?? '',
            registration.createdAt
              ? new Date(registration.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                })
              : '',
          ]
            .filter(Boolean)
            .join(' · '),
        }))
        .filter((row) => !winnerUserIds.has(row.userId));

      const activeStaff = (Array.isArray(assignments) ? assignments : []).filter(
        (assignment) =>
          assignment.status === 'active' && assignmentCoversEvent(assignment, eventId),
      );
      const coordinators = activeStaff
        .filter((assignment) => assignment.role === 'coordinator')
        .map(toStaffRow);
      const volunteers = activeStaff
        .filter((assignment) => assignment.role === 'volunteer')
        .map(toStaffRow);

      setRosters({ winners, participants, coordinators, volunteers });
      /*
       * Nothing is ticked by default. The previous default selected every
       * roster, which made the push button live the moment the screen settled —
       * one stray click away from releasing an unintended batch that cannot be
       * recalled. Choosing the audience is now an explicit act.
       */
      setSelected(EMPTY_SELECTION);
    } catch {
      setRosters({ winners: [], participants: [], coordinators: [], volunteers: [] });
      setSelected(EMPTY_SELECTION);
      setLoadError(COPY.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }, [festId, eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActionNotice('');
    setTemplateNotice('');
    setActionError('');
    setCertificateTemplateUrl(null);
    loadRosters();
  }, [loadRosters]);

  function toggleOne(groupKey, userId) {
    setSelected((previous) => {
      const next = new Set(previous[groupKey]);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return { ...previous, [groupKey]: next };
    });
  }

  function toggleAll(groupKey, shouldSelect) {
    setSelected((previous) => ({
      ...previous,
      [groupKey]: shouldSelect ? new Set(rosters[groupKey].map((row) => row.userId)) : new Set(),
    }));
  }

  /* The upload already happened; this persists the URL onto the event so the
   * renderer prefers this artwork over the fest default. */
  async function saveTemplate(nextUrl) {
    setIsSavingTemplate(true);
    setActionError('');
    setTemplateNotice('');
    try {
      await apiClient.patch(`/fests/${festId}/events/${eventId}`, {
        certificateTemplateUrl: nextUrl || null,
      });
      setCertificateTemplateUrl(nextUrl || null);
      setTemplateNotice(COPY.templateSaved);
    } catch (saveError) {
      setActionError(saveError.message || COPY.templateSaveFailed);
    } finally {
      setIsSavingTemplate(false);
    }
  }

  /*
   * ONE action for the admin; TWO service calls underneath (generate, then
   * release), both scoped to this event AND to the ticked people. Release is
   * what emails the recipients, so the notice only claims success once both
   * have returned.
   */
  async function handlePush() {
    setIsBusy(true);
    setActionError('');
    const userIds = [
      ...new Set([
        ...selected.winners,
        ...selected.participants,
        ...selected.coordinators,
        ...selected.volunteers,
      ]),
    ];
    const body = { eventIds: [eventId], userIds };
    try {
      await apiClient.post(`/fests/${festId}/certificates/generate`, body);
      const released = await apiClient.post(`/fests/${festId}/certificates/release`, body);
      setActionNotice(COPY.pushResult(released?.releasedCount ?? userIds.length));
    } catch (pushException) {
      setActionError(formatCertificateErrorMessage(pushException, COPY.actionFailed));
    } finally {
      setIsBusy(false);
      setIsPushModalOpen(false);
    }
  }

  const totalSelected = useMemo(
    () =>
      selected.winners.size +
      selected.participants.size +
      selected.coordinators.size +
      selected.volunteers.size,
    [selected],
  );

  const hasTemplate = Boolean(certificateTemplateUrl);
  const canPush = totalSelected > 0 && hasTemplate && !isSavingTemplate;

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <span
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminErrorBanner message={loadError || actionError} />

      {/* Artwork first: it gates the action, so asking for it after the admin has
          spent a minute ticking eighty names would be the wrong order. */}
      <AdminExecutiveCard title={COPY.templateHeading} description={COPY.templateIntro}>
        <TemplateWell
          value={certificateTemplateUrl}
          isSaving={isSavingTemplate}
          onUploaded={saveTemplate}
          onRemoved={() => saveTemplate(null)}
        />
        <ResultNotice message={templateNotice} />
      </AdminExecutiveCard>

      <AdminExecutiveCard>
        <div className="flex flex-col gap-7">
          <RecipientChecklist
            heading={COPY.winnersHeading}
            emptyMessage={COPY.winnersEmpty}
            rows={rosters.winners}
            selectedIds={selected.winners}
            onToggle={(userId) => toggleOne('winners', userId)}
            onToggleAll={(shouldSelect) => toggleAll('winners', shouldSelect)}
          />
          <RecipientChecklist
            heading={COPY.participantsHeading}
            emptyMessage={COPY.participantsEmpty}
            rows={rosters.participants}
            selectedIds={selected.participants}
            onToggle={(userId) => toggleOne('participants', userId)}
            onToggleAll={(shouldSelect) => toggleAll('participants', shouldSelect)}
          />
          <RecipientChecklist
            heading={COPY.coordinatorsHeading}
            emptyMessage={COPY.coordinatorsEmpty}
            rows={rosters.coordinators}
            selectedIds={selected.coordinators}
            onToggle={(userId) => toggleOne('coordinators', userId)}
            onToggleAll={(shouldSelect) => toggleAll('coordinators', shouldSelect)}
          />
          <RecipientChecklist
            heading={COPY.volunteersHeading}
            emptyMessage={COPY.volunteersEmpty}
            rows={rosters.volunteers}
            selectedIds={selected.volunteers}
            onToggle={(userId) => toggleOne('volunteers', userId)}
            onToggleAll={(shouldSelect) => toggleAll('volunteers', shouldSelect)}
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-admin-slate-200 pt-5">
          <AdminExecutiveButton
            variant="primary"
            iconLeft={<Send size={15} />}
            disabled={!canPush}
            onClick={() => setIsPushModalOpen(true)}
          >
            {COPY.pushButton}
          </AdminExecutiveButton>
          {/* The button says what it needs, rather than sitting greyed out with
              no reason given. */}
          {!hasTemplate ? (
            <span className="font-admin-body text-[13px] text-admin-status-warning-amber">
              {COPY.templateMissing}
            </span>
          ) : totalSelected === 0 ? (
            <span className="font-admin-body text-[13px] text-admin-slate-600">
              {COPY.nobodySelected}
            </span>
          ) : (
            <span className="font-admin-mono text-[13px] text-admin-slate-600">
              {totalSelected} selected
            </span>
          )}
        </div>
        <ResultNotice message={actionNotice} />
      </AdminExecutiveCard>

      <AdminModal
        isOpen={isPushModalOpen}
        title={COPY.pushModalTitle}
        confirmLabel={COPY.confirm}
        cancelLabel={COPY.cancel}
        tone="danger"
        isBusy={isBusy}
        onConfirm={handlePush}
        onCancel={() => (isBusy ? null : setIsPushModalOpen(false))}
      >
        {COPY.pushModalBody(totalSelected)}
      </AdminModal>
    </div>
  );
}

export default AdminCertificatesSection;
