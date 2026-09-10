const mongoose = require("mongoose");

const { RoundModel, ROUND_STATUSES } = require("../models/round-model");
const { sendMailQuietly } = require("./email-service");
const { buildBrandedEmailBodies } = require("../helpers/email-template");
const { RoundScoreModel } = require("../models/round-score-model");
const {
  selectPlacementTemplate,
  buildRoundCopyContext,
} = require("../helpers/round-notification-copy");
const {
  ROUND_NOTIFICATION_TEMPLATES,
  selectAdvancementTemplate,
} = require("../constants/round-notification-templates");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { TeamModel } = require("../models/team-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ScanModel } = require("../models/scan-model");
const { PassModel } = require("../models/pass-model");
const { UserModel } = require("../models/user-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { CHECKPOINT_TYPES, SCAN_RESULTS, SCAN_DIRECTIONS } = require("../constants/scan-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { recordAuditLog } = require("./audit-log-service");

/*
 * The coordinator's multi-round judging flow: create rounds, score the people in
 * them, and shortlist survivors into the next one.
 *
 * Authorisation happens at the ROUTE (coordinator-or-admin, scoped to the events
 * the caller covers), exactly like the roster and match endpoints — this service
 * assumes a cleared caller and does not re-derive authority.
 */

async function loadEventOrThrow(eventId) {
  const event = mongoose.Types.ObjectId.isValid(eventId)
    /* resultsFinalisedAt is read by the score guard — omitting it here would
     * silently disable the lock, since undefined is falsy. */
    ? await EventModel.findById(eventId).select("_id festId eventName eventType resultsFinalisedAt").lean()
    : null;
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return event;
}

async function loadRoundOrThrow(eventId, roundId) {
  const round = mongoose.Types.ObjectId.isValid(roundId)
    ? await RoundModel.findOne({ _id: roundId, eventId })
    : null;
  if (!round) {
    throw new ApplicationError(404, ERROR_CODES.ROUND_NOT_FOUND, "Round not found.");
  }
  return round;
}

function assertRoundEditable(round) {
  if (round.status === ROUND_STATUSES.COMPLETED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.ROUND_ALREADY_COMPLETED,
      "This round is completed and can no longer be changed."
    );
  }
}

/*
 * Round 1's roster is who ACTUALLY TURNED UP, not who registered: the distinct
 * holders of an accepted IN scan at this event's own door. A no-show should not
 * occupy a judging slot.
 */
async function resolveCheckedInParticipantIds(event) {
  const entryCheckpoints = await CheckpointModel.find({
    eventId: event._id,
    checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
  })
    .select("_id")
    .lean();
  if (entryCheckpoints.length === 0) {
    return [];
  }
  const scans = await ScanModel.find({
    checkpointId: { $in: entryCheckpoints.map((checkpoint) => checkpoint._id) },
    result: SCAN_RESULTS.ACCEPTED,
    direction: SCAN_DIRECTIONS.IN,
  })
    .select("passId")
    .lean();
  const passIds = [...new Set(scans.map((scan) => String(scan.passId)).filter(Boolean))];
  if (passIds.length === 0) {
    return [];
  }
  const passes = await PassModel.find({ _id: { $in: passIds } })
    .select("userId")
    .lean();
  return [...new Set(passes.map((pass) => String(pass.userId)))].map(
    (userId) => new mongoose.Types.ObjectId(userId)
  );
}

async function createRound(actorUserId, eventId, payload = {}, context = {}) {
  const event = await loadEventOrThrow(eventId);
  const lastRound = await RoundModel.findOne({ eventId: event._id })
    .sort({ roundNumber: -1 })
    .select("roundNumber")
    .lean();
  const nextNumber = (lastRound?.roundNumber ?? 0) + 1;

  /*
   * The form lets a coordinator insert at a position rather than always
   * appending — "this new round is really round 2". Honour that by shifting
   * everything from that position down, which keeps roundNumber contiguous and
   * the unique (eventId, roundNumber) index satisfied.
   *
   * Descending order matters: shifting 2->3 before 3->4 would collide on the
   * index mid-loop.
   */
  const requested = Number(payload.roundNumber);
  const roundNumber =
    Number.isInteger(requested) && requested >= 1 && requested <= nextNumber
      ? requested
      : nextNumber;

  if (roundNumber < nextNumber) {
    const toShift = await RoundModel.find({
      eventId: event._id,
      roundNumber: { $gte: roundNumber },
    })
      .sort({ roundNumber: -1 })
      .select("_id roundNumber");
    for (const existing of toShift) {
      await RoundModel.updateOne(
        { _id: existing._id },
        { $set: { roundNumber: existing.roundNumber + 1 } }
      );
    }
  }

  /*
   * Round 1 is seeded from the door; every later round starts EMPTY and is
   * filled by advancing people out of the round before it. Seeding round 3 from
   * the door would silently resurrect everyone already eliminated.
   */
  const participantIds = roundNumber === 1 ? await resolveCheckedInParticipantIds(event) : [];

  const round = await RoundModel.create({
    eventId: event._id,
    festId: event.festId,
    roundNumber,
    roundName: payload.roundName ?? null,
    description: payload.description ?? null,
    rules: payload.rules ?? null,
    participantIds,
    createdByUserId: actorUserId,
  });

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_CREATED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { roundId: String(round._id), roundNumber, seededParticipantCount: participantIds.length },
    ...context,
  });
  return round.toJSON();
}

async function listRounds(eventId) {
  const event = await loadEventOrThrow(eventId);

  /*
   * Refresh round 1 before counting, or the list shows "0 participants" for a
   * round the detail view would immediately populate — two screens disagreeing
   * about the same round reads as a bug.
   */
  const firstRound = await RoundModel.findOne({ eventId: event._id, roundNumber: 1 });
  if (firstRound) {
    await refreshFirstRoundRoster(event, firstRound);
  }

  const rounds = await RoundModel.find({ eventId: event._id }).sort({ roundNumber: 1 }).lean();
  return {
    rounds: rounds.map((round) => ({
      ...round,
      id: String(round._id),
      participantCount: (round.participantIds ?? []).length,
      hasDocument: Boolean(round.documentUrl),
    })),
  };
}

/*
 * Round 1's roster is a LIVE view of the door, not a snapshot taken at creation.
 *
 * Seeding once at create time assumed rounds were made after check-in had
 * started. In practice a coordinator sets the rounds up days ahead, when nobody
 * has scanned in — so round 1 was created empty and stayed empty, and the
 * scoreboard looked broken on the day.
 *
 * So: every time round 1 is read, anyone who has since scanned IN is folded in.
 * Merge, never replace — a manual addition or an early scan is never dropped.
 *
 * Two rounds are deliberately left alone:
 *   - COMPLETED round 1: the result is history. A late scan must not rewrite a
 *     round that has already been scored and advanced out of.
 *   - Rounds 2+: filled only by advancing. Re-seeding these from the door would
 *     silently resurrect everyone already eliminated.
 */
/*
 * Who is INSIDE the event right now.
 *
 * A pass can cross the door many times, so presence is not "has a scan" — it is
 * the DIRECTION OF THE MOST RECENT scan. Sorting by scannedAt descending and
 * keeping the first row per pass gives that in one pass; the
 * (passId, scannedAt) index already exists for it.
 *
 * Used to gate mark entry: a coordinator can only score someone the door says
 * is present. Deliberately NOT used to build the roster — someone who competed
 * and then left must stay on the sheet with their score intact.
 */
async function resolvePresentParticipantIds(event) {
  const entryCheckpoints = await CheckpointModel.find({
    eventId: event._id,
    checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
  })
    .select("_id")
    .lean();
  if (entryCheckpoints.length === 0) {
    /*
     * No entry checkpoint = no door = no presence gate. Null means "the gate
     * does not apply", distinct from an empty Set which means "a door exists
     * and nobody has come through it". Returning an empty Set here made EVERY
     * score save reject as "not checked in" on events that never configured a
     * checkpoint — the gate demanded a scan through a door that doesn't exist.
     */
    return null;
  }

  const latestPerPass = await ScanModel.aggregate([
    {
      $match: {
        checkpointId: { $in: entryCheckpoints.map((c) => c._id) },
        result: SCAN_RESULTS.ACCEPTED,
      },
    },
    { $sort: { scannedAt: -1 } },
    { $group: { _id: "$passId", direction: { $first: "$direction" } } },
    { $match: { direction: SCAN_DIRECTIONS.IN } },
  ]);
  if (latestPerPass.length === 0) {
    return new Set();
  }

  const passes = await PassModel.find({ _id: { $in: latestPerPass.map((r) => r._id) } })
    .select("userId")
    .lean();
  return new Set(passes.map((p) => String(p.userId)));
}

async function refreshFirstRoundRoster(event, round) {
  if (
    round.roundNumber !== 1 ||
    round.rosterFinalised ||
    round.status === ROUND_STATUSES.COMPLETED
  ) {
    return round;
  }

  const checkedInIds = await resolveCheckedInParticipantIds(event);
  if (checkedInIds.length === 0) {
    return round;
  }

  const existing = new Set((round.participantIds ?? []).map(String));
  const additions = checkedInIds.filter((id) => !existing.has(String(id)));
  if (additions.length === 0) {
    return round;
  }

  const updated = await RoundModel.findOneAndUpdate(
    { _id: round._id },
    { $addToSet: { participantIds: { $each: additions } } },
    { new: true }
  );
  return updated ?? round;
}

/* One round with its people and their scores, ready for the scoring table. */
async function getRoundDetail(eventId, roundId) {
  const event = await loadEventOrThrow(eventId);
  let round = await loadRoundOrThrow(event._id, roundId);
  round = await refreshFirstRoundRoster(event, round);

  const participants = await UserModel.find({ _id: { $in: round.participantIds } })
    .select("fullName usn collegeId")
    .populate({ path: "collegeId", select: "commonName", model: "College" })
    .lean();
  const scores = await RoundScoreModel.find({ roundId: round._id }).lean();
  const scoreByUserId = new Map(scores.map((row) => [String(row.participantUserId), row]));
  const presentIds = await resolvePresentParticipantIds(event);

  const toRow = (participant) => ({
    participantUserId: String(participant._id),
    fullName: participant.fullName ?? null,
    usn: participant.usn ?? null,
    collegeName: participant.collegeId?.commonName ?? null,
    /* Gates mark entry in the UI; enforced server-side in saveRoundScores.
     * null presentIds = no entry checkpoint, so nobody can be "absent". */
    isPresent: presentIds === null ? true : presentIds.has(String(participant._id)),
    score: scoreByUserId.get(String(participant._id))?.score ?? null,
    notes: scoreByUserId.get(String(participant._id))?.notes ?? null,
  });

  /*
   * A SOLO event scores people; a TEAM event scores teams. Returning the raw
   * user list for both put four rows on the sheet for one four-person team and
   * invited four different marks for a single performance.
   *
   * So for a team event the rows are collapsed to one per team, carrying the
   * team name and its members. The row still needs a participantUserId because
   * every score, advance and elimination downstream is keyed by user — the
   * LEADER stands for the team, which is also who the team's single score is
   * recorded against.
   *
   * Anyone registered without a team falls through as their own row rather than
   * disappearing: a half-formed team is a data problem to see, not to hide.
   */
  if (event.eventType !== "team") {
    return { round: round.toJSON(), participants: participants.map(toRow) };
  }

  const byUserId = new Map(participants.map((p) => [String(p._id), p]));

  const registrations = await RegistrationModel.find({
    eventId: event._id,
    userId: { $in: round.participantIds },
    teamId: { $ne: null },
  })
    .select("userId teamId")
    .lean();

  const teamIdByUserId = new Map(registrations.map((r) => [String(r.userId), String(r.teamId)]));
  const teamIds = [...new Set(registrations.map((r) => String(r.teamId)))];

  const teams = teamIds.length
    ? await TeamModel.find({ _id: { $in: teamIds } })
        .select("teamName leaderUserId memberUserIds")
        .lean()
    : [];

  const rows = [];
  const claimed = new Set();

  for (const team of teams) {
    /* Only members actually in THIS round — a team half-eliminated in an
     * earlier round must not reappear whole. */
    const memberIds = (team.memberUserIds ?? [])
      .map(String)
      .filter((id) => byUserId.has(id));
    if (memberIds.length === 0) continue;

    const leaderId = String(team.leaderUserId);
    const anchorId = memberIds.includes(leaderId) ? leaderId : memberIds[0];
    const anchor = byUserId.get(anchorId);

    memberIds.forEach((id) => claimed.add(id));

    rows.push({
      ...toRow(anchor),
      isTeam: true,
      teamId: String(team._id),
      teamName: team.teamName,
      /* Present if ANY member is through the door: a team performs together,
       * and one member stepping out must not block the team's mark. */
      /* presentIds === null means the event has no entry checkpoint, so nobody
       * can be "absent" — matching toRow. Calling .has() on null threw here. */
      isPresent: presentIds === null ? true : memberIds.some((id) => presentIds.has(id)),
      members: memberIds.map((id) => {
        const m = byUserId.get(id);
        return {
          participantUserId: id,
          fullName: m.fullName ?? null,
          usn: m.usn ?? null,
          collegeName: m.collegeId?.commonName ?? null,
          isLeader: id === leaderId,
        };
      }),
    });
  }

  /* Registered for a team event but on no team — surfaced, not dropped. */
  for (const participant of participants) {
    const id = String(participant._id);
    if (!claimed.has(id) && !teamIdByUserId.has(id)) {
      rows.push({ ...toRow(participant), isTeam: false, members: [] });
    }
  }

  return { round: round.toJSON(), participants: rows };
}

/*
 * Every mutation goes through this: the update filter carries the version the
 * caller last saw, so a second coordinator working from stale data is refused
 * rather than silently overwriting the first one's work.
 */
async function applyVersionedUpdate(round, expectedVersion, updateDocument) {
  const updated = await RoundModel.findOneAndUpdate(
    { _id: round._id, version: expectedVersion },
    { ...updateDocument, $inc: { version: 1 } },
    { new: true }
  );
  if (!updated) {
    throw new ApplicationError(
      409,
      ERROR_CODES.ROUND_CONCURRENT_UPDATE,
      "This round was updated by another coordinator. Reload and try again.",
      { currentVersion: round.version }
    );
  }
  return updated;
}

async function updateRound(actorUserId, eventId, roundId, payload, context = {}) {
  const event = await loadEventOrThrow(eventId);
  const round = await loadRoundOrThrow(event._id, roundId);

  const changes = {};
  if (payload.roundName !== undefined) {
    changes.roundName = payload.roundName;
  }
  if (payload.status !== undefined) {
    changes.status = payload.status;
  }
  /* Same omission as create: the edit form sends these and they were dropped. */
  if (payload.description !== undefined) {
    changes.description = payload.description;
  }
  if (payload.rules !== undefined) {
    changes.rules = payload.rules;
  }
  const updated = await applyVersionedUpdate(round, payload.expectedVersion, { $set: changes });

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    beforeState: { status: round.status, roundName: round.roundName },
    afterState: { roundId: String(round._id), ...changes },
    ...context,
  });
  return updated.toJSON();
}

/*
 * Shortlisting: move the named people into the NEXT round, creating it if it
 * does not exist yet. $addToSet, so advancing the same person twice (a
 * double-tap, a retried request) cannot duplicate them.
 */
/*
 * For a team event, a single advancing id stands for a whole team (the anchor
 * row on the scoresheet). Resolve each id to its team and return every member,
 * so the next round's roster holds complete teams rather than lone captains.
 * Solo events, and team-event entrants on no team, pass straight through.
 */
async function expandToTeamMembers(event, userIds) {
  if (event.eventType !== "team" || userIds.length === 0) {
    return userIds;
  }
  const registrations = await RegistrationModel.find({
    eventId: event._id,
    userId: { $in: userIds },
    teamId: { $ne: null },
  })
    .select("teamId")
    .lean();
  const teamIds = [...new Set(registrations.map((row) => String(row.teamId)))];
  if (teamIds.length === 0) {
    return userIds;
  }
  const teams = await TeamModel.find({ _id: { $in: teamIds } })
    .select("memberUserIds")
    .lean();

  const expanded = new Map(userIds.map((id) => [String(id), id]));
  for (const team of teams) {
    for (const memberId of team.memberUserIds ?? []) {
      expanded.set(String(memberId), new mongoose.Types.ObjectId(String(memberId)));
    }
  }
  return [...expanded.values()];
}

async function advanceParticipants(actorUserId, eventId, roundId, participantUserIds, context = {}) {
  const event = await loadEventOrThrow(eventId);
  const round = await loadRoundOrThrow(event._id, roundId);

  const requestedIds = (participantUserIds ?? [])
    .filter((userId) => mongoose.Types.ObjectId.isValid(userId))
    .map((userId) => new mongoose.Types.ObjectId(userId));
  if (requestedIds.length === 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Name at least one participant.", {
      participantUserIds: "is required",
    });
  }

  /*
   * A team event's scoresheet shows ONE row per team, anchored on the leader
   * (see getRoundDetail), so the client advances that single anchor id. Carrying
   * only that id forward left the next round holding just the captain: the team
   * lookup filters members to those in round.participantIds, so every other
   * member vanished from round 2 onward. Expand each anchor to its whole team
   * so the roster that arrives is the team that actually competes.
   */
  const advancingIds = await expandToTeamMembers(event, requestedIds);

  /*
   * The next round must already exist. Auto-creating it here meant "Push All to
   * Next Round" on the final round manufactured round N+1 forever — an endless
   * ladder no coordinator planned, and phantom draft rounds appearing on the
   * scoreboard before anyone started them. Rounds are planned deliberately on
   * the Create Rounds screen; advancing only moves people into one of those.
   */
  const nextRound = await RoundModel.findOne({
    eventId: event._id,
    roundNumber: round.roundNumber + 1,
  });
  if (!nextRound) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "There is no next round to advance into. Create the next round first, or finalise results if this was the last round.",
      { roundNumber: `no round ${round.roundNumber + 1} exists for this event` }
    );
  }

  const updated = await RoundModel.findOneAndUpdate(
    { _id: nextRound._id },
    { $addToSet: { participantIds: { $each: advancingIds } }, $inc: { version: 1 } },
    { new: true }
  );

  /* Advancing a subset is itself a cut: those left behind must not be
   * re-added from the door on the next read. */
  if (!round.rosterFinalised) {
    await RoundModel.updateOne({ _id: round._id }, { $set: { rosterFinalised: true } });
  }

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_PARTICIPANTS_ADVANCED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: {
      fromRoundNumber: round.roundNumber,
      toRoundNumber: updated.roundNumber,
      advancedCount: advancingIds.length,
    },
    ...context,
  });
  return updated.toJSON();
}

/*
 * The undo half of advancing. Refused on a COMPLETED round: once results are
 * locked, removing someone would rewrite a decided outcome.
 */
async function retractParticipants(actorUserId, eventId, roundId, participantUserIds, context = {}) {
  const event = await loadEventOrThrow(eventId);
  const round = await loadRoundOrThrow(event._id, roundId);
  assertRoundEditable(round);

  const retractingIds = (participantUserIds ?? [])
    .filter((userId) => mongoose.Types.ObjectId.isValid(userId))
    .map((userId) => new mongoose.Types.ObjectId(userId));
  if (retractingIds.length === 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Name at least one participant.", {
      participantUserIds: "is required",
    });
  }

  const updated = await RoundModel.findOneAndUpdate(
    { _id: round._id },
    { $pull: { participantIds: { $in: retractingIds } }, $inc: { version: 1 } },
    { new: true }
  );

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_PARTICIPANTS_RETRACTED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { roundNumber: round.roundNumber, retractedCount: retractingIds.length },
    ...context,
  });
  return updated.toJSON();
}

/* Bulk upsert, one row per (round, participant) — the unique index is the key. */
async function saveRoundScores(actorUserId, eventId, roundId, entries, context = {}) {
  const event = await loadEventOrThrow(eventId);
  const round = await loadRoundOrThrow(event._id, roundId);

  /*
   * Scores stay editable after the round completes and after people have been
   * advanced out of it. A transcription error found an hour later is a normal
   * thing, and locking the sheet the moment the round closes turns a two-second
   * correction into a support request. Every write is audited, so a late edit is
   * traceable rather than invisible.
   *
   * Note this deliberately diverges from retract and document-upload, which do
   * stay locked: those change who competed, not what they scored.
   */

  /*
   * Anti-malpractice: while a round is LIVE, marks can only be entered for
   * someone the door says is present — that is the whole point of the gate.
   *
   * Once the round is COMPLETED the gate lifts, because by then everyone has
   * gone home and no one would ever be "present" again. Keeping it on would not
   * add safety; it would just make corrections impossible. The risk profile is
   * different too: a completed round's scores are already published to the
   * scoreboard, so a silent change is visible rather than hidden.
   *
   * Rejects loudly rather than skipping silently: a coordinator who scores four
   * people and sees "saved" must not discover later that one never landed.
   */
  /*
   * The lock is FINALISE, not the end of a round. A coordinator who spots a
   * transcription error two rounds later can still fix it right up to the
   * moment results go to the Admin; after that the sheet is a record.
   */
  if (event.resultsFinalisedAt) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "Results are finalised. Scores can no longer be changed."
    );
  }

  if (round.status !== ROUND_STATUSES.COMPLETED) {
    const presentIds = await resolvePresentParticipantIds(event);
    /* null = the event has no entry checkpoint, so the gate cannot apply. */
    const absent = presentIds === null ? [] : (entries ?? [])
      .filter((e) => mongoose.Types.ObjectId.isValid(e?.participantUserId))
      .filter((e) => !presentIds.has(String(e.participantUserId)));
    if (absent.length > 0) {
      throw new ApplicationError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        absent.length === 1
          ? "That participant is not checked in. They must scan in at the event entry before marks can be recorded."
          : `${absent.length} of these participants are not checked in. They must scan in at the event entry before marks can be recorded.`,
        { participantUserIds: absent.map((e) => String(e.participantUserId)) }
      );
    }
  }

  const scoredAt = new Date();
  let savedCount = 0;
  for (const entry of entries ?? []) {
    if (!mongoose.Types.ObjectId.isValid(entry.participantUserId)) {
      continue;
    }
    await RoundScoreModel.updateOne(
      { roundId: round._id, participantUserId: entry.participantUserId },
      {
        $set: {
          eventId: event._id,
          score: entry.score === undefined || entry.score === null ? null : Number(entry.score),
          notes: entry.notes ?? null,
          scoredByUserId: actorUserId,
          scoredAt,
        },
      },
      { upsert: true }
    );
    savedCount += 1;
  }

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_SCORES_SAVED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { roundId: String(round._id), roundNumber: round.roundNumber, savedCount },
    ...context,
  });
  return { savedCount };
}

/*
 * THE ADMIN RESULT BOARD, in one read.
 *
 * The coordinator's screens ask about ONE round at a time, which is the right
 * shape for judging but the wrong shape for reading a result: the admin's
 * question is "who won", and answering it from getRoundDetail meant one request
 * per round plus a cross-reference in the client. So this returns the whole
 * matrix — every round as a column, every participant as a row, each cell the
 * mark the COORDINATOR entered — plus the row total the board ranks on.
 *
 * Rows are shaped by the same rule getRoundDetail uses, and for the same
 * reason: a SOLO event scores people, a TEAM event scores teams, and a team's
 * single mark is recorded against its leader (the "anchor"). Reusing that rule
 * rather than restating it is what keeps this board agreeing with the sheet the
 * coordinator actually typed into.
 *
 * The roster is the UNION of every round's participants, not round 1's alone:
 * someone eliminated after round 1 still competed and still has a mark, and a
 * board that dropped them would be quietly rewriting the event's history.
 */
async function getRoundScoreboard(eventId) {
  const event = await loadEventOrThrow(eventId);

  const firstRound = await RoundModel.findOne({ eventId: event._id, roundNumber: 1 });
  if (firstRound) {
    await refreshFirstRoundRoster(event, firstRound);
  }

  const rounds = await RoundModel.find({ eventId: event._id }).sort({ roundNumber: 1 }).lean();

  const eventPayload = {
    id: String(event._id),
    eventName: event.eventName,
    eventType: event.eventType,
    resultsFinalisedAt: event.resultsFinalisedAt ?? null,
  };

  if (rounds.length === 0) {
    return { event: eventPayload, rounds: [], rows: [] };
  }

  const roundIds = rounds.map((round) => round._id);
  const scores = await RoundScoreModel.find({ roundId: { $in: roundIds } }).lean();

  // "<roundId>:<participantUserId>" -> the score row. One flat map so a cell
  // lookup is O(1) and the loop below stays linear in rounds x participants.
  const scoreByCell = new Map(
    scores.map((row) => [`${String(row.roundId)}:${String(row.participantUserId)}`, row])
  );

  const participantIds = [
    ...new Set(rounds.flatMap((round) => (round.participantIds ?? []).map(String))),
  ];
  const participants = await UserModel.find({ _id: { $in: participantIds } })
    .select("fullName usn participantId collegeId emailAddress")
    .populate({ path: "collegeId", select: "commonName", model: "College" })
    .lean();
  const userById = new Map(participants.map((user) => [String(user._id), user]));

  /*
   * Which rounds a participant was actually IN. An empty cell in a round they
   * never reached is a different fact from an unscored cell in one they did, and
   * the board draws the two differently.
   */
  const roundIdsByParticipant = new Map();
  for (const round of rounds) {
    for (const id of round.participantIds ?? []) {
      const key = String(id);
      if (!roundIdsByParticipant.has(key)) {
        roundIdsByParticipant.set(key, new Set());
      }
      roundIdsByParticipant.get(key).add(String(round._id));
    }
  }

  function buildCells(anchorUserId) {
    const participated = roundIdsByParticipant.get(anchorUserId) ?? new Set();
    return rounds.map((round) => {
      const roundId = String(round._id);
      const cell = scoreByCell.get(`${roundId}:${anchorUserId}`);
      return {
        roundId,
        score: cell?.score ?? null,
        notes: cell?.notes ?? null,
        wasInRound: participated.has(roundId),
        isAdminEdited: Boolean(cell?.adminEditedAt),
      };
    });
  }

  /*
   * The rank key. A null cell contributes nothing rather than zero: someone who
   * has not been marked yet must not be ranked as though they scored 0.
   */
  function sumCells(cells) {
    return cells.reduce(
      (total, cell) => total + (typeof cell.score === "number" ? cell.score : 0),
      0
    );
  }

  function buildRow(anchorUser, extra = {}) {
    const anchorUserId = String(anchorUser._id);
    const cells = buildCells(anchorUserId);
    return {
      participantUserId: anchorUserId,
      fullName: anchorUser.fullName ?? null,
      usn: anchorUser.usn ?? null,
      participantId: anchorUser.participantId ?? null,
      collegeName: anchorUser.collegeId?.commonName ?? null,
      emailAddress: anchorUser.emailAddress ?? null,
      isTeam: false,
      teamId: null,
      teamName: null,
      members: [],
      cells,
      totalScore: sumCells(cells),
      /*
       * A row nobody has marked in any round is "unscored", and the board ranks
       * it below every scored row regardless of total: 0 by absence is not the
       * same result as 0 by judgement.
       */
      hasAnyScore: cells.some((cell) => typeof cell.score === "number"),
      ...extra,
    };
  }

  const roundsPayload = rounds.map((round) => ({
    id: String(round._id),
    roundNumber: round.roundNumber,
    roundName: round.roundName ?? null,
    status: round.status,
  }));

  if (event.eventType !== "team") {
    return { event: eventPayload, rounds: roundsPayload, rows: participants.map((user) => buildRow(user)) };
  }

  /*
   * Team events collapse to one row per team, anchored on the leader — the same
   * anchor every score, advance and elimination downstream is already keyed by.
   */
  const registrations = await RegistrationModel.find({
    eventId: event._id,
    userId: { $in: participantIds },
    teamId: { $ne: null },
  })
    .select("userId teamId")
    .lean();

  const teamIds = [...new Set(registrations.map((registration) => String(registration.teamId)))];
  const teams = teamIds.length
    ? await TeamModel.find({ _id: { $in: teamIds } })
        .select("teamName leaderUserId memberUserIds")
        .lean()
    : [];

  const rows = [];
  const claimed = new Set();

  for (const team of teams) {
    /*
     * Only members actually on the sheet — a team half-eliminated in an earlier
     * round must not reappear whole.
     */
    const memberIds = (team.memberUserIds ?? []).map(String).filter((id) => userById.has(id));
    if (memberIds.length === 0) {
      continue;
    }
    const leaderId = String(team.leaderUserId);
    const anchorId = memberIds.includes(leaderId) ? leaderId : memberIds[0];
    memberIds.forEach((id) => claimed.add(id));

    rows.push(
      buildRow(userById.get(anchorId), {
        isTeam: true,
        teamId: String(team._id),
        teamName: team.teamName,
        members: memberIds.map((id) => {
          const member = userById.get(id);
          return {
            participantUserId: id,
            fullName: member.fullName ?? null,
            usn: member.usn ?? null,
            emailAddress: member.emailAddress ?? null,
            isLeader: id === leaderId,
          };
        }),
      })
    );
  }

  /*
   * Registered for a team event but on no team — surfaced, not dropped. A
   * half-formed team is a data problem to see, not to hide.
   */
  for (const user of participants) {
    if (!claimed.has(String(user._id))) {
      rows.push(buildRow(user));
    }
  }

  return { event: eventPayload, rounds: roundsPayload, rows };
}

/*
 * The administrator's inline correction of ONE cell of the board above.
 *
 * Deliberately NOT saveRoundScores. That path is the coordinator's, and it
 * carries two gates this one must not inherit:
 *
 *   - the presence gate: marks may only be entered for someone the door says is
 *     present. That is anti-malpractice for LIVE judging. An administrator
 *     correcting a transcription error the next morning is not judging, and the
 *     participant has long since gone home.
 *   - the finalise lock: once results are finalised the coordinator's sheet is a
 *     record. The administrator is precisely the escalation path for a finalised
 *     result that is wrong, so locking them out leaves no way to fix it at all.
 *
 * What it does keep: the row is upserted on the same (roundId,
 * participantUserId) key, so an admin edit and a coordinator save are the same
 * row and can never fork into two competing marks; and the write is audited, so
 * an edit made above the coordinator's head is traceable rather than invisible.
 *
 * A null score CLEARS the cell rather than writing 0 — "not marked" and "marked
 * zero" are different results, and the total treats them differently.
 */
async function setRoundScoreAsAdministrator(
  actorUserId,
  eventId,
  roundId,
  participantUserId,
  score,
  context = {}
) {
  const event = await loadEventOrThrow(eventId);
  const round = await loadRoundOrThrow(event._id, roundId);

  if (!mongoose.Types.ObjectId.isValid(participantUserId)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "participantUserId must be a valid id.",
      { participantUserId: "must be a valid ObjectId" }
    );
  }

  const hasScore = score !== null && score !== undefined && score !== "";
  const numericScore = hasScore ? Number(score) : null;
  if (hasScore && !Number.isFinite(numericScore)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "score must be a number.", {
      score: "must be a number",
    });
  }

  const isOnSheet = (round.participantIds ?? []).some(
    (id) => String(id) === String(participantUserId)
  );
  if (!isOnSheet) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "That participant is not in this round, so there is no mark here to correct."
    );
  }

  const editedAt = new Date();
  const previous = await RoundScoreModel.findOne({
    roundId: round._id,
    participantUserId,
  }).lean();

  await RoundScoreModel.updateOne(
    { roundId: round._id, participantUserId },
    {
      $set: {
        eventId: event._id,
        score: numericScore,
        adminEditedAt: editedAt,
        adminEditedByUserId: actorUserId,
      },
      /*
       * scoredByUserId is required by the schema, so an administrator editing a
       * cell the coordinator never created has to seed it. On an existing row it
       * is left alone: the coordinator who entered the original mark keeps the
       * credit, and adminEditedAt carries the fact that it was changed.
       */
      $setOnInsert: { scoredByUserId: actorUserId, scoredAt: editedAt, notes: null },
    },
    { upsert: true }
  );

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_SCORES_SAVED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    beforeState: { score: previous?.score ?? null },
    afterState: {
      roundId: String(round._id),
      roundNumber: round.roundNumber,
      participantUserId: String(participantUserId),
      score: numericScore,
      byAdministrator: true,
    },
    ...context,
  });

  /*
   * The whole board comes back, not just the cell. Every total and every rank
   * moves when one mark changes, so returning the cell would force the client to
   * either refetch anyway or recompute the ranking itself and risk disagreeing
   * with the server about who won.
   */
  return getRoundScoreboard(eventId);
}

async function attachRoundDocument(actorUserId, eventId, roundId, document, context = {}) {
  const event = await loadEventOrThrow(eventId);
  const round = await loadRoundOrThrow(event._id, roundId);
  assertRoundEditable(round);

  const updated = await RoundModel.findOneAndUpdate(
    { _id: round._id },
    {
      $set: {
        documentUrl: document.url,
        documentFileName: document.fileName,
        documentMimeType: document.mimeType,
      },
      $inc: { version: 1 },
    },
    { new: true }
  );

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { roundId: String(round._id), documentFileName: document.fileName },
    ...context,
  });
  return updated.toJSON();
}

/*
 * The coordinator's OVERVIEW tab. Four numbers, each from a named source, so a
 * coordinator can tell "registered" from "actually here":
 *   registered     — confirmed registrations for this event
 *   gateCheckIns   — distinct people through a FEST-level gate
 *   venueCheckIns  — distinct people through THIS event's own door
 *   yetToArrive    — registered − venueCheckIns, floored at zero
 */
async function getEventOverviewStats(eventId) {
  const event = await loadEventOrThrow(eventId);

  const registeredCount = await RegistrationModel.countDocuments({
    eventId: event._id,
    status: {
      $in: [
        REGISTRATION_STATUSES.CONFIRMED,
        REGISTRATION_STATUSES.ATTENDED,
        REGISTRATION_STATUSES.WINNER_1ST,
        REGISTRATION_STATUSES.WINNER_2ND,
        REGISTRATION_STATUSES.WINNER_3RD,
      ],
    },
  });

  async function countDistinctScannedPeople(checkpointFilter) {
    const checkpoints = await CheckpointModel.find(checkpointFilter).select("_id").lean();
    if (checkpoints.length === 0) {
      return 0;
    }
    const rows = await ScanModel.aggregate([
      {
        $match: {
          checkpointId: { $in: checkpoints.map((checkpoint) => checkpoint._id) },
          result: SCAN_RESULTS.ACCEPTED,
          direction: SCAN_DIRECTIONS.IN,
        },
      },
      { $group: { _id: "$passId" } },
      { $count: "distinctPeople" },
    ]);
    return rows[0]?.distinctPeople ?? 0;
  }

  const gateCheckInCount = await countDistinctScannedPeople({
    festId: event.festId,
    checkpointType: CHECKPOINT_TYPES.GATE,
  });
  const venueCheckInCount = await countDistinctScannedPeople({
    eventId: event._id,
    checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
  });

  return {
    registeredCount,
    gateCheckInCount,
    venueCheckInCount,
    yetToArriveCount: Math.max(0, registeredCount - venueCheckInCount),
  };
}

/*
 * Batch-delete rounds and renumber the survivors so round numbers stay
 * contiguous (1, 2, 3 …). Scores tied to deleted rounds are removed too.
 * The caller supplies an array of round IDs — every one must belong to the
 * same event, enforced by the eventId filter.
 */
async function deleteRounds(actorUserId, eventId, roundIds = [], context = {}) {
  const event = await loadEventOrThrow(eventId);

  if (!Array.isArray(roundIds) || roundIds.length === 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_ERROR, "roundIds must be a non-empty array.");
  }

  const validIds = roundIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_ERROR, "No valid round IDs provided.");
  }

  // Delete the rounds and their scores in one shot.
  const deleteResult = await RoundModel.deleteMany({ _id: { $in: validIds }, eventId: event._id });
  await RoundScoreModel.deleteMany({ roundId: { $in: validIds } });

  // Renumber survivors: fetch them sorted by their current roundNumber,
  // then assign 1, 2, 3 … so there are no gaps.
  const survivors = await RoundModel.find({ eventId: event._id })
    .sort({ roundNumber: 1 })
    .select("_id roundNumber");

  const bulkOps = [];
  survivors.forEach((round, index) => {
    const correctNumber = index + 1;
    if (round.roundNumber !== correctNumber) {
      bulkOps.push({
        updateOne: {
          filter: { _id: round._id },
          update: { $set: { roundNumber: correctNumber } },
        },
      });
    }
  });
  if (bulkOps.length > 0) {
    await RoundModel.bulkWrite(bulkOps);
  }

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_DELETED ?? "round_deleted",
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { deletedCount: deleteResult.deletedCount, renumberedCount: bulkOps.length },
    ...context,
  });

  // Return the updated list so the frontend can refresh in one call.
  return listRounds(eventId);
}

/*
 * Elimination as the certificate pipeline understands it.
 *
 * advanceParticipants only ever writes to the ROUNDS collection: someone left
 * out of the next round's participantIds is out in practice, but their
 * Registration row still reads `confirmed`. Certificates are generated from
 * registration status, so without this the eliminated and the still-competing
 * are indistinguishable at certificate time.
 *
 * This does both halves in one call — shortlist the survivors into the next
 * round, and stamp ELIMINATED on the rest. ELIMINATED is already in the
 * certificate pipeline's PARTICIPATION_STATUSES, so those people correctly
 * receive a participation certificate.
 *
 * Only registrations still in a competing state are touched: a cancelled,
 * disqualified or already-awarded row is left exactly as it is, so re-running
 * this can never downgrade a winner or resurrect a cancelled seat.
 */
const STILL_COMPETING_STATUSES = [
  REGISTRATION_STATUSES.CONFIRMED,
  REGISTRATION_STATUSES.ATTENDED,
  REGISTRATION_STATUSES.ADVANCED_TO_R2,
  REGISTRATION_STATUSES.ADVANCED_TO_R3,
  REGISTRATION_STATUSES.ADVANCED_TO_QUARTER_FINAL,
  REGISTRATION_STATUSES.ADVANCED_TO_SEMI_FINAL,
  REGISTRATION_STATUSES.ADVANCED_TO_FINAL,
];

async function eliminateParticipants(
  actorUserId,
  eventId,
  roundId,
  { advancingUserIds = [], eliminatedUserIds = [], lots = null },
  context = {}
) {
  const event = await loadEventOrThrow(eventId);
  const round = await loadRoundOrThrow(event._id, roundId);

  const toObjectIds = (ids) =>
    (ids ?? [])
      .filter((userId) => mongoose.Types.ObjectId.isValid(userId))
      .map((userId) => new mongoose.Types.ObjectId(userId));

  /*
   * Team rows are anchored on the leader (see getRoundDetail), so the client
   * sends one id per team on both sides. Expand each to the full team: without
   * this, advancing carried only the captain into the next round, and
   * eliminating marked only the captain's registration — leaving the rest of
   * the team still "competing" and wrongly eligible for certificates.
   */
  const advancingIds = await expandToTeamMembers(event, toObjectIds(advancingUserIds));
  const eliminatedIds = await expandToTeamMembers(event, toObjectIds(eliminatedUserIds));

  if (advancingIds.length === 0 && eliminatedIds.length === 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Name at least one participant to advance or eliminate.",
      { participantUserIds: "is required" }
    );
  }

  /* Stamp the eliminated first: if the advance below fails, nobody has been
   * moved forward, and a re-run reaches the same end state. */
  let eliminatedCount = 0;
  if (eliminatedIds.length > 0) {
    const result = await RegistrationModel.updateMany(
      {
        eventId: event._id,
        userId: { $in: eliminatedIds },
        status: { $in: STILL_COMPETING_STATUSES },
      },
      { $set: { status: REGISTRATION_STATUSES.ELIMINATED } }
    );
    eliminatedCount = result.modifiedCount ?? 0;
  }

  let nextRound = null;
  if (advancingIds.length > 0) {
    /*
     * The next round must already EXIST — auto-creating it was the other half of
     * the endless-ladder bug. But on the FINAL round there is legitimately no
     * next round: the coordinator cuts the last few and the survivors are the
     * winners. So a missing next round is not an error here; the meaningful
     * action is the ELIMINATED stamp above, which the certificate pipeline reads.
     * Nobody is advanced, and no phantom round is manufactured.
     */
    nextRound = await RoundModel.findOne({
      eventId: event._id,
      roundNumber: round.roundNumber + 1,
    });
    if (nextRound) {
      nextRound = await RoundModel.findOneAndUpdate(
        { _id: nextRound._id },
        { $addToSet: { participantIds: { $each: advancingIds } }, $inc: { version: 1 } },
        { new: true }
      );
    }
  }

  /*
   * The roster stops being provisional the moment someone is cut from it.
   * Leaves `status` alone so a mistyped score can still be corrected.
   */
  if (!round.rosterFinalised) {
    await RoundModel.updateOne({ _id: round._id }, { $set: { rosterFinalised: true } });
  }

  /*
   * Tell people what happened — but ONLY while the competition is still
   * running. After the final round the outcome belongs to the Admin, who
   * publishes the result; a stray "you were eliminated" email racing the
   * official announcement is exactly what we are avoiding.
   *
   * "Final round" means there is no round after this one, so nobody could
   * advance anywhere even if they wanted to.
   */
  const laterRoundExists = await RoundModel.exists({
    eventId: event._id,
    roundNumber: { $gt: round.roundNumber },
  });

  /*
   * Group assignments for the round being advanced INTO, keyed by the id the
   * client sent — which for a team is the leader's anchor id. Expanded to the
   * whole team below, so every member is told the same group.
   */
  const lotByUserId = new Map();
  if (lots && typeof lots === "object") {
    for (const [anchorUserId, lot] of Object.entries(lots)) {
      if (!lot || !mongoose.Types.ObjectId.isValid(anchorUserId)) {
        continue;
      }
      const teamIds = await expandToTeamMembers(event, [
        new mongoose.Types.ObjectId(anchorUserId),
      ]);
      for (const memberId of teamIds) {
        lotByUserId.set(String(memberId), String(lot));
      }
    }
  }

  /*
   * Persisted on the next round's score row, so the group survives the
   * notification and shows on the scoresheet the coordinator runs that round
   * from. Upserted because the row does not exist until somebody is scored.
   */
  if (lotByUserId.size > 0 && nextRound) {
    await Promise.all(
      [...lotByUserId.entries()].map(([userId, lot]) =>
        RoundScoreModel.updateOne(
          { roundId: nextRound._id, participantUserId: new mongoose.Types.ObjectId(userId) },
          {
            $set: { roundLot: lot },
            $setOnInsert: {
              eventId: event._id,
              scoredByUserId: actorUserId,
              score: null,
            },
          },
          { upsert: true }
        )
      )
    );
  }

  /*
   * Sent on EVERY round, including the last one.
   *
   * This used to fire only when a later round existed, so the final round —
   * the one whose result people most want — told nobody anything. Advancers
   * on a final round are the finalists awaiting placement; the eliminated are
   * out, and deserve to hear it either way.
   */
  const emailedCount = await notifyRoundOutcome(
    event,
    round,
    advancingIds,
    eliminatedIds,
    lotByUserId
  );

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_PARTICIPANTS_ADVANCED ?? "round_participants_advanced",
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: {
      roundNumber: round.roundNumber,
      advancedCount: advancingIds.length,
      eliminatedCount,
      emailedCount,
      finalRound: !laterRoundExists,
    },
    ...context,
  });

  return {
    advancedCount: advancingIds.length,
    eliminatedCount,
    nextRoundNumber: nextRound?.roundNumber ?? null,
    emailedCount,
    isFinalRound: !laterRoundExists,
  };
}

/*
 * One mail per person: advanced or not. Best-effort — sendMailQuietly swallows
 * transport failures, and a bounced mailbox must not roll back an elimination
 * that has already been written.
 */
async function notifyRoundOutcome(event, round, advancingIds, eliminatedIds, lotByUserId = null) {
  const { festName, hostCollegeName } = await resolveEventPlaceNames(event);

  const recipients = await UserModel.find({
    _id: { $in: [...advancingIds, ...eliminatedIds] },
  })
    .select("fullName emailAddress")
    .lean();

  const advancingSet = new Set(advancingIds.map(String));
  let sent = 0;

  for (const recipient of recipients) {
    if (!recipient.emailAddress) continue;
    const advanced = advancingSet.has(String(recipient._id));
    /*
     * The lot no longer decorates one shared message — it CHOOSES the message.
     * Three tiers of advancement read very differently, so the template is
     * resolved per recipient rather than once for the batch.
     */
    const template = advanced
      ? selectAdvancementTemplate(lotByUserId?.get(String(recipient._id)) ?? null)
      : ROUND_NOTIFICATION_TEMPLATES.eliminated;
    const copyContext = buildRoundCopyContext({ event, festName, hostCollegeName });

    const wasSent = await sendMailQuietly({
      to: recipient.emailAddress,
      subject: template.subject(copyContext),
      ...buildBrandedEmailBodies(template.body(copyContext), { festName: copyContext.festName }),
    });
    if (wasSent) sent += 1;
  }

  /*
   * Feed rows for everyone, including anyone with no mailbox — the email loop
   * above skips those, and they are precisely the people who would otherwise
   * never learn the outcome.
   */
  const { notifyUsers, NOTIFICATION_TYPES } = require("./notification-service");

  /*
   * Advancers are GROUPED BY LOT, not sent one message. notifyUsers takes a list
   * of ids and a single body, so one call for everybody would tell half the
   * field they are in the other half's group. One call per distinct lot (and one
   * for those with no lot at all) is a handful of writes, not one per person.
   */
  const copyContext = buildRoundCopyContext({ event, festName, hostCollegeName });

  /*
   * Advancers are grouped by TIER, because notifyUsers takes a list of ids and
   * ONE body: a single call for everybody would send the "outstanding" praise to
   * the people who were told to keep improving. One call per tier is three
   * writes at most, not one per participant.
   */
  const advancersByTier = new Map();
  for (const userId of advancingIds) {
    const template = selectAdvancementTemplate(lotByUserId?.get(String(userId)) ?? null);
    const tierKey = template.notificationTitle(copyContext);
    if (!advancersByTier.has(tierKey)) {
      advancersByTier.set(tierKey, { template, userIds: [] });
    }
    advancersByTier.get(tierKey).userIds.push(userId);
  }

  for (const group of advancersByTier.values()) {
    await notifyUsers({
      userIds: group.userIds,
      notificationType: NOTIFICATION_TYPES.ROUND_ADVANCED,
      title: group.template.notificationTitle(copyContext),
      body: group.template.notificationBody(copyContext),
      linkPath: `/events/${event._id}`,
      festId: event.festId,
      eventId: event._id,
    });
  }

  if (eliminatedIds.length > 0) {
    const eliminatedTemplate = ROUND_NOTIFICATION_TEMPLATES.eliminated;
    await notifyUsers({
      userIds: eliminatedIds,
      notificationType: NOTIFICATION_TYPES.ROUND_ELIMINATED,
      title: eliminatedTemplate.notificationTitle(copyContext),
      body: eliminatedTemplate.notificationBody(copyContext),
      linkPath: `/events/${event._id}`,
      festId: event.festId,
      eventId: event._id,
    });
  }

  return sent;
}

/*
 * The fest's name and the name of the college HOSTING it, for the "at <fest>,
 * <college>" clause. One lookup per notification batch — every recipient of a
 * round result shares an event, and therefore a fest.
 *
 * Never throws: a missing name costs one clause (the copy omits it), and is not
 * worth failing a result announcement that has already been written.
 */
async function resolveEventPlaceNames(event) {
  try {
    const { FestModel } = require("../models/fest-model");
    const fest = await FestModel.findById(event.festId).select("festName hostCollegeId").lean();
    if (!fest) {
      return { festName: null, hostCollegeName: null };
    }
    const { CollegeModel } = require("../models/college-model");
    const college = fest.hostCollegeId
      ? await CollegeModel.findById(fest.hostCollegeId).select("commonName collegeName").lean()
      : null;
    return {
      festName: fest.festName ?? null,
      hostCollegeName: college?.commonName || college?.collegeName || null,
    };
  } catch {
    return { festName: null, hostCollegeName: null };
  }
}

/*
 * Turns the final round's scores into awarded placements, which is what the
 * winner-certificate push reads. Without this a coordinator can finish every
 * round and still have no winners: the achievement rows the certificate
 * pipeline looks for are only written by the admin-only bracket flow.
 *
 * Placement comes from TOTAL score across every round, so a strong early round
 * still counts. Ties share a placement, and the next placement skips
 * accordingly (two firsts, then a third) — the standard competition ranking.
 */
async function awardRoundResults(actorUserId, eventId, context = {}, explicitWinners = null) {
  const { AchievementModel } = require("../models/achievement-model");
  const { ACHIEVEMENT_TYPES, ACHIEVEMENT_SOURCES } = require("../constants/achievement-constants");

  const event = await loadEventOrThrow(eventId);

  const rounds = await RoundModel.find({ eventId: event._id }).select("_id").lean();
  if (rounds.length === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "This event has no rounds to award results from."
    );
  }

  const scores = await RoundScoreModel.find({
    roundId: { $in: rounds.map((r) => r._id) },
  })
    .select("participantUserId score")
    .lean();
  if (scores.length === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "No scores recorded yet — score the rounds before awarding results."
    );
  }

  const totalByUser = new Map();
  for (const row of scores) {
    const key = String(row.participantUserId);
    totalByUser.set(key, (totalByUser.get(key) ?? 0) + (row.score ?? 0));
  }

  /*
   * Scores propose, the coordinator disposes. A judge's call, a tie-break, or a
   * disqualification the scores cannot see all mean the computed ranking is a
   * default rather than a verdict — so an explicit list, when sent, wins
   * outright and the score ordering is not consulted at all.
   */
  /*
   * A PODIUM IS THREE DIFFERENT PEOPLE IN THREE DIFFERENT PLACES.
   *
   * Checked before anything is written, because the alternative is a partial
   * podium: the loop below would set first place, then set the same
   * registration to second, and the participant ends up holding whichever
   * status was written last while the other place is silently vacant.
   */
  if (Array.isArray(explicitWinners) && explicitWinners.length > 0) {
    const seenUserIds = new Set();
    const seenPlacements = new Set();
    for (const winner of explicitWinners) {
      const userKey = String(winner?.userId ?? "");
      const placementKey = Number(winner?.placement);
      if (seenUserIds.has(userKey)) {
        throw new ApplicationError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "One participant cannot hold two placements.",
          { winners: `userId ${userKey} appears more than once` }
        );
      }
      if (seenPlacements.has(placementKey)) {
        throw new ApplicationError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "Two participants cannot share the same placement.",
          { winners: `placement ${placementKey} is assigned more than once` }
        );
      }
      seenUserIds.add(userKey);
      seenPlacements.add(placementKey);
    }
  }

  const ranked =
    Array.isArray(explicitWinners) && explicitWinners.length > 0
      ? explicitWinners
          .filter((w) => w?.userId && [1, 2, 3].includes(Number(w.placement)))
          .sort((a, b) => Number(a.placement) - Number(b.placement))
          .map((w) => ({
            userId: String(w.userId),
            total: totalByUser.get(String(w.userId)) ?? 0,
            forcedPlacement: Number(w.placement),
          }))
      : [...totalByUser.entries()]
          .map(([userId, total]) => ({ userId, total }))
          .sort((a, b) => b.total - a.total);

  const STATUS_BY_PLACEMENT = {
    1: REGISTRATION_STATUSES.WINNER_1ST,
    2: REGISTRATION_STATUSES.WINNER_2ND,
    3: REGISTRATION_STATUSES.WINNER_3RD,
  };

  let placement = 0;
  let previousTotal = null;
  let awardedCount = 0;
  /* Who ended up on the podium, for the notifications after the loop. */
  const placedUserIdsByPlacement = [];

  /*
   * Clear the previous verdict first. Without this a re-award that demotes
   * someone leaves their old achievement row and winner status in place, and
   * they collect a winner certificate they no longer hold.
   */
  const keepUserIds = new Set(ranked.slice(0, 3).map((entry) => String(entry.userId)));
  const previouslyAwarded = await AchievementModel.find({
    eventId: event._id,
    achievementType: ACHIEVEMENT_TYPES.EVENT_RESULT,
  })
    .select("userId")
    .lean();
  const staleUserIds = previouslyAwarded
    .map((row) => row.userId)
    .filter((userId) => !keepUserIds.has(String(userId)));
  if (staleUserIds.length > 0) {
    await AchievementModel.deleteMany({
      eventId: event._id,
      achievementType: ACHIEVEMENT_TYPES.EVENT_RESULT,
      userId: { $in: staleUserIds },
    });
    await RegistrationModel.updateMany(
      {
        eventId: event._id,
        userId: { $in: staleUserIds },
        status: {
          $in: [
            REGISTRATION_STATUSES.WINNER_1ST,
            REGISTRATION_STATUSES.WINNER_2ND,
            REGISTRATION_STATUSES.WINNER_3RD,
          ],
        },
      },
      { $set: { status: REGISTRATION_STATUSES.CONFIRMED } }
    );
  }

  for (let index = 0; index < ranked.length; index += 1) {
    const entry = ranked[index];
    if (entry.forcedPlacement) {
      placement = entry.forcedPlacement;
    } else if (entry.total !== previousTotal) {
      /* Standard competition ranking: equal totals share a placement and the
       * next one skips accordingly (1, 1, 3). */
      placement = index + 1;
      previousTotal = entry.total;
    }
    if (placement > 3) {
      break;
    }

    const userObjectId = new mongoose.Types.ObjectId(entry.userId);

    /* Idempotent: the unique index on (userId, eventId, metadata.placement)
     * means a re-run updates rather than duplicates. */
    await AchievementModel.updateOne(
      {
        userId: userObjectId,
        eventId: event._id,
        achievementType: ACHIEVEMENT_TYPES.EVENT_RESULT,
        "metadata.placement": placement,
      },
      {
        $set: {
          festId: event.festId,
          source: ACHIEVEMENT_SOURCES?.SYSTEM ?? "system",
          title: `${event.eventName} — Position ${placement}`,
          metadata: { placement, totalScore: entry.total },
        },
      },
      { upsert: true }
    );

    await RegistrationModel.updateOne(
      { eventId: event._id, userId: userObjectId },
      { $set: { status: STATUS_BY_PLACEMENT[placement] } }
    );

    placedUserIdsByPlacement.push({ userId: entry.userId, placement });
    awardedCount += 1;
  }

  /*
   * The podium is told. Fire-and-forget, AFTER the statuses are written: the
   * result stands whether or not the mail host is up, and a coordinator waiting
   * on a publish button should not wait on SMTP.
   */
  void notifyPodium(event, placedUserIdsByPlacement).catch((notifyError) => {
    console.error(`Winner notifications failed for event ${event._id}: ${notifyError.message}`);
  });

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.RESULTS_AWARDED ?? "results_awarded",
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { awardedCount },
    ...context,
  });

  return { awardedCount };
}

/*
 * Congratulates the podium, on both channels.
 *
 * Separate from notifyRoundOutcome because winning is not advancing: an
 * advancement says "there is another round", a placement says "this is the
 * result". Sending the advancement copy to a winner would tell them to await a
 * brief for a round that does not exist.
 *
 * Best-effort throughout {D} sendMailQuietly already swallows transport
 * failures, and a placement that has been written must not be undone by a
 * bounced mailbox.
 */
async function notifyPodium(event, placements) {
  if (!Array.isArray(placements) || placements.length === 0) {
    return 0;
  }
  const { festName, hostCollegeName } = await resolveEventPlaceNames(event);
  const copyContext = buildRoundCopyContext({ event, festName, hostCollegeName });

  const recipients = await UserModel.find({
    _id: { $in: placements.map((entry) => entry.userId) },
  })
    .select("fullName emailAddress")
    .lean();
  const usersById = new Map(recipients.map((user) => [String(user._id), user]));

  const { notifyUsers, NOTIFICATION_TYPES } = require("./notification-service");
  let sent = 0;

  for (const entry of placements) {
    const template = selectPlacementTemplate(entry.placement);
    if (!template) {
      continue;
    }

    const user = usersById.get(String(entry.userId));
    if (user?.emailAddress) {
      const wasSent = await sendMailQuietly({
        to: user.emailAddress,
        subject: template.subject(copyContext),
        ...buildBrandedEmailBodies(template.body(copyContext), { festName: copyContext.festName }),
      });
      if (wasSent) sent += 1;
    }

    /* One call per placement: three winners, three different messages, so
       there is nothing to batch. */
    await notifyUsers({
      userIds: [entry.userId],
      notificationType: NOTIFICATION_TYPES.RESULTS_PUBLISHED,
      title: template.notificationTitle(copyContext),
      body: template.notificationBody(copyContext),
      linkPath: `/events/${event._id}`,
      festId: event.festId,
      eventId: event._id,
    });
  }

  return sent;
}

/*
 * Starting a round does three things in one irreversible step:
 *
 *  1. Freezes the roster. Round 1 absorbs late arrivals right up to this
 *     moment; after it, someone walking in cannot be scored against a brief the
 *     others already performed under.
 *  2. Moves DRAFT -> ACTIVE, which is what makes the round live on the
 *     scoreboard.
 *  3. Emails the brief to the people competing in it.
 *
 * Email only, no in-app notification: the rules are a document a participant
 * needs open beside them, and a notification row that scrolls away in a feed is
 * the wrong container for it.
 *
 * Delivery is best-effort. sendMailQuietly already swallows transport failures,
 * and a bounced mailbox must not leave the round un-started with the coordinator
 * unable to retry.
 */
async function startRound(actorUserId, eventId, roundId, context = {}) {
  const event = await loadEventOrThrow(eventId);
  const round = await loadRoundOrThrow(event._id, roundId);

  if (round.status === ROUND_STATUSES.COMPLETED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.ROUND_ALREADY_COMPLETED,
      "This round is completed and cannot be started again."
    );
  }
  if (round.status === ROUND_STATUSES.ACTIVE) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "This round has already started."
    );
  }

  /* Last chance for late arrivals, then the door closes. */
  const refreshed = await refreshFirstRoundRoster(event, round);

  if ((refreshed.participantIds ?? []).length === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "Nobody is in this round yet. Participants must check in at the event entry before it can start."
    );
  }

  const started = await RoundModel.findOneAndUpdate(
    { _id: refreshed._id },
    { $set: { status: ROUND_STATUSES.ACTIVE, rosterFinalised: true, startedAt: new Date() } },
    { new: true }
  );

  const recipients = await UserModel.find({ _id: { $in: started.participantIds } })
    .select("fullName emailAddress")
    .lean();

  const roundLabel = started.roundName
    ? `${started.roundName} (Round ${started.roundNumber})`
    : `Round ${started.roundNumber}`;

  let emailedCount = 0;
  for (const recipient of recipients) {
    if (!recipient.emailAddress) {
      continue;
    }
    const sections = [];
    if (started.description) {
      sections.push(`What this round is\n${started.description}`);
    }
    if (started.rules) {
      sections.push(`Rules & regulations\n${started.rules}`);
    }
    const body =
      `Hi ${recipient.fullName || "there"},\n\n` +
      `${roundLabel} of ${event.eventName} has started.\n\n` +
      (sections.length > 0
        ? `${sections.join("\n\n")}\n\n`
        : "Your coordinator will brief you on site.\n\n") +
      `Good luck.\n\n- The Dedal team`;

    const sent = await sendMailQuietly({
      to: recipient.emailAddress,
      subject: `${roundLabel} — ${event.eventName}`,
      ...buildBrandedEmailBodies(body),
    });
    if (sent) {
      emailedCount += 1;
    }
  }

  /*
   * The feed gets the headline; the email carries the full brief. Someone who
   * misses the mail still sees in the app that their round has begun.
   */
  const { notifyUsers, NOTIFICATION_TYPES } = require("./notification-service");
  await notifyUsers({
    userIds: started.participantIds,
    notificationType: NOTIFICATION_TYPES.ROUND_STARTED,
    title: `${roundLabel} has started`,
    /* The event name and nothing else. "Check your email for the rules and
       timing" was an instruction that filled the whole body on a phone and
       pushed out the one fact the row exists to carry — WHICH event. The rules
       are in the email whether or not this row says so. */
    body: event.eventName,
    linkPath: `/events/${event._id}`,
    festId: event.festId,
    eventId: event._id,
    actorUserId,
  });

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ROUND_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    beforeState: { status: round.status },
    afterState: {
      roundId: String(started._id),
      status: started.status,
      participantCount: (started.participantIds ?? []).length,
      emailedCount,
    },
    ...context,
  });

  return {
    round: started.toJSON(),
    participantCount: (started.participantIds ?? []).length,
    emailedCount,
  };
}

/*
 * Finalise: the single moment the event's outcome becomes settled.
 *
 * Awards the medals the coordinator picked in the final round, stamps the
 * event, and stops every further edit. Everything before this is provisional —
 * that is why scores stay editable through completed rounds — and everything
 * after is a record the Admin reads and the certificate pipeline draws from.
 *
 * No email is sent here. Results reach participants through the Admin, so the
 * mailing that accompanies earlier rounds deliberately stops at the final one.
 */
async function finaliseResults(actorUserId, eventId, winners = [], context = {}) {
  const event = await loadEventOrThrow(eventId);

  if (event.resultsFinalisedAt) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "Results for this event are already finalised."
    );
  }

  const rounds = await RoundModel.find({ eventId: event._id }).sort({ roundNumber: 1 }).lean();
  if (rounds.length === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "This event has no rounds to finalise."
    );
  }
  const finalRound = rounds[rounds.length - 1];
  /*
   * The guard used to demand status === COMPLETED, but NOTHING in the codebase
   * ever writes that status: startRound sets ACTIVE, and advancing/eliminating
   * set rosterFinalised (deliberately separate, so scores stay editable). So
   * "Complete the final round before finalising results." was unreachable —
   * results could never be finalised at all.
   *
   * The real requirement is that the last round actually RAN. A round that was
   * never started still blocks; one that is running (or already marked complete)
   * may be finalised, and finalising is what completes it.
   */
  if (finalRound.status === ROUND_STATUSES.DRAFT) {
    throw new ApplicationError(
      409,
      ERROR_CODES.VALIDATION_FAILED,
      "Start the final round before finalising results."
    );
  }

  /* awardRoundResults writes the achievement rows and winner statuses the
   * certificate pipeline reads, and clears anyone dropped off the podium. */
  const awarded = await awardRoundResults(
    actorUserId,
    eventId,
    context,
    Array.isArray(winners) && winners.length > 0 ? winners : null
  );

  /* Finalising IS the completion of the final round — record it, so the
   * scoreboard's status badge and any later guard reflect reality. */
  await RoundModel.updateOne(
    { _id: finalRound._id },
    { $set: { status: ROUND_STATUSES.COMPLETED, rosterFinalised: true } }
  );

  await EventModel.updateOne(
    { _id: event._id },
    { $set: { resultsFinalisedAt: new Date() } }
  );

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.RESULTS_AWARDED ?? "results_awarded",
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { finalised: true, awardedCount: awarded.awardedCount },
    ...context,
  });

  return { finalised: true, awardedCount: awarded.awardedCount };
}

module.exports = {
  createRound,
  startRound,
  listRounds,
  getRoundDetail,
  updateRound,
  deleteRounds,
  advanceParticipants,
  eliminateParticipants,
  awardRoundResults,
  finaliseResults,
  retractParticipants,
  saveRoundScores,
  getRoundScoreboard,
  setRoundScoreAsAdministrator,
  attachRoundDocument,
  getEventOverviewStats,
};
