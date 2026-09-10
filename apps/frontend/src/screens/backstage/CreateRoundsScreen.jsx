// CreateRoundsScreen.jsx
// Route: /backstage/coordinator/events/:eventId/create-round
//
// The coordinator's round list, and the form that adds to it. Long-press a
// round to enter selection mode; delete asks first and the server renumbers
// what is left. Start is the moment a round goes live and the rules go out.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). Unchanged and moved verbatim: the
// { rounds: [...] } envelope reads on both list and delete, the create payload
// including the optional roundNumber, the PATCH edit payload, POST .../start
// and its navigate-to-scoreboard on success, the delete POST with roundIds, the
// 500ms long-press timer, the ghost-click swallow, and both cleanup timers.
//
// WHAT CHANGED, and why:
//
//   · CONFIRMATIONS ARE THE APP'S BottomSheet. Both were hand-rolled centred
//     modals rendered conditionally, which means neither could animate out and
//     neither had a focus trap. Starting a round and deleting rounds are the
//     two irreversible acts on this screen, so they get the real one.
//   · window.alert is gone from all four failure paths and from the "round
//     started, N emailed" success. Failures state themselves above the list;
//     the start result is a line in the same place. An alert box on a phone in
//     a green room is a modal you tap through without reading.
//   · ROUND STATE IS A WORD, and only a word: "Not started", "Live" (--primary,
//     the one thing on this screen that is happening right now), "Done". The
//     retired version used an olive wash for live and a grey wash for done,
//     which are two colours this palette does not have and one distinction
//     nobody could make in a hurry.
//   · The list is a table with 44px rows, not a stack of shadowed cards.
//   · The just-created round settles from a wash back to the row colour once,
//     over 400ms. That is the only animation on this screen, and it exists to
//     answer "did that save?".
//   · The delete control in the header only exists in selection mode. It was
//     always rendered, so it was possible to open the delete confirmation with
//     nothing selected and post an empty roundIds array.
//   · The Times New Roman form fields and the two olive gradients are gone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Paperclip, Pencil, Play, Plus, Trash, X } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import BottomSheet from '../../components/bottom-sheet/BottomSheet.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import apiClient from '../../api-client/api-client.js';

/* The three round states, as words. See the header for why there is no colour
   distinction beyond --primary for the one that is live. */
function roundStateWord(status) {
  if (status === 'active') return 'Live';
  if (status === 'completed') return 'Done';
  return 'Not started';
}

function CreateRoundsScreen() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const festId = searchParams.get('festId') ?? '';
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();

  const [rounds, setRounds] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  /* One place for every message this screen used to put in a window.alert. */
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  // Add Round full-page form
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRules, setFormRules] = useState('');
  const [formPosition, setFormPosition] = useState('');
  const [formFiles, setFormFiles] = useState([]);
  const [creating, setCreating] = useState(false);
  const [justCreatedId, setJustCreatedId] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [confirmStart, setConfirmStart] = useState(null);
  const riseTimer = useRef(null);
  const fileInputRef = useRef(null);

  // Edit mode — inline within a round row
  const [editingRoundId, setEditingRoundId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editRules, setEditRules] = useState('');
  const [saving, setSaving] = useState(false);

  // Selection / delete mode
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const longPressTimer = useRef(null);
  /* Swallows the browser's follow-up click after a long-press fires — without
   * it, the click lands with selectMode already on and instantly deselects the
   * round just selected (same bug as the Scoreboard's participant selection). */
  const longPressFired = useRef(false);

  // ── Data fetching ──────────────────────────────────────────────────────
  const loadRounds = useCallback(async () => {
    setLoadState('loading');
    try {
      const result = await apiClient.get(`/fests/${festId}/events/${eventId}/rounds`);
      /* listRounds returns { rounds: [...] }; the api-client already unwraps
       * the outer { data }, so the array is on .rounds. Checking only .data
       * left the list permanently empty even when rounds existed. */
      setRounds(
        Array.isArray(result?.rounds)
          ? result.rounds
          : Array.isArray(result?.data)
            ? result.data
            : Array.isArray(result)
              ? result
              : [],
      );
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [eventId, festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRounds();
  }, [loadRounds]);

  /* Leaving mid-settle must not set state on an unmounted screen. */
  useEffect(
    () => () => {
      window.clearTimeout(riseTimer.current);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    },
    [],
  );

  // ── Create round ──────────────────────────────────────────────────────
  async function handleCreate() {
    if (!formName.trim() || creating) return;
    setCreating(true);
    setFailure('');
    try {
      const payload = { roundName: formName.trim() };
      if (formDescription.trim()) payload.description = formDescription.trim();
      if (formRules.trim()) payload.rules = formRules.trim();
      if (formPosition && formPosition !== '') {
        payload.roundNumber = parseInt(formPosition, 10);
      }
      const created = await apiClient.post(
        `/fests/${festId}/events/${eventId}/rounds`,
        payload,
      );
      setJustCreatedId(created?.id ?? created?._id ?? null);
      /* Clear once the settle has run, or every later re-render replays it. */
      riseTimer.current = window.setTimeout(() => setJustCreatedId(null), 1500);
      setFormName('');
      setFormDescription('');
      setFormRules('');
      setFormPosition('');
      setFormFiles([]);
      setShowAddForm(false);
      await loadRounds();
    } catch (error) {
      setFailure(error?.message ?? 'Could not create the round. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  // ── Edit round ────────────────────────────────────────────────────────
  function startEdit(round) {
    setEditingRoundId(round.id);
    setEditName(round.roundName ?? '');
    setEditDescription(round.description ?? '');
    setEditRules(round.rules ?? '');
  }

  async function handleSaveEdit() {
    if (saving) return;
    setSaving(true);
    setFailure('');
    try {
      const payload = { roundName: editName.trim() || null };
      if (editDescription.trim()) payload.description = editDescription.trim();
      if (editRules.trim()) payload.rules = editRules.trim();
      await apiClient.patch(`/fests/${festId}/events/${eventId}/rounds/${editingRoundId}`, payload);
      setEditingRoundId(null);
      await loadRounds();
    } catch (error) {
      setFailure(error?.message ?? 'Could not save my changes. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Start a round ─────────────────────────────────────────────────────
  /*
   * Irreversible: it freezes the roster and emails every participant. So it
   * asks first, and says plainly what will happen rather than just "confirm?".
   */
  async function handleStart(round) {
    if (startingId) return;
    setStartingId(round.id);
    setFailure('');
    try {
      const result = await apiClient.post(
        `/fests/${festId}/events/${eventId}/rounds/${round.id}/start`,
      );
      setConfirmStart(null);
      setNotice(
        `Round started. ${result?.emailedCount ?? 0} participant${
          (result?.emailedCount ?? 0) === 1 ? '' : 's'
        } emailed the rules.`,
      );
      await loadRounds();
      navigate(`/backstage/coordinator/events/${eventId}/scoreboard?festId=${festId}`);
    } catch (error) {
      setFailure(error?.message ?? 'Could not start this round. Please try again.');
    } finally {
      setStartingId(null);
    }
  }

  // ── Selection / Delete ────────────────────────────────────────────────
  function handleLongPressStart(roundId) {
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setSelectMode(true);
      setSelectedIds(new Set([roundId]));
    }, 500);
  }

  function handleLongPressEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  function toggleSelect(roundId) {
    if (!selectMode) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(roundId)) next.delete(roundId);
      else next.add(roundId);
      return next;
    });
  }

  function cancelSelection() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setFailure('');
    try {
      const result = await apiClient.post(`/fests/${festId}/events/${eventId}/rounds/delete`, {
        roundIds: [...selectedIds],
      });
      /* deleteRounds returns the refreshed list in the same { rounds: [...] }
       * envelope; reading .data alone blanked the list after every delete. */
      setRounds(
        Array.isArray(result?.rounds)
          ? result.rounds
          : Array.isArray(result?.data)
            ? result.data
            : [],
      );
      setShowConfirmDelete(false);
      setSelectMode(false);
      setSelectedIds(new Set());
    } catch (error) {
      setShowConfirmDelete(false);
      setFailure(error?.message ?? 'Could not delete those rounds. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  // File attachments, held on the form until the upload endpoint exists.
  function handleFileAdd() {
    fileInputRef.current?.click();
  }
  function handleFileChange(e) {
    const files = Array.from(e.target.files ?? []);
    setFormFiles((prev) => [...prev, ...files.map((f) => ({ name: f.name, file: f }))]);
    e.target.value = '';
  }
  function removeFile(index) {
    setFormFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const selectedRoundNames = rounds
    .filter((r) => selectedIds.has(r.id))
    .map((r) => r.roundName || `Round ${r.roundNumber}`)
    .join(', ');

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="dop-screen">
      <ScreenHeader
        title={showAddForm ? 'Add a round' : 'Rounds'}
        onBack={showAddForm ? () => setShowAddForm(false) : undefined}
        action={
          selectMode ? (
            <>
              <button
                type="button"
                aria-label="Cancel selection"
                onClick={cancelSelection}
                className="dop-iconbtn"
              >
                <X size={20} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Delete ${selectedIds.size} selected rounds`}
                disabled={selectedIds.size === 0}
                onClick={() => setShowConfirmDelete(true)}
                className="dop-iconbtn dop-iconbtn--danger"
              >
                <Trash size={20} aria-hidden="true" />
              </button>
            </>
          ) : null
        }
      />

      {showAddForm ? (
        <div className="dop-page dop-page--narrow">
          {failure ? (
            <p className="dop-alert" role="alert">
              {failure}
            </p>
          ) : null}

          <label className="dop-field">
            <span className="dop-field__label">Position</span>
            <select
              className="dop-select"
              value={formPosition}
              onChange={(e) => setFormPosition(e.target.value)}
            >
              <option value="">Round {rounds.length + 1}, next in order</option>
              {Array.from({ length: rounds.length + 1 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Round {i + 1}
                </option>
              ))}
            </select>
            <span className="dop-count" style={{ alignSelf: 'flex-start' }}>
              Leave this alone to add the round at the end.
            </span>
          </label>

          <label className="dop-field">
            <span className="dop-field__label">Name</span>
            <input
              type="text"
              className="dop-input"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Quarter finals"
            />
          </label>

          <label className="dop-field">
            <span className="dop-field__label">Description</span>
            <textarea
              className="dop-textarea"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="What happens in this round."
              rows={3}
            />
          </label>

          <label className="dop-field">
            <span className="dop-field__label">Rules</span>
            <textarea
              className="dop-textarea"
              value={formRules}
              onChange={(e) => setFormRules(e.target.value)}
              placeholder="Emailed to every participant when the round starts."
              rows={4}
            />
          </label>

          <div className="dop-field">
            <span className="dop-field__label">Attachments</span>
            {formFiles.length > 0 ? (
              <div className="dop-chipwrap">
                {formFiles.map((file, index) => (
                  <span key={`${file.name}-${index}`} className="dop-tag">
                    <Paperclip size={12} aria-hidden="true" />
                    {file.name}
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(index)}
                      className="dop-btn dop-btn--quiet dop-btn--sm"
                      style={{ minHeight: '20px', padding: 0 }}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleFileAdd}
              className="dop-btn"
              style={{ alignSelf: 'flex-start' }}
            >
              <Plus size={16} aria-hidden="true" />
              {formFiles.length > 0 ? 'Add more files' : 'Add files'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={handleFileChange}
              accept=".ppt,.pptx,.doc,.docx,.pdf,.xls,.xlsx"
              multiple
            />
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={!formName.trim() || creating || !isOnline}
            className="dop-btn dop-btn--block dop-btn--accent"
          >
            {creating ? 'Creating…' : 'Create round'}
          </button>
          {!isOnline ? (
            <p className="dop-offline" role="status">
              You are offline, so nothing can be saved until the connection is back.
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="dop-page">
            {notice ? (
              <p className="dop-receipt" role="status">
                {notice}
              </p>
            ) : null}
            {failure ? (
              <p className="dop-alert" role="alert">
                {failure}
              </p>
            ) : null}
            {!isOnline ? (
              <p className="dop-offline" role="status">
                You are offline, so starting, editing and deleting rounds are turned off.
              </p>
            ) : null}
            {selectMode ? (
              <p className="dop-note dop-note--ink">
                {selectedIds.size} selected. Tap rounds to add or remove them.
              </p>
            ) : null}

            {loadState === 'loading' ? (
              <div className="dop-skstack">
                <span className="dop-sk dop-sk--row" />
                <span className="dop-sk dop-sk--row" />
                <span className="dop-sk dop-sk--row" />
              </div>
            ) : null}

            {loadState === 'error' ? (
              <div className="dop-retry">
                <p className="dop-retry__text">Could not load the rounds.</p>
                <button type="button" className="dop-btn" onClick={loadRounds}>
                  Try again
                </button>
              </div>
            ) : null}

            {loadState === 'ready' ? (
              rounds.length === 0 ? (
                <EmptyState
                  line="No rounds yet."
                  actionLabel="Add a round"
                  onAction={() => setShowAddForm(true)}
                />
              ) : (
                <div className="dop-table">
                  {rounds.map((round) => {
                    const isSelected = selectedIds.has(round.id);
                    const isEditing = editingRoundId === round.id;
                    const isLive = round.status === 'active';
                    return (
                      <div key={round.id}>
                        <div
                          className={[
                            'dop-row',
                            isSelected ? 'dop-row--marked' : '',
                            round.id === justCreatedId ? 'dop-settled' : '',
                          ].join(' ')}
                          onTouchStart={() => !selectMode && handleLongPressStart(round.id)}
                          onTouchEnd={handleLongPressEnd}
                          onTouchMove={handleLongPressEnd}
                          onTouchCancel={handleLongPressEnd}
                          onContextMenu={(contextEvent) => contextEvent.preventDefault()}
                          onMouseDown={() => !selectMode && handleLongPressStart(round.id)}
                          onMouseUp={handleLongPressEnd}
                          onMouseLeave={handleLongPressEnd}
                          onClick={() => {
                            if (longPressFired.current) {
                              longPressFired.current = false;
                              return;
                            }
                            if (selectMode) toggleSelect(round.id);
                          }}
                        >
                          <span className="dop-rank">{round.roundNumber}</span>
                          <span className="dop-row__main">
                            <span className="dop-row__name">
                              {round.roundName || `Round ${round.roundNumber}`}
                            </span>
                            <span className="dop-row__meta">
                              {isSelected ? 'Selected for deletion' : roundStateWord(round.status)}
                            </span>
                          </span>

                          <span className="dop-row__end">
                            {!selectMode ? (
                              round.status === 'draft' ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmStart(round);
                                  }}
                                  disabled={startingId === round.id || !isOnline}
                                  className="dop-btn dop-btn--sm dop-btn--primary"
                                >
                                  <Play size={13} aria-hidden="true" />
                                  {startingId === round.id ? 'Starting…' : 'Start'}
                                </button>
                              ) : (
                                <span
                                  className={[
                                    'dop-state',
                                    isLive ? 'dop-state--live' : 'dop-state--done',
                                  ].join(' ')}
                                >
                                  {isLive ? (
                                    <span className="dop-state__dot" aria-hidden="true" />
                                  ) : (
                                    <Check size={14} aria-hidden="true" />
                                  )}
                                  {roundStateWord(round.status)}
                                </span>
                              )
                            ) : null}

                            {!selectMode ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isEditing) setEditingRoundId(null);
                                  else startEdit(round);
                                }}
                                aria-label={isEditing ? 'Close editing' : 'Edit this round'}
                                className="dop-iconbtn"
                              >
                                {isEditing ? (
                                  <X size={16} aria-hidden="true" />
                                ) : (
                                  <Pencil size={16} aria-hidden="true" />
                                )}
                              </button>
                            ) : null}
                          </span>
                        </div>

                        {isEditing ? (
                          <div className="dop-detail">
                            <label className="dop-field">
                              <span className="dop-field__label">Name</span>
                              <input
                                type="text"
                                className="dop-input"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                              />
                            </label>
                            <label className="dop-field">
                              <span className="dop-field__label">Description</span>
                              <textarea
                                className="dop-textarea"
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                rows={2}
                              />
                            </label>
                            <label className="dop-field">
                              <span className="dop-field__label">Rules</span>
                              <textarea
                                className="dop-textarea"
                                value={editRules}
                                onChange={(e) => setEditRules(e.target.value)}
                                rows={3}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={handleSaveEdit}
                              disabled={saving || !isOnline}
                              className="dop-btn dop-btn--block dop-btn--accent"
                            >
                              {saving ? 'Saving…' : 'Save changes'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )
            ) : null}
          </div>

          <div className="dop-bar">
            <div className="dop-bar__inner">
              <button
                type="button"
                onClick={() => {
                  setFailure('');
                  setShowAddForm(true);
                }}
                className="dop-btn dop-btn--block dop-btn--accent"
              >
                <Plus size={18} aria-hidden="true" />
                Add a round
                {rounds.length > 0 ? ` · ${rounds.length} so far` : ''}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Start confirmation ──────────────────────────────────────────── */}
      <BottomSheet
        isOpen={Boolean(confirmStart)}
        onClose={() => (startingId ? undefined : setConfirmStart(null))}
        title={
          confirmStart
            ? `Start ${confirmStart.roundName || `Round ${confirmStart.roundNumber}`}?`
            : 'Start this round?'
        }
      >
        <div className="dop-sheet">
          {/* Spelled out because none of it can be undone. */}
          <ul className="dop-sheet__list">
            <li>The participant list closes, so late check-ins will not be added.</li>
            <li>The round goes live on the scoreboard.</li>
            <li>Everyone in it is emailed the description and the rules.</li>
          </ul>
          <p className="dop-sheet__body">This cannot be undone.</p>
          <div className="dop-actions">
            <button type="button" className="dop-btn" onClick={() => setConfirmStart(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="dop-btn dop-btn--primary"
              onClick={() => confirmStart && handleStart(confirmStart)}
              disabled={startingId != null || !isOnline}
            >
              {startingId ? 'Starting…' : 'Start the round'}
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* ── Delete confirmation ─────────────────────────────────────────── */}
      <BottomSheet
        isOpen={showConfirmDelete}
        onClose={() => (deleting ? undefined : setShowConfirmDelete(false))}
        title={`Delete ${selectedIds.size} round${selectedIds.size === 1 ? '' : 's'}?`}
      >
        <div className="dop-sheet">
          <p className="dop-sheet__body">
            {selectedRoundNames} will be deleted for good. The rounds left behind renumber
            themselves.
          </p>
          <div className="dop-actions">
            <button
              type="button"
              className="dop-btn"
              onClick={() => setShowConfirmDelete(false)}
              disabled={deleting}
            >
              Keep them
            </button>
            <button
              type="button"
              className="dop-btn dop-btn--primary"
              onClick={handleDelete}
              disabled={deleting || !isOnline}
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export default CreateRoundsScreen;
