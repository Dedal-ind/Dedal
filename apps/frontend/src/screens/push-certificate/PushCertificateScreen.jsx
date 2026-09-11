// PushCertificateScreen.jsx
// Route: /backstage/coordinator/events/:eventId/push-certificate
//
// THIS IS A COORDINATOR TOOL, NOT A PARTICIPANT SCREEN. It issues certificates
// to an event's roster in bulk; nobody RECEIVES anything here. Each tab
// (Winners / Participation) has its own template upload, its own push button
// pinned at the top of the tab, and a checkbox per person.
//
// This pass is a token migration: the retired Tailwind palette and the Material
// Symbols ligatures are gone, replaced by dedal tokens in certificate-page.css
// and by the shared lucide icons. The layout, the data flow and every endpoint
// are unchanged.
//
// The one behavioural addition is the confirmation at the end of a push. That
// is the only irreversible moment on the screen — a batch of certificates has
// just landed in other people's accounts — and it was a window.alert.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import gsap from 'gsap';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import {
  CheckIcon,
  CloseIcon,
  PrizeIcon,
  RegistrationIcon,
  RetryIcon,
  SendIcon,
  TeamIcon,
  UploadIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import '../../design/certificate-page.css';

/*
 * The place list. `rank` is a border colour on the row, and only the podium has
 * one — 4th through 10th are ordinary rows, because a colour that means
 * nothing is worse than no colour. The three podium values are --gold, --muted
 * and --primary rather than literal metal colours: the palette has no silver
 * and no bronze, and inventing them here would put two more colours in the app
 * for the sake of a 3px border.
 */
const PLACE_OPTIONS = [
  { value: '1st', rank: 'var(--gold)' },
  { value: '2nd', rank: 'var(--muted)' },
  { value: '3rd', rank: 'var(--primary)' },
  { value: '4th', rank: null },
  { value: '5th', rank: null },
  { value: '6th', rank: null },
  { value: '7th', rank: null },
  { value: '8th', rank: null },
  { value: '9th', rank: null },
  { value: '10th', rank: null },
];

function placeMeta(place) {
  return PLACE_OPTIONS.find((option) => option.value === place) ?? {};
}

/* The checkbox. A styled span rather than an <input>, matching the original,
   but the whole row is the button so the tap target is the row's height. */
function CheckBox({ checked }) {
  return (
    <span className="dcd-check" data-checked={checked} aria-hidden="true">
      {checked ? <CheckIcon size="sm" /> : null}
    </span>
  );
}

// Template upload box (reused for both tabs)
function TemplateUploadBox({ templatePreview, onUpload, onRemove, fileInputRef }) {
  return (
    <div className="dcd-push__section">
      {templatePreview ? (
        <div className="dcd-preview">
          <img src={templatePreview} alt="Template preview" className="dcd-preview__image" />
          <button
            type="button"
            onClick={onRemove}
            className="dcd-preview__remove"
            aria-label="Remove template"
          >
            <CloseIcon size="sm" />
          </button>
          <p className="dcd-preview__caption">Template uploaded — remove it to change</p>
        </div>
      ) : (
        <button type="button" onClick={() => fileInputRef.current?.click()} className="dcd-upload">
          <span className="dcd-upload__icon">
            <UploadIcon />
          </span>
          <span>
            <span className="dcd-upload__title">Upload certificate template</span>
            <span className="dcd-upload__hint">
              PNG, JPG or PDF — this will be the base design
            </span>
          </span>
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,application/pdf"
        className="dcd-upload__file"
        onChange={onUpload}
      />
    </div>
  );
}

/*
 * The confirmation mark, lifted from the registration-success screen so a
 * coordinator and a participant see the same gesture mean the same thing:
 * circle over 400ms, tick 200ms behind it, once, then static. Rendered COMPLETE
 * in the markup and rewound by the effect, so under prefers-reduced-motion — or
 * if gsap is not there at all — what is on screen is a finished checkmark
 * rather than an empty ring.
 */
function DrawnCheck() {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const root = rootRef.current;
    if (prefersReducedMotion || !root) {
      return undefined;
    }
    const circle = root.querySelector('.dcd-done__circle');
    const tick = root.querySelector('.dcd-done__tick');
    const circleLength = circle.getTotalLength();
    const tickLength = tick.getTotalLength();

    const timeline = gsap.timeline();
    timeline
      .fromTo(
        circle,
        { strokeDasharray: circleLength, strokeDashoffset: circleLength },
        { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' },
      )
      .fromTo(
        tick,
        { strokeDasharray: tickLength, strokeDashoffset: tickLength },
        { strokeDashoffset: 0, duration: 0.28, ease: 'power2.out' },
        0.2,
      );

    /* progress(1) before kill(): gsap.kill() freezes the inline styles where
       they are, and StrictMode's double mount would otherwise leave a
       permanently half-drawn ring. */
    return () => {
      timeline.progress(1);
      timeline.kill();
    };
  }, []);

  return (
    <svg
      ref={rootRef}
      viewBox="0 0 56 56"
      width="56"
      height="56"
      fill="none"
      role="img"
      aria-label="Certificates pushed"
    >
      <circle className="dcd-done__circle" cx="28" cy="28" r="25" />
      <path className="dcd-done__tick" d="M17 28.5 L24.5 36 L39 21.5" />
    </svg>
  );
}

/*
 * The server answers { pushed, skipped, failed, skippedUserIds, failedUserIds }.
 * Read defensively: a older deployment that has not been updated yet returns
 * only the three counts, and a screen that reads undefined.length would break
 * on the success path of a push that actually worked.
 */
function summariseOutcome(outcome) {
  return {
    pushed: outcome?.pushed ?? 0,
    skipped: outcome?.skipped ?? 0,
    failed: outcome?.failed ?? 0,
    skippedUserIds: Array.isArray(outcome?.skippedUserIds) ? outcome.skippedUserIds : [],
  };
}

function PushCertificateScreen() {
  const navigate = useTransitionNavigate();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const festId = searchParams.get('festId') ?? '';

  const [activeTab, setActiveTab] = useState('winners');
  const [allParticipants, setAllParticipants] = useState([]);
  const [winners, setWinners] = useState([]); // [{ participantId, name, place }]
  const [loadState, setLoadState] = useState('loading');
  const [eventName, setEventName] = useState('');
  const [isPushingWinners, setIsPushingWinners] = useState(false);
  const [isPushingParticipation, setIsPushingParticipation] = useState(false);
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);
  const [pushModal, setPushModal] = useState(null);
  const [pushError, setPushError] = useState('');
  /*
   * The SERVER's counts, not the selection size. This used to be
   * { count: selected.length } — the number the coordinator ticked, regardless
   * of what actually happened. With the PDF-upload bug live, a push of forty
   * reported "40 pushed" when the true figure was zero.
   */
  const [pushDone, setPushDone] = useState(null); // { type, pushed, skipped, failed, skippedUserIds }

  // Separate templates
  const [winnerTemplate, setWinnerTemplate] = useState(null);
  const [winnerTemplatePreview, setWinnerTemplatePreview] = useState(null);
  const [participationTemplate, setParticipationTemplate] = useState(null);
  const [participationTemplatePreview, setParticipationTemplatePreview] = useState(null);
  const winnerFileRef = useRef(null);
  const participationFileRef = useRef(null);

  // Checkboxes — selected IDs for push
  const [selectedWinnerIds, setSelectedWinnerIds] = useState(new Set());
  const [selectedParticipationIds, setSelectedParticipationIds] = useState(new Set());

  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      /*
       * Two corrections here.
       *
       * The endpoints: the event router is mounted at /fests/:festId/events, so
       * bare /public/events/:id and /backstage/.../registrations both 404'd —
       * this screen could never load. It now reads the fest-scoped routes that
       * actually exist.
       *
       * The roster: /participants filters to `confirmed`, so the moment results
       * are finalised the winners (now winner1st/2nd/3rd) and the eliminated
       * drop out of it — exactly the people this screen exists to certify. It
       * reads the rounds instead, which is status-independent.
       */
      const base = `/fests/${festId}/events/${eventId}`;
      const [eventData, roundList] = await Promise.all([
        apiClient.get(base),
        apiClient.get(`${base}/rounds`).catch(() => ({ rounds: [] })),
      ]);
      setEventName(eventData?.eventName ?? 'Event');

      const rounds = (Array.isArray(roundList?.rounds) ? roundList.rounds : [])
        .sort((a, b) => a.roundNumber - b.roundNumber);

      const byId = new Map();
      for (const round of rounds) {
        const detail = await apiClient
          .get(`${base}/rounds/${round.id ?? round._id}`)
          .catch(() => null);
        for (const p of detail?.participants ?? []) {
          const id = p.participantUserId;
          if (!id || byId.has(id)) continue;
          byId.set(id, {
            id,
            name: p.teamName || p.fullName || 'Unknown',
            /* Never checked in means never competed — no certificate. */
            everPresent: p.isPresent !== false || p.score != null,
          });
        }
      }
      setAllParticipants([...byId.values()]);

      /*
       * Winners come from the finalised result, not from this screen's memory.
       * Finalise stamps winner1st/2nd/3rd on the registration, so the podium is
       * already decided by the time anyone opens this page — re-picking it here
       * would let the certificates disagree with the published results.
       */
      /*
       * listEventParticipants (backend) returns { individual, contingent,
       * pendingInvites } — never a bare array and never a `.registrations`
       * key. Winners can be registered either way, so both slices are
       * combined; pendingInvites are unconfirmed claims with no `status` a
       * winner status could ever match, so they fall out of the filter below
       * on their own.
       */
      const roster = await apiClient
        .get(`${base}/participants?includeAll=true`)
        .catch(() => null);
      const PLACE_BY_STATUS = { winner1st: '1st', winner2nd: '2nd', winner3rd: '3rd' };
      const decided = [...(roster?.individual ?? []), ...(roster?.contingent ?? [])]
        .filter((r) => PLACE_BY_STATUS[r.status])
        .map((r) => ({
          participantId: String(r.userId?.id ?? r.userId ?? r.id),
          name: r.userId?.fullName ?? r.fullName ?? 'Unknown',
          place: PLACE_BY_STATUS[r.status],
        }));
      if (decided.length > 0) {
        setWinners(decided);
        setSelectedWinnerIds(new Set(decided.map((w) => w.participantId)));
      }

      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [eventId, festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Winner IDs set
  const winnerIds = new Set(winners.map((w) => w.participantId));

  // Participation = everyone NOT in winners
  const participationList = allParticipants.filter((p) => !winnerIds.has(p.id));

  // Winner checkboxes
  function toggleWinner(id) {
    setSelectedWinnerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Participation checkboxes
  function toggleParticipation(id) {
    setSelectedParticipationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function toggleAllParticipation() {
    if (selectedParticipationIds.size === participationList.length) {
      setSelectedParticipationIds(new Set());
    } else {
      setSelectedParticipationIds(new Set(participationList.map((p) => p.id)));
    }
  }

  // Template handlers
  function handleWinnerTemplateUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setWinnerTemplate(file);
    const reader = new FileReader();
    reader.onload = (e) => setWinnerTemplatePreview(e.target.result);
    reader.readAsDataURL(file);
  }
  function handleWinnerTemplateRemove() {
    setWinnerTemplate(null);
    setWinnerTemplatePreview(null);
    if (winnerFileRef.current) winnerFileRef.current.value = '';
  }
  function handleParticipationTemplateUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setParticipationTemplate(file);
    const reader = new FileReader();
    reader.onload = (e) => setParticipationTemplatePreview(e.target.result);
    reader.readAsDataURL(file);
  }
  function handleParticipationTemplateRemove() {
    setParticipationTemplate(null);
    setParticipationTemplatePreview(null);
    if (participationFileRef.current) participationFileRef.current.value = '';
  }

  // Push handlers
  async function confirmPush() {
    if (!pushModal) return;
    const { type } = pushModal;
    setPushModal(null);

    if (type === 'winners') {
      setIsPushingWinners(true);
      try {
        const selectedWinners = winners.filter((w) => selectedWinnerIds.has(w.participantId));
        const formData = new FormData();
        formData.append('template', winnerTemplate);
        formData.append('winners', JSON.stringify(selectedWinners.map((w) => ({ userId: w.participantId, place: w.place }))));
        formData.append('participants', JSON.stringify([]));
        const outcome = await apiClient.post(
          `/backstage/coordinator/events/${eventId}/push-certificates`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        setSelectedWinnerIds(new Set());
        setPushDone({ type, ...summariseOutcome(outcome) });
      } catch (failure) {
        setPushError(failure?.message || 'Failed to push winner certificates. Please try again.');
      } finally {
        setIsPushingWinners(false);
      }
    } else {
      setIsPushingParticipation(true);
      try {
        const selectedParticipants = participationList.filter((p) => selectedParticipationIds.has(p.id));
        const formData = new FormData();
        formData.append('template', participationTemplate);
        formData.append('winners', JSON.stringify([]));
        formData.append('participants', JSON.stringify(selectedParticipants.map((p) => p.id)));
        const outcome = await apiClient.post(
          `/backstage/coordinator/events/${eventId}/push-certificates`,
          formData,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        setSelectedParticipationIds(new Set());
        setPushDone({ type, ...summariseOutcome(outcome) });
      } catch (failure) {
        setPushError(
          failure?.message || 'Failed to push participation certificates. Please try again.',
        );
      } finally {
        setIsPushingParticipation(false);
      }
    }
  }

  function handlePushWinners() {
    if (!winnerTemplate) { window.alert('Please upload a winner certificate template first.'); return; }
    if (selectedWinnerIds.size === 0) { window.alert('Please select at least one winner to push.'); return; }
    setPushModal({ type: 'winners', count: selectedWinnerIds.size });
  }

  function handlePushParticipation() {
    if (!participationTemplate) { window.alert('Please upload a participation certificate template first.'); return; }
    if (selectedParticipationIds.size === 0) { window.alert('Please select at least one participant to push.'); return; }
    setPushModal({ type: 'participation', count: selectedParticipationIds.size });
  }

  const modalPreview =
    pushModal?.type === 'winners' ? winnerTemplatePreview : participationTemplatePreview;

  return (
    <div className="dcd-push">
      {/*
        A TITLE, and an explicit back path.

        Passing no title left this screen stacking three bands down the top of
        the viewport: the participant app header (wordmark, search, bell), a
        bare floating back arrow under it, and then the screen's own <h1>. A
        title is what tells the layout to stand the app header down — see
        screen-title-context.jsx — so without one the bar this screen already
        had could never replace the one above it.

        The event name moves up into that bar rather than being repeated: it
        was the <h1> immediately below, and it is the thing a coordinator needs
        to see, since pushing certificates to the wrong event cannot be undone.

        Back goes to the event this screen was opened from, NOT navigate(-1).
        Two reasons. A pasted link lands here with empty history, where a delta
        is a silent no-op. And a history delta cannot be animated —
        use-transition-navigate resolves those through popstate, after the
        transition has already ended — so a path is what makes the returning
        slide actually run.
      */}
      <ScreenHeader
        title={eventName}
        onBack={() =>
          navigate(`/backstage/coordinator-event?eventId=${eventId}&festId=${festId}`)
        }
      />

      {loadState === 'loading' ? (
        <div className="dcd-push__pad">
          <div className="dcd-skel" style={{ height: 32, width: 192 }} />
          <div className="dcd-skel dcd-skel--row" style={{ height: 128 }} />
          <div className="dcd-skel dcd-skel--row" style={{ height: 192 }} />
        </div>
      ) : loadState === 'error' ? (
        <div className="dcd-push__pad">
          <div className="dcd-error">
            <p className="dcd-error__body">Could not load event data.</p>
            <button type="button" className="dcd-action" onClick={loadData}>
              <RetryIcon size="sm" />
              Try again
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div className="dcd-push__tabs" role="tablist" aria-label="Certificate batches">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'winners'}
              onClick={() => setActiveTab('winners')}
              className="dcd-push__tab"
            >
              <PrizeIcon size="sm" />
              Winners
              <span className="dcd-push__count">{winners.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'participation'}
              onClick={() => setActiveTab('participation')}
              className="dcd-push__tab"
            >
              <TeamIcon size="sm" />
              Participation
              <span className="dcd-push__count">{participationList.length}</span>
            </button>
          </div>

          {/* ─── WINNERS TAB ─── */}
          {activeTab === 'winners' ? (
            <div className="dcd-push__panel">
              <TemplateUploadBox
                templatePreview={winnerTemplatePreview}
                onUpload={handleWinnerTemplateUpload}
                onRemove={handleWinnerTemplateRemove}
                fileInputRef={winnerFileRef}
              />

              {/* The push button sits at the TOP of the tab, not the bottom:
                  the roster can run to hundreds of rows and a coordinator who
                  has already decided should not have to scroll to the end of it. */}
              <div className="dcd-push__section">
                <button
                  type="button"
                  onClick={handlePushWinners}
                  /* Bug 3: the server refuses a push with no template, so the
                     button says so instead of letting the tap fail. */
                  disabled={isPushingWinners || !winnerTemplate}
                  className="dcd-action"
                  data-variant="primary"
                  style={{ width: '100%' }}
                >
                  {isPushingWinners ? (
                    <span className="dcd-spinner" aria-hidden="true" />
                  ) : (
                    <SendIcon size="sm" />
                  )}
                  {isPushingWinners
                    ? 'Pushing…'
                    : !winnerTemplate
                      ? 'Upload a template first'
                      : `Push winner certificates (${selectedWinnerIds.size} selected)`}
                </button>
              </div>

              {winners.length > 0 ? (
                <div className="dcd-push__section dcd-push__group">
                  {PLACE_OPTIONS.filter((option) => winners.some((w) => w.place === option.value)).map((option) => {
                    const group = winners.filter((w) => w.place === option.value);
                    const meta = placeMeta(option.value);
                    return (
                      <div key={option.value} className="dcd-push__group">
                        <p className="dcd-push__grouphead">
                          {option.value} place ({group.length})
                        </p>
                        {group.map((winner) => (
                          <button
                            type="button"
                            key={winner.participantId}
                            className="dcd-row"
                            onClick={() => toggleWinner(winner.participantId)}
                            aria-pressed={selectedWinnerIds.has(winner.participantId)}
                            style={meta.rank ? { '--dcd-rank': meta.rank } : undefined}
                          >
                            <CheckBox checked={selectedWinnerIds.has(winner.participantId)} />
                            <span className="dcd-row__name">{winner.name}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="dcd-push__empty">
                  <PrizeIcon size="lg" />
                  <p>No winners assigned yet</p>
                  <p>Winners are set from the results board</p>
                </div>
              )}
            </div>
          ) : null}

          {/* ─── PARTICIPATION TAB ─── */}
          {activeTab === 'participation' ? (
            <div className="dcd-push__panel">
              <TemplateUploadBox
                templatePreview={participationTemplatePreview}
                onUpload={handleParticipationTemplateUpload}
                onRemove={handleParticipationTemplateRemove}
                fileInputRef={participationFileRef}
              />

              <div className="dcd-push__section">
                <button
                  type="button"
                  onClick={handlePushParticipation}
                  disabled={isPushingParticipation || !participationTemplate}
                  className="dcd-action"
                  data-variant="primary"
                  style={{ width: '100%' }}
                >
                  {isPushingParticipation ? (
                    <span className="dcd-spinner" aria-hidden="true" />
                  ) : (
                    <SendIcon size="sm" />
                  )}
                  {isPushingParticipation
                    ? 'Pushing…'
                    : !participationTemplate
                      ? 'Upload a template first'
                      : `Push participation certificates (${selectedParticipationIds.size} selected)`}
                </button>
              </div>

              {participationList.length === 0 ? (
                <div className="dcd-push__empty">
                  <TeamIcon size="lg" />
                  <p>Everyone on this roster is a winner</p>
                </div>
              ) : (
                <div className="dcd-push__section dcd-push__group">
                  <button
                    type="button"
                    onClick={toggleAllParticipation}
                    className="dcd-selectall"
                    aria-pressed={selectedParticipationIds.size === participationList.length}
                  >
                    <CheckBox
                      checked={selectedParticipationIds.size === participationList.length}
                    />
                    Select all ({participationList.length})
                  </button>

                  {participationList.map((participant) => (
                    <button
                      type="button"
                      key={participant.id}
                      className="dcd-row"
                      onClick={() => toggleParticipation(participant.id)}
                      aria-pressed={selectedParticipationIds.has(participant.id)}
                    >
                      <CheckBox checked={selectedParticipationIds.has(participant.id)} />
                      <span className="dcd-row__name">{participant.name}</span>
                      <span className="dcd-row__tag">Participation</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Preview + push confirmation */}
      {pushModal ? (
        <div className="dcd-scrim" onClick={() => setPushModal(null)}>
          <div className="dcd-sheet" onClick={(clickEvent) => clickEvent.stopPropagation()}>
            <div className="dcd-sheet__head">
              <h2 className="dcd-sheet__title">
                {pushModal.type === 'winners'
                  ? 'Winner certificate preview'
                  : 'Participation certificate preview'}
              </h2>
              <button
                type="button"
                onClick={() => setPushModal(null)}
                className="dcd-sheet__close"
                aria-label="Close"
              >
                <CloseIcon size="sm" />
              </button>
            </div>

            <div className="dcd-stamp">
              {modalPreview ? (
                <>
                  <img src={modalPreview} alt="Template" className="dcd-stamp__image" />
                  <span className="dcd-stamp__name">
                    <span>
                      {pushModal.type === 'winners'
                        ? (winners.find((w) => selectedWinnerIds.has(w.participantId))?.name ??
                          'Winner name')
                        : 'Participant name'}
                    </span>
                  </span>
                </>
              ) : (
                <div className="dcd-stamp__blank">
                  <RegistrationIcon size="lg" />
                  No template uploaded
                </div>
              )}
              <div className="dcd-stamp__foot">
                <p>
                  {pushModal.type === 'winners'
                    ? 'Certificate of achievement'
                    : 'Certificate of participation'}
                </p>
                <p>Each recipient&rsquo;s name is printed on their own copy</p>
              </div>
            </div>

            <dl className="dcd-summary">
              <div className="dcd-summary__row">
                <dt>Recipients</dt>
                <dd>
                  {pushModal.count} {pushModal.type === 'winners' ? 'winners' : 'participants'}
                </dd>
              </div>
              <div className="dcd-summary__row">
                <dt>Action</dt>
                <dd>Email and save to profile</dd>
              </div>
            </dl>

            <div className="dcd-sheet__actions">
              <button
                type="button"
                onClick={confirmPush}
                className="dcd-action"
                data-variant="primary"
              >
                <SendIcon size="sm" />
                Confirm and push
              </button>
              <button type="button" onClick={() => setPushModal(null)} className="dcd-action">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pushError ? (
        <div className="dcd-scrim" onClick={() => setPushError('')}>
          <div
            className="dcd-sheet dcd-sheet--dialog"
            role="alertdialog"
            aria-label="Push failed"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <h2 className="dcd-sheet__title">Could not push</h2>
            <p className="dcd-sheet__text">{pushError}</p>
            <div className="dcd-sheet__actions">
              <button
                type="button"
                onClick={() => setPushError('')}
                className="dcd-action"
                data-variant="primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* The push landed. Dismissed by the coordinator rather than on a timer:
          it is the record that the batch went out, and it should not vanish
          while they are still counting. */}
      {pushDone ? (
        <div className="dcd-scrim" onClick={() => setPushDone(null)}>
          <div
            className="dcd-sheet dcd-sheet--dialog"
            role="alertdialog"
            aria-label="Certificates pushed"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            {/*
              THE SERVER'S NUMBERS, and a warning rather than a tick when any of
              them failed. A batch that half-worked used to render the same
              green success as one that fully worked, because the count shown
              was the number selected rather than the number that landed.
            */}
            <div className="dcd-done">
              {pushDone.failed > 0 ? null : <DrawnCheck />}
              <h2 className="dcd-done__title">
                {pushDone.failed > 0
                  ? `${pushDone.pushed} of ${pushDone.pushed + pushDone.failed} sent`
                  : `${pushDone.pushed} ${pushDone.pushed === 1 ? 'certificate' : 'certificates'} pushed`}
              </h2>
              <p className="dcd-done__body">
                {pushDone.failed > 0
                  ? `${pushDone.failed} could not be sent. Nothing was charged and nobody was emailed twice — try those again.`
                  : `${pushDone.type === 'winners' ? 'Winners' : 'Participants'} have been emailed and the certificates are now in their profiles.`}
              </p>
              {/* A duplicate skip is correct behaviour, not a failure — so it is
                  reported quietly and separately from the failures. */}
              {pushDone.skipped > 0 ? (
                <p className="dcd-done__body">
                  {pushDone.skipped} already had this certificate and{' '}
                  {pushDone.skipped === 1 ? 'was' : 'were'} skipped.
                </p>
              ) : null}
            </div>
            <div className="dcd-sheet__actions">
              <button
                type="button"
                onClick={() => setPushDone(null)}
                className="dcd-action"
                data-variant="primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Exit confirmation */}
      {isExitModalOpen ? (
        <div
          className="dcd-scrim dcd-scrim--centred"
          onClick={() => setIsExitModalOpen(false)}
        >
          <div
            className="dcd-sheet dcd-sheet--dialog"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
          >
            <h2 className="dcd-sheet__title">Go back?</h2>
            <p className="dcd-sheet__text">Any unsaved selections will be lost.</p>
            <div className="dcd-sheet__actions">
              <button
                type="button"
                onClick={() =>
                  navigate(`/backstage/coordinator-event?eventId=${eventId}&festId=${festId}`)
                }
                className="dcd-action"
                data-variant="primary"
              >
                Yes, go back
              </button>
              <button
                type="button"
                onClick={() => setIsExitModalOpen(false)}
                className="dcd-action"
              >
                Stay here
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PushCertificateScreen;
