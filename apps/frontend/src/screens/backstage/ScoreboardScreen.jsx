// ScoreboardScreen.jsx
// Route: /backstage/coordinator/events/:eventId/scorecard — where marks go in,
// where people are advanced or eliminated, and where the result is finalised.
//
// This is the highest-stakes screen a coordinator touches. Finalising awards
// medals, hands the result to the admin and locks every score; eliminating
// stamps registrations and drives which certificate a person eventually gets.
// Both are one tap from a list of names.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). Unchanged and moved verbatim: the round
// list envelope and its sort, the findLastIndex "open the newest non-draft
// round" rule, loadRoundParticipants including the previous-round loop that
// builds the combined totals, the { scores: [...] } save payload, the presence
// gate on scoring and its completed-round exemption, the 500ms long-press with
// its ghost-click swallow, /advance for push-all versus /eliminate for the
// split (and why: certificates read registration status), the lots map of
// advancement tiers, the podium override sent as `winners` on finalise, and the
// data-only ordering that keeps rows still while a long-press is landing.
//
// WHAT CHANGED, and why:
//
//   · THE TIER STRIPES ARE GONE. A sorted list drew a 4px left border in amber,
//     blue or green over its top, middle and bottom thirds. Three colours this
//     palette does not have, encoding a distinction with no label, on the one
//     screen where misreading a row has consequences. Sorting now prints the
//     RANK NUMBER in a fixed gutter, which is both the thing the stripes were
//     approximating and something a coordinator can read aloud.
//   · THE MEDALS ARE WORDS. Gold / silver / bronze gradients and 🥇🥈🥉 became
//     "First place", "Second place", "Third place" over a plain rank number.
//     --gold is certificates-only and the palette has no silver; more to the
//     point, three metallic gradients at 10px are indistinguishable under stage
//     lighting. An assigned placement also insets the row in --accent, because
//     it is the coordinator's own decision rather than a state of the world.
//   · EVERY CONFIRMATION IS THE APP'S BottomSheet — push-all, eliminate,
//     finalise, and marks entry. All four were hand-rolled overlays rendered
//     conditionally, so none could animate out and none trapped focus.
//   · window.alert is gone from six paths: the checked-out gate, the score save
//     failure, push-all, eliminate, finalise, and the presence explanation.
//     Each now states itself in a line above the roster, where the roster it is
//     talking about is still visible.
//   · The roster is one table with 44px rows, not a stack of cards at 55%
//     opacity. Scored and unscored are separated by a labelled hairline.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpDown,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  RefreshCw,
  UserMinus,
} from 'lucide-react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import BottomSheet from '../../components/bottom-sheet/BottomSheet.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import apiClient from '../../api-client/api-client.js';

/*
 * The three advancement tiers. The KEY is what the server reads to pick the
 * message; the label is what the coordinator picks from. Naming the tone rather
 * than a letter is the point — 'Group A' told a coordinator nothing about what
 * the participant would actually read. The emoji are gone: the words are the
 * message and a 🏆 at 11px is a smudge.
 */
const ADVANCEMENT_TIERS = [
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'strong', label: 'Strong' },
  { key: 'improving', label: 'Keep improving' },
];

/* Placement, in words. There is no gold, silver or bronze on this surface. */
const PLACEMENT_LABEL = { 1: 'First place', 2: 'Second place', 3: 'Third place' };

/* The three round states, as words, everywhere they appear. */
function roundStateWord(status) {
  if (status === 'completed') return 'Done';
  if (status === 'active') return 'Live';
  return 'Not started';
}

function ScoreboardScreen() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const festId = searchParams.get('festId') ?? '';
  const isOnline = useOnlineStatus();

  const [event, setEvent] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [activeRoundIdx, setActiveRoundIdx] = useState(0);
  const [participants, setParticipants] = useState([]);
  const [scores, setScores] = useState({});
  const [loadState, setLoadState] = useState('loading');
  const [showResults, setShowResults] = useState(false);
  /* Where every window.alert on this screen went. */
  const [failure, setFailure] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sorted, setSorted] = useState(false);

  const [showMarksSheet, setShowMarksSheet] = useState(null);
  const [marksValue, setMarksValue] = useState('');
  const [savingScore, setSavingScore] = useState(false);
  const [justSavedId, setJustSavedId] = useState(null);

  const [showConfirm, setShowConfirm] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [finalised, setFinalised] = useState(false);

  const activeRoundIdxRef = useRef(0);
  const isFirstLoad = useRef(true);
  const settleTimer = useRef(null);

  useEffect(() => {
    activeRoundIdxRef.current = activeRoundIdx;
  }, [activeRoundIdx]);

  const longPressTimer = useRef(null);
  /*
   * The coordinator's OWN podium, when they override the score ranking.
   * Keyed by placement so a place can hold exactly one person and a person can
   * hold exactly one place — the two rules the server also enforces, kept
   * structurally here rather than checked after the fact.
   */
  /*
   * Which advancement message each participant gets, keyed by participant id.
   * Unset means the server's neutral default ('strong'), so a coordinator who
   * does not care still sends something that reads correctly.
   */
  const [tierByParticipant, setTierByParticipant] = useState({});
  const [podium, setPodium] = useState({});
  /* True for the instant between a long-press firing and the browser's
   * follow-up click on touch release. That ghost click used to land AFTER
   * selectMode flipped on, so it toggled whichever row sat under the finger. */
  const longPressFired = useRef(false);

  const activeRound = showResults ? null : rounds[activeRoundIdx];
  /* Final = nothing after it, so nobody could advance even in principle. This
   * is the same test the server uses before deciding whether to email. */
  const isFinalRound =
    !!activeRound && !rounds.some((r) => r.roundNumber > activeRound.roundNumber);
  const isTeamEvent = event?.eventType === 'team';

  // ── Load data ───────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      const [eventData, roundList] = await Promise.all([
        apiClient.get(`/fests/${festId}/events/${eventId}`),
        apiClient.get(`/fests/${festId}/events/${eventId}/rounds`),
      ]);
      setEvent(eventData);
      setFinalised(Boolean(eventData?.resultsFinalisedAt));
      /* Same envelope as above: the array lives on .rounds. */
      const rawRounds = Array.isArray(roundList?.rounds)
        ? roundList.rounds
        : Array.isArray(roundList)
          ? roundList
          : [];
      const sortedRounds = [...rawRounds].sort((a, b) => a.roundNumber - b.roundNumber);
      setRounds(sortedRounds);

      if (sortedRounds.length > 0) {
        let targetIdx = activeRoundIdxRef.current;
        if (isFirstLoad.current) {
          isFirstLoad.current = false;
          targetIdx = sortedRounds.findLastIndex((r) => r.status !== 'draft');
          if (targetIdx === -1) targetIdx = 0;
          setActiveRoundIdx(targetIdx);
        }
        await loadRoundParticipants(sortedRounds[targetIdx], sortedRounds);
      }
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
    /* loadRoundParticipants is a plain function declared below and re-created
       every render; listing it here would re-create loadData on every render
       and re-fire the mount effect in a loop. It closes over nothing that this
       callback does not already depend on. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, festId]);

  async function loadRoundParticipants(round, allRounds) {
    try {
      const detail = await apiClient.get(
        `/fests/${festId}/events/${eventId}/rounds/${round.id || round._id}`,
      );
      /*
       * getRoundDetail returns { round, participants: [...] } where each
       * participant carries its own score. There is no `participantIds` and no
       * separate `scores` array — reading those left the roster empty and every
       * score blank even when the round was properly seeded.
       */
      const pList = Array.isArray(detail?.participants) ? detail.participants : [];
      setParticipants(pList);

      const scoreMap = {};
      for (const p of pList) {
        if (p?.participantUserId != null && p.score != null) {
          scoreMap[p.participantUserId] = p.score;
        }
      }

      const prevRounds = allRounds.filter((r) => r.roundNumber < round.roundNumber);
      const combinedScores = {};
      for (const pr of prevRounds) {
        try {
          const prDetail = await apiClient.get(
            `/fests/${festId}/events/${eventId}/rounds/${pr.id || pr._id}`,
          );
          for (const p of prDetail?.participants ?? []) {
            if (p?.participantUserId == null || p.score == null) continue;
            combinedScores[p.participantUserId] =
              (combinedScores[p.participantUserId] || 0) + p.score;
          }
        } catch {
          /* skip */
        }
      }

      setScores({ current: scoreMap, combined: combinedScores, roundNumber: round.roundNumber });
      setSorted(false);
      setSelectMode(false);
      setSelectedIds(new Set());
      setExpandedId(null);
    } catch {
      /* fail silently */
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      window.clearTimeout(settleTimer.current);
    };
  }, []);

  // ── Switch round tab ────────────────────────────────────────
  function handleTabClick(idx) {
    setShowResults(false);
    setActiveRoundIdx(idx);
    loadRoundParticipants(rounds[idx], rounds);
  }

  function handleResultsTab() {
    setShowResults(true);
    if (rounds.length > 0) {
      const finalRoundIdx = rounds.length - 1;
      setActiveRoundIdx(finalRoundIdx);
      loadRoundParticipants(rounds[finalRoundIdx], rounds);
    }
  }

  // ── Participant helpers ─────────────────────────────────────
  function getParticipantId(p) {
    if (typeof p === 'string') return p;
    /* participantUserId is what getRoundDetail returns; the others are
     * fallbacks for shapes this screen may be handed elsewhere. */
    return p.participantUserId || p.userId || p._id || p.id;
  }
  function getParticipantName(p) {
    if (typeof p === 'string') return 'Participant';
    return p.teamName || p.fullName || p.name || 'Participant';
  }
  function getParticipantCollege(p) {
    if (typeof p === 'string') return '';
    return p.collegeName || p.college?.commonName || p.college?.collegeName || '';
  }
  function getTeamMembers(p) {
    if (typeof p === 'string') return [];
    return p.members || p.teamMembers || [];
  }

  const allScored = useMemo(
    () =>
      participants.length > 0 &&
      participants.every((p) => {
        const uid = typeof p === 'string' ? p : p.userId || p._id || p.id;
        return scores.current?.[uid] != null;
      }),
    [participants, scores],
  );

  const sortedParticipants = useMemo(() => {
    const list = [...participants];
    if (sorted) {
      list.sort((a, b) => {
        const sa = scores.current?.[getParticipantId(a)] ?? 0;
        const sb = scores.current?.[getParticipantId(b)] ?? 0;
        const ca = scores.combined?.[getParticipantId(a)] ?? 0;
        const cb = scores.combined?.[getParticipantId(b)] ?? 0;
        return sb + cb - (sa + ca);
      });
    } else {
      /*
       * Same grouping whether or not select mode is on. It used to switch OFF
       * on entering selection, which reordered the rows at the exact moment a
       * long-press fired — the row under the finger changed identity, and the
       * follow-up click selected "the middle person". Order must be a function
       * of the DATA, never of the interaction mode.
       */
      const scored = list.filter((p) => scores.current?.[getParticipantId(p)] != null);
      const unscored = list.filter((p) => scores.current?.[getParticipantId(p)] == null);
      return [...unscored, ...scored];
    }
    return list;
  }, [participants, scores, sorted]);

  const scoredCount = participants.filter(
    (p) => scores.current?.[getParticipantId(p)] != null,
  ).length;

  // ── Enter marks ─────────────────────────────────────────────
  function openMarksSheet(p) {
    /*
     * Presence gate. Someone who has left keeps their row and any score already
     * recorded — they competed — but cannot be scored again until they are back
     * through the door. The server enforces this too; this is just the honest
     * version of the same rule.
     *
     * Lifted once the round is completed — see saveRoundScores: by then nobody
     * is present, so keeping the gate on would block corrections entirely.
     */
    if (p?.isPresent === false && activeRound?.status !== 'completed' && !finalised) {
      setFailure(
        `${getParticipantName(p)} is checked out. They must scan in at the event entry before marks can be recorded.`,
      );
      return;
    }
    setFailure('');
    const uid = getParticipantId(p);
    setShowMarksSheet(p);
    setMarksValue(scores.current?.[uid]?.toString() ?? '');
  }

  async function handleSaveScore() {
    if (savingScore || !showMarksSheet) return;
    setSavingScore(true);
    setFailure('');
    try {
      const uid = getParticipantId(showMarksSheet);
      const roundId = activeRound.id || activeRound._id;
      /* The controller reads `scores` (or a bare array); `entries` arrived as
       * undefined and every save was a silent no-op. */
      await apiClient.post(`/fests/${festId}/events/${eventId}/rounds/${roundId}/scores`, {
        scores: [{ participantUserId: uid, score: Number(marksValue) || 0 }],
      });
      setScores((prev) => ({
        ...prev,
        current: { ...prev.current, [uid]: Number(marksValue) || 0 },
      }));
      setShowMarksSheet(null);
      /* The one animation on this screen: the row that took the write settles
         back to the table colour, so "did that save?" has an answer. */
      setJustSavedId(uid);
      window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => setJustSavedId(null), 1000);
      /*
       * Re-rank immediately. An edited score left in its old position makes the
       * ranking on screen disagree with the numbers on it, which is worse than
       * no ranking at all.
       */
      setSorted(true);
    } catch (e) {
      /* The 409 explains itself ("not checked in", "results finalised") —
       * hiding it in the console made every failure read as "not saving". */
      setFailure(e?.message ?? 'Could not save that score. Please try again.');
    } finally {
      setSavingScore(false);
    }
  }

  // ── Selection / Elimination ─────────────────────────────────
  function handleLongPressStart(pid) {
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (isFinalRound) {
        setExpandedId(pid);
        setSelectMode(false);
      } else {
        setSelectMode(true);
        setSelectedIds(new Set([pid]));
      }
    }, 500);
  }
  function handleLongPressEnd() {
    clearTimeout(longPressTimer.current);
  }
  function toggleSelect(pid) {
    if (!selectMode) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  /*
   * Tapping a placement MOVES it. Assigning first to someone who already holds
   * second clears the second, and taking first from its current holder hands it
   * over, so the podium is always three distinct people and the coordinator
   * never has to un-assign before re-assigning.
   */
  function assignPlacement(participantUserId, placement) {
    setPodium((previous) => {
      const next = { ...previous };
      if (next[placement] === participantUserId) {
        delete next[placement];
        return next;
      }
      for (const place of Object.keys(next)) {
        if (next[place] === participantUserId) {
          delete next[place];
        }
      }
      next[placement] = participantUserId;
      return next;
    });
  }

  const placementOf = (participantUserId) =>
    Number(Object.keys(podium).find((place) => podium[place] === participantUserId)) || null;

  // ── Push All / Eliminate ────────────────────────────────────
  async function handlePushAll() {
    if (processing) return;
    setProcessing(true);
    setFailure('');
    try {
      const allIds = participants.map(getParticipantId);
      const roundId = activeRound.id || activeRound._id;
      await apiClient.post(`/fests/${festId}/events/${eventId}/rounds/${roundId}/advance`, {
        participantUserIds: allIds,
      });
      setShowConfirm(null);
      await loadData();
    } catch (e) {
      /* Silently logging left the button looking dead when the server refused
       * (e.g. no next round exists). Surface the reason instead. */
      setShowConfirm(null);
      setFailure(e?.message ?? 'Could not push participants to the next round.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleEliminateAndPush() {
    if (processing) return;
    setProcessing(true);
    setFailure('');
    try {
      const advancingIds = participants
        .map(getParticipantId)
        .filter((id) => !selectedIds.has(id));
      const roundId = activeRound.id || activeRound._id;
      /*
       * /eliminate rather than /advance: advance only shortlists survivors into
       * the next round, leaving the eliminated with a `confirmed` registration.
       * Certificates are generated from registration status, so without the
       * ELIMINATED stamp the eliminated never reach the participation pile.
       */
      await apiClient.post(`/fests/${festId}/events/${eventId}/rounds/${roundId}/eliminate`, {
        advancingUserIds: advancingIds,
        eliminatedUserIds: [...selectedIds],
        /* Only the advancers' tiers — the eliminated all read one message. */
        lots: Object.fromEntries(
          advancingIds
            .filter((id) => tierByParticipant[id])
            .map((id) => [id, tierByParticipant[id]]),
        ),
      });
      setShowConfirm(null);
      setSelectMode(false);
      setSelectedIds(new Set());
      await loadData();
    } catch (e) {
      setShowConfirm(null);
      setFailure(e?.message ?? 'Could not eliminate the selected participants.');
    } finally {
      setProcessing(false);
    }
  }

  // ── Award results ───────────────────────────────────────────
  /*
   * Finalise is the one irreversible step: it awards the placements, hands the
   * result to the admin, and locks every score. Everything before it is
   * provisional, which is why edits stay open through completed rounds.
   */
  async function handleFinalise() {
    if (awarding) return;
    setAwarding(true);
    setFailure('');
    try {
      /*
       * An explicit podium OVERRIDES the score ranking server-side; sending
       * nothing falls back to totals, which is the right default when the
       * coordinator has not picked. Previously nothing was ever sent, so a
       * judge's call could not beat the arithmetic.
       */
      const winnerList = Object.entries(podium).map(([placement, userId]) => ({
        userId,
        placement: Number(placement),
      }));
      await apiClient.post(
        `/fests/${festId}/events/${eventId}/rounds/finalise`,
        winnerList.length > 0 ? { winners: winnerList } : {},
      );
      setShowConfirm(null);
      await loadData();
    } catch (error) {
      setShowConfirm(null);
      setFailure(
        error?.message ?? 'Could not finalise the results. Complete the final round first.',
      );
    } finally {
      setAwarding(false);
    }
  }

  // ── Rearrange ───────────────────────────────────────────────
  function handleRearrange() {
    setSorted(true);
  }

  // ── Combined score label ────────────────────────────────────
  function getScoreLabel(roundNumber) {
    if (roundNumber <= 1) return '';
    if (roundNumber === 2) return 'from round 1';
    return `from rounds 1 to ${roundNumber - 1}`;
  }

  // ── Results winners ─────────────────────────────────────────
  const winners = useMemo(() => {
    if (!showResults || rounds.length === 0) return [];
    const totalScores = {};
    participants.forEach((p) => {
      const uid = getParticipantId(p);
      totalScores[uid] = (scores.combined?.[uid] || 0) + (scores.current?.[uid] || 0);
    });
    return [...participants]
      .sort(
        (a, b) =>
          (totalScores[getParticipantId(b)] || 0) - (totalScores[getParticipantId(a)] || 0),
      )
      .slice(0, 3)
      .map((p, i) => ({ ...p, rank: i, total: totalScores[getParticipantId(p)] || 0 }));
  }, [showResults, participants, scores, rounds]);

  // ── One roster row ──────────────────────────────────────────
  function renderRow(p, index) {
    const uid = getParticipantId(p);
    const isExpanded = expandedId === uid;
    const isSelected = selectedIds.has(uid);
    const currentScore = scores.current?.[uid];
    const combinedScore = scores.combined?.[uid] || 0;
    const roundNum = scores.roundNumber || 1;
    const placement = placementOf(uid);
    const isCheckedOut = p?.isPresent === false && activeRound?.status !== 'completed';

    /* Everything true about this row, as one line of words. */
    const metaParts = [];
    if (isSelected) metaParts.push('Selected to eliminate');
    if (placement) metaParts.push(PLACEMENT_LABEL[placement]);
    if (isCheckedOut) metaParts.push('Checked out');
    if (isTeamEvent && getTeamMembers(p).length > 0) {
      metaParts.push(
        `${getTeamMembers(p).length} member${getTeamMembers(p).length === 1 ? '' : 's'}`,
      );
    }
    if (roundNum > 1 && combinedScore > 0) {
      metaParts.push(`${combinedScore} ${getScoreLabel(roundNum)}`);
    }
    const college = getParticipantCollege(p);
    if (!isTeamEvent && college) metaParts.push(college);

    return (
      <div key={uid}>
        <div
          className={[
            'dop-row',
            isSelected ? 'dop-row--marked' : '',
            !isSelected && placement ? 'dop-row--chosen' : '',
            uid === justSavedId ? 'dop-settled' : '',
          ].join(' ')}
          onTouchStart={() => !selectMode && handleLongPressStart(uid)}
          onTouchEnd={handleLongPressEnd}
          onTouchMove={handleLongPressEnd}
          onTouchCancel={handleLongPressEnd}
          onContextMenu={(contextEvent) => contextEvent.preventDefault()}
          onMouseDown={() => !selectMode && handleLongPressStart(uid)}
          onMouseUp={handleLongPressEnd}
          onMouseLeave={handleLongPressEnd}
          onClick={() => {
            if (longPressFired.current) {
              // The click that follows the long-press's own touch release.
              longPressFired.current = false;
              return;
            }
            if (selectMode) toggleSelect(uid);
            else setExpandedId(isExpanded ? null : uid);
          }}
        >
          {/* The rank gutter. Only populated once the list is sorted by score —
              an unsorted list has no rank and a number there would be a lie. */}
          <span className="dop-rank">{sorted ? index + 1 : ''}</span>

          <span className="dop-row__main">
            <span className="dop-row__name">{getParticipantName(p)}</span>
            <span className="dop-row__meta">
              {metaParts.length > 0 ? metaParts.join(' · ') : ' '}
            </span>
          </span>

          <span className="dop-row__end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openMarksSheet(p);
              }}
              className={[
                'dop-btn',
                'dop-btn--sm',
                currentScore != null ? 'dop-btn--accent' : '',
              ].join(' ')}
              aria-label={`${currentScore != null ? 'Change' : 'Enter'} marks for ${getParticipantName(p)}`}
            >
              {currentScore != null ? (
                <span className="dop-num" style={{ color: 'inherit' }}>
                  {currentScore}
                </span>
              ) : isCheckedOut ? (
                <>
                  <Ban size={13} aria-hidden="true" />
                  Checked out
                </>
              ) : (
                'Enter marks'
              )}
            </button>
            {!selectMode ? (
              isExpanded ? (
                <ChevronUp size={16} aria-hidden="true" />
              ) : (
                <ChevronDown size={16} aria-hidden="true" />
              )
            ) : null}
          </span>
        </div>

        {isExpanded && !selectMode ? (
          <div className="dop-detail">
            {/*
              Which message this participant reads when they advance. Not on the
              final round: there is nothing to advance into, so the question
              there is placement, handled below.
            */}
            {!isFinalRound && !finalised ? (
              <div>
                <p className="dop-detail__label">Advancement message</p>
                <div className="dop-chipwrap">
                  {ADVANCEMENT_TIERS.map((tier) => {
                    const chosen = (tierByParticipant[uid] ?? 'strong') === tier.key;
                    return (
                      <button
                        key={tier.key}
                        type="button"
                        aria-pressed={chosen}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          setTierByParticipant((previous) => ({ ...previous, [uid]: tier.key }));
                        }}
                        className={[
                          'dop-chip',
                          'dop-chip--inline',
                          chosen ? 'dop-chip--on' : '',
                        ].join(' ')}
                      >
                        {tier.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/*
              Placement, on the FINAL round only. There is no next round to push
              anyone into, so the question stops being "who continues" and
              becomes "who won" — and the placement a coordinator assigns here
              overrides the score ranking when they finalise.
            */}
            {isFinalRound && !finalised ? (
              <div>
                <p className="dop-detail__label">Placement</p>
                <div className="dop-chipwrap">
                  {[1, 2, 3].map((place) => {
                    const heldByThisRow = placementOf(uid) === place;
                    /* Taken by SOMEBODY ELSE — shown, but not offered, so the
                       coordinator can see where the place went. */
                    const heldByOther = podium[place] && podium[place] !== uid;
                    return (
                      <button
                        key={place}
                        type="button"
                        disabled={Boolean(heldByOther)}
                        aria-pressed={heldByThisRow}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          assignPlacement(uid, place);
                        }}
                        className={[
                          'dop-chip',
                          'dop-chip--inline',
                          heldByThisRow ? 'dop-chip--on' : '',
                        ].join(' ')}
                      >
                        {PLACEMENT_LABEL[place]}
                        {heldByOther ? ' · taken' : ''}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={(clickEvent) => {
                      clickEvent.stopPropagation();
                      setSelectedIds(new Set([uid]));
                      setShowConfirm('eliminate');
                    }}
                    className="dop-btn dop-btn--sm"
                    style={{ color: 'var(--primary)' }}
                  >
                    <UserMinus size={14} aria-hidden="true" />
                    Eliminate
                  </button>
                </div>
              </div>
            ) : null}

            {isTeamEvent ? (
              <div>
                <p className="dop-detail__label">Team members</p>
                <ul className="dop-detail__members">
                  {getTeamMembers(p).map((m, mi) => (
                    <li key={m.id ?? m.userId ?? mi} className="dop-detail__member">
                      <span>
                        {m.fullName || m.name}
                        {/* The leader anchors the team's single score, so they
                            are worth marking rather than hidden in the list. */}
                        {m.isLeader ? ' · leader' : ''}
                      </span>
                      <span className="dop-detail__college">
                        {m.collegeName || m.college?.collegeName || ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>
                <p className="dop-detail__label">College</p>
                <p className="dop-note dop-note--ink">
                  {[getParticipantCollege(p), p.city].filter(Boolean).join(' · ') || 'Not given'}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="dop-screen">
        <ScreenHeader title="Scoreboard" />
        <div className="dop-page">
          <span className="dop-sk dop-sk--row" />
          <div className="dop-skstack">
            <span className="dop-sk dop-sk--row" />
            <span className="dop-sk dop-sk--row" />
            <span className="dop-sk dop-sk--row" />
            <span className="dop-sk dop-sk--row" />
          </div>
        </div>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="dop-screen">
        <ScreenHeader title="Scoreboard" />
        <div className="dop-page">
          <div className="dop-retry">
            <p className="dop-retry__text">Could not load the scoreboard.</p>
            <button type="button" className="dop-btn" onClick={loadData}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const unscoredRows = sortedParticipants.filter(
    (p) => scores.current?.[getParticipantId(p)] == null,
  );
  const scoredRows = sortedParticipants.filter(
    (p) => scores.current?.[getParticipantId(p)] != null,
  );
  const splitByScored = !sorted && scoredCount > 0 && scoredCount < participants.length;

  return (
    <div className="dop-screen">
      <ScreenHeader title="Scoreboard" />

      <div className="dop-page">
        {failure ? (
          <p className="dop-alert" role="alert">
            {failure}
          </p>
        ) : null}
        {!isOnline ? (
          <p className="dop-offline" role="status">
            You are offline, so scoring, advancing and finalising are turned off until the
            connection is back.
          </p>
        ) : null}

        {/*
         * Round selector. Each round carries its status IN WORDS so a
         * coordinator can see which rounds have actually started instead of
         * inferring it from a fill colour.
         */}
        <div className="dop-strip">
          {rounds.map((r, i) => {
            const isActive = !showResults && activeRoundIdx === i;
            return (
              <button
                key={r.id || r._id}
                type="button"
                onClick={() => handleTabClick(i)}
                aria-pressed={isActive}
                className={['dop-chip', isActive ? 'dop-chip--on' : ''].join(' ')}
              >
                Round {r.roundNumber}
                <span className="dop-chip__meta">{roundStateWord(r.status ?? 'draft')}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleResultsTab}
            aria-pressed={showResults}
            className={['dop-chip', showResults ? 'dop-chip--on' : ''].join(' ')}
          >
            Results
            <span className="dop-chip__meta">{finalised ? 'Finalised' : 'Provisional'}</span>
          </button>
        </div>

        <div className="dop-section__head">
          <h2 className="dop-section__title">
            {showResults
              ? 'Final results'
              : activeRound?.roundName || `Round ${activeRound?.roundNumber}`}
          </h2>
          <span className="dop-section__meta">
            {showResults
              ? 'All rounds counted'
              : `${scoredCount} of ${participants.length} scored`}
          </span>
        </div>

        {/* ── Results ─────────────────────────────────────────── */}
        {showResults ? (
          <>
            {winners.length === 0 ? (
              <EmptyState line="Nobody has been scored yet, so there is no result to show." />
            ) : (
              <div className="dop-table">
                {winners.map((w, i) => (
                  <div key={getParticipantId(w)} className="dop-row">
                    <span className="dop-rank">{i + 1}</span>
                    <span className="dop-row__main">
                      <span className="dop-row__name">{getParticipantName(w)}</span>
                      <span className="dop-row__meta">
                        {[PLACEMENT_LABEL[i + 1], getParticipantCollege(w)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="dop-row__end">
                      <span className="dop-num">{w.total}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/*
             * Nothing is automatic here: certificates read awarded placements,
             * and those rows only exist once someone awards them. The old
             * "sent automatically" note promised a step that never ran.
             */}
            {finalised ? (
              <p className="dop-state dop-state--done">
                <Lock size={14} aria-hidden="true" />
                Finalised. Scores are locked.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setShowConfirm('finalise')}
                disabled={awarding || winners.length === 0 || !isOnline}
                className="dop-btn dop-btn--block dop-btn--primary"
              >
                {awarding ? 'Finalising…' : 'Finalise the results'}
              </button>
            )}
          </>
        ) : (
          <>
            {/* Editing a finished round is allowed, but the scores are already
                out — say so rather than letting a correction feel private. */}
            {activeRound?.status === 'completed' ? (
              <p className="dop-note">
                This round is done. Scores can still be corrected until you finalise the
                results.
              </p>
            ) : null}

            {allScored && !sorted && !selectMode ? (
              <button type="button" onClick={handleRearrange} className="dop-btn dop-btn--block">
                <ArrowUpDown size={16} aria-hidden="true" />
                Rank by score
              </button>
            ) : null}

            {sorted ? <p className="dop-note">Ranked by total score, highest first.</p> : null}

            {participants.length === 0 ? (
              /*
               * An empty roster is the normal state before the doors open, not
               * a failure — round 1 fills from entry scans as people arrive.
               */
              <EmptyState
                line={
                  activeRound?.roundNumber === 1
                    ? 'Nobody has checked in yet. This list fills as participants are scanned in at the event entry.'
                    : `Nobody has advanced here yet. Score round ${(activeRound?.roundNumber ?? 2) - 1} and push participants forward to fill this round.`
                }
                actionLabel={activeRound?.roundNumber === 1 ? 'Check again' : undefined}
                onAction={
                  activeRound?.roundNumber === 1
                    ? () => loadRoundParticipants(activeRound, rounds)
                    : undefined
                }
              />
            ) : (
              <div className="dop-table">
                {splitByScored ? (
                  <>
                    {unscoredRows.map((p, i) => renderRow(p, i))}
                    <div className="dop-divide">
                      <Check size={12} aria-hidden="true" />
                      Already scored
                    </div>
                    {scoredRows.map((p, i) => renderRow(p, unscoredRows.length + i))}
                  </>
                ) : (
                  sortedParticipants.map((p, i) => renderRow(p, i))
                )}
              </div>
            )}

            {activeRound?.roundNumber === 1 && participants.length > 0 ? (
              <button
                type="button"
                onClick={() => loadRoundParticipants(activeRound, rounds)}
                className="dop-btn"
                style={{ alignSelf: 'flex-start' }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Check for new arrivals
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* Bottom command bar */}
      {!showResults && participants.length > 0 ? (
        <div className="dop-bar">
          <div className="dop-bar__inner">
            {selectMode ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowConfirm('eliminate')}
                  disabled={!isOnline}
                  className="dop-btn dop-btn--block dop-btn--primary"
                >
                  <UserMinus size={16} aria-hidden="true" />
                  Eliminate {selectedIds.size} and push the rest on
                </button>
                <p className="dop-note">
                  {selectedIds.size} eliminated, {participants.length - selectedIds.size} move to
                  round {(activeRound?.roundNumber || 0) + 1}.
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowConfirm('pushAll')}
                disabled={!isOnline}
                className="dop-btn dop-btn--block dop-btn--accent"
              >
                {isFinalRound ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <ArrowRight size={16} aria-hidden="true" />
                )}
                {isFinalRound ? 'Complete the final round' : 'Push everyone to the next round'}
              </button>
            )}
          </div>
        </div>
      ) : null}

      {/* Marks entry */}
      <BottomSheet
        isOpen={Boolean(showMarksSheet)}
        onClose={() => (savingScore ? undefined : setShowMarksSheet(null))}
        title={showMarksSheet ? `Marks for ${getParticipantName(showMarksSheet)}` : 'Enter marks'}
      >
        <div className="dop-sheet">
          <label className="dop-field">
            <span className="dop-field__label">Score for this round</span>
            <input
              type="number"
              inputMode="decimal"
              className="dop-input dop-input--num"
              style={{ width: '100%' }}
              value={marksValue}
              onChange={(e) => setMarksValue(e.target.value)}
              autoFocus
            />
          </label>
          <button
            type="button"
            onClick={handleSaveScore}
            disabled={savingScore || !isOnline}
            className="dop-btn dop-btn--block dop-btn--accent"
          >
            {savingScore ? 'Saving…' : 'Save the score'}
          </button>
        </div>
      </BottomSheet>

      {/* The three irreversible confirmations */}
      <BottomSheet
        isOpen={Boolean(showConfirm)}
        onClose={() => (processing || awarding ? undefined : setShowConfirm(null))}
        title={
          showConfirm === 'finalise'
            ? 'Finalise the results?'
            : showConfirm === 'pushAll'
              ? `Push everyone to round ${(activeRound?.roundNumber || 0) + 1}?`
              : 'Eliminate and push the rest on?'
        }
      >
        <div className="dop-sheet">
          <p className="dop-sheet__body">
            {showConfirm === 'finalise'
              ? 'The final results go to the admin, and the winners are marked in the winner certificate slot.'
              : showConfirm === 'pushAll'
                ? `All ${participants.length} participants advance. Nobody is eliminated.${
                    isFinalRound ? '' : ' Everyone is emailed.'
                  }`
                : `${selectedIds.size} participants are eliminated and receive participation certificates. ${
                    participants.length - selectedIds.size
                  } advance.${isFinalRound ? '' : ' Everyone is emailed.'}`}
          </p>
          {showConfirm === 'finalise' ? (
            <p className="dop-sheet__body">Scores are locked afterwards and cannot be edited.</p>
          ) : isFinalRound ? (
            /* The promise of an email must not appear where none is sent —
               after the last round the result reaches people via the admin. */
            <p className="dop-note">No emails are sent for the final round.</p>
          ) : null}
          <div className="dop-actions">
            <button type="button" className="dop-btn" onClick={() => setShowConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="dop-btn dop-btn--primary"
              onClick={
                showConfirm === 'finalise'
                  ? handleFinalise
                  : showConfirm === 'pushAll'
                    ? handlePushAll
                    : handleEliminateAndPush
              }
              disabled={processing || awarding || !isOnline}
            >
              {showConfirm === 'finalise'
                ? awarding
                  ? 'Finalising…'
                  : 'Yes, finalise'
                : processing
                  ? 'Working…'
                  : showConfirm === 'pushAll'
                    ? 'Yes, push everyone'
                    : 'Yes, eliminate'}
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export default ScoreboardScreen;
