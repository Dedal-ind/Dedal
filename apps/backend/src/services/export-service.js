const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { PaymentOrderModel } = require("../models/payment-order-model");
const { ScanModel } = require("../models/scan-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { AuditLogModel } = require("../models/audit-log-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { UserModel } = require("../models/user-model");
const { CertificateModel } = require("../models/certificate-model");
const { EventFeedbackModel } = require("../models/event-feedback-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { ENTITLEMENT_STATUSES } = require("../constants/pass-constants");
const { SCAN_RESULTS, SCAN_DIRECTIONS } = require("../constants/scan-constants");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { assignmentCoversEvent } = require("../helpers/assignment-coverage-helpers");
const { resolveRequestedEventScopeIds } = require("../helpers/event-descendant-helpers");
const { toCsvLine, setCsvResponseHeaders } = require("../helpers/csv-stream-helpers");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

/*
 * Every export STREAMS: a Mongoose cursor walks the rows and each CSV line is
 * written straight to the response — the full result is never accumulated in
 * memory, so a 5000-registration fest cannot balloon the process. :festId is the
 * hard scope of every export; there is deliberately no cross-fest endpoint.
 *
 * Every completed export writes a data.exported audit row — taking a roster off
 * the system is a supervised operation.
 */

async function loadFestOrThrow(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId)
    ? await FestModel.findById(festId).lean()
    : null;
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

/* Coordinator: only their covered events (assignmentCoversEvent — never a copy). */
async function resolveScopedEventIds(fest, scope) {
  const events = await EventModel.find({ festId: fest._id }).select("_id eventName").lean();
  let authorised = events;
  if (scope && !scope.isAdministrator) {
    authorised = [];
    for (const event of events) {
      if (await assignmentCoversEvent(scope.staffAssignment, event._id)) {
        authorised.push(event);
      }
    }
  }
  /*
   * The ?eventIds= filter is an INTERSECTION with the authorised set: it can
   * only ever narrow, never grant. With ?includeDescendants=true a named parent
   * expands to its whole subtree first — so "export Chiduranga" means
   * Chiduranga and its sub-events — and the intersection still applies, so a
   * coordinator cannot reach a descendant outside their coverage.
   */
  if (scope?.requestedEventIds?.length) {
    const requestedIds = await resolveRequestedEventScopeIds(fest._id, scope);
    const requested = new Set(requestedIds ?? []);
    authorised = authorised.filter((event) => requested.has(String(event._id)));
  }
  return authorised;
}

async function recordExportAudit(actorUserId, fest, exportType, rowCount, context, auditExtra = {}) {
  await recordAuditLog({
    actorUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.DATA_EXPORTED,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest._id,
    // auditExtra lets a caller pin extra accountability fields into the row —
    // the volunteer exports record which checkpoint was pulled, for instance.
    afterState: { exportType, rowCount, festId: String(fest._id), ...auditExtra },
    ...context,
  });
}

/* Shared spine: headers, then one response.write per cursor row, then audit. */
async function streamCursorAsCsv({ response, fest, exportType, headerCells, cursor, toCells, actorUserId, context, auditExtra }) {
  setCsvResponseHeaders(response, exportType, fest.festSlug);
  response.write(toCsvLine(headerCells));
  let rowCount = 0;
  for await (const documentRow of cursor) {
    const cells = toCells(documentRow);
    // A null from toCells means "this document contributes no row" (e.g. the
    // scan dedupe) — skipped, not written, not counted.
    if (cells === null) {
      continue;
    }
    response.write(toCsvLine(cells));
    rowCount += 1;
  }
  /*
   * The audit row is written BEFORE the response is closed, deliberately. With
   * end() first, the client is told the download finished while the "who
   * exported this roster" record is still in flight — the export could complete
   * and the audit silently fail, and a caller that immediately reads the audit
   * log (a test, or the Data Controls screen refreshing) sees a download with
   * no trail. Taking a roster off the system is a supervised operation, so the
   * supervision lands first.
   */
  await recordExportAudit(actorUserId, fest, exportType, rowCount, context, auditExtra);
  response.end();
}

async function streamRegistrationsCsv(actorUserId, festId, response, scope, context = {}) {
  const fest = await loadFestOrThrow(festId);
  const scopedEvents = await resolveScopedEventIds(fest, scope);
  const eventNameById = new Map(scopedEvents.map((event) => [String(event._id), event.eventName]));

  const cursor = RegistrationModel.find({ eventId: { $in: scopedEvents.map((event) => event._id) } })
    // +phoneNumber is a deliberate, named request (select: false on the model) —
    // this export is the contact sheet, admin/coordinator gated. Nothing wider.
    .populate({ path: "userId", select: "fullName emailAddress department yearOfStudy collegeId +phoneNumber", populate: { path: "collegeId", select: "commonName" } })
    .populate({ path: "teamId", select: "teamName leaderUserId" })
    .lean()
    .cursor();

  await streamCursorAsCsv({
    response,
    fest,
    exportType: "registrations",
    actorUserId,
    context,
    headerCells: [
      "registrationId", "eventName", "registrationType", "participantFullName", "participantEmailAddress", "phoneNumber", "contactPhoneThisEvent",
      "collegeName", "department", "yearOfStudy", "gender", "teamName", "isTeamLeader", "status",
      "paymentStatus", "feePaise", "foodPreference", "foodOrderCount", "needsAccommodation",
      "offerSelections", "medicalDeclarationAcceptedAt", "createdAt", "confirmedAt",
    ],
    cursor,
    toCells: (row) => [
      String(row._id),
      eventNameById.get(String(row.eventId)) ?? "",
      // Presence of contingentClaimId IS the registration type (see the model).
      row.contingentClaimId ? "contingent" : "individual",
      row.userId?.fullName ?? "",
      row.userId?.emailAddress ?? "",
      row.userId?.phoneNumber ?? "",
      // "Contact phone (this event)": the per-registration override, falling
      // back to the account phone — the same resolution the roster shows.
      row.contactPhoneOverride ?? row.userId?.phoneNumber ?? "",
      row.userId?.collegeId?.commonName ?? "",
      row.userId?.department ?? "",
      row.userId?.yearOfStudy ?? "",
      // The schema's only gender signal is the per-registration category.
      row.genderCategory ?? "",
      row.teamId?.teamName ?? "",
      row.teamId ? String(row.teamId.leaderUserId) === String(row.userId?._id) : "",
      row.status,
      row.paymentStatus,
      row.totalFeePaise ?? 0,
      row.foodPreference ?? "",
      row.foodOrderCount ?? "",
      row.needsAccommodation ?? "",
      (row.offerSelections ?? [])
        .map(
          (selection) =>
            `${selection.scope ?? "fest"}/${selection.offerKey}:${selection.numberOfPeople ?? 1}p x ${selection.numberOfDays ?? 1}d`
        )
        .join("; "),
      row.medicalDeclarationAcceptedAt?.toISOString?.() ?? "",
      row.createdAt?.toISOString?.() ?? "",
      // No confirmedAt exists on the schema; updatedAt of a confirmed row is the
      // closest stable stand-in (it moves on later edits too — approximate).
      row.status === REGISTRATION_STATUSES.CONFIRMED ? row.updatedAt?.toISOString?.() ?? "" : "",
    ],
  });
}

/*
 * Check-in / check-out sheets for ONE event, streamed a row at a time like every
 * other export here. Distinctness (first accepted scan per pass, per direction)
 * needs one Set of pass IDS — bounded by the event's head count, which is not
 * row accumulation; the rows themselves still stream through the cursor, and a
 * repeat scan of the same person streams through as a skipped row.
 */
async function streamEventScanDirectionCsv(actorUserId, festId, eventId, direction, response, context = {}) {
  const fest = await loadFestOrThrow(festId);
  const event = await EventModel.findOne({ _id: eventId, festId: fest._id }).lean();
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const checkpointIds = await CheckpointModel.find({
    eventId: event._id,
    checkpointType: "eventEntry",
  }).distinct("_id");

  const cursor = ScanModel.find({
    checkpointId: { $in: checkpointIds },
    result: "accepted",
    direction,
  })
    .sort({ scannedAt: 1 })
    .populate({
      path: "passId",
      select: "userId",
      populate: {
        // +phoneNumber deliberately: this is the door contact sheet, same rule
        // as the registrations export above.
        path: "userId",
        select: "fullName emailAddress usn participantId collegeId +phoneNumber",
        populate: { path: "collegeId", select: "commonName", model: "College" },
      },
    })
    .lean()
    .cursor();

  const seenPassIds = new Set();
  const exportKind = direction === "out" ? "check-outs" : "check-ins";
  await streamCursorAsCsv({
    response,
    /*
     * The shared header helper builds "{exportType}-{festSlug}-{date}.csv"; the
     * spec for these sheets is "{kind}-{eventSlug}-{yyyymmdd}.csv", so the event
     * slug rides in the festSlug slot. Everything the audit reads (fest._id)
     * survives the shallow override.
     */
    fest: { ...fest, festSlug: event.eventSlug },
    exportType: exportKind,
    actorUserId,
    context,
    headerCells: [
      "participantFullName", "participantEmailAddress", "phoneNumber", "usn",
      "participantId", "collegeName", "firstScannedAt",
    ],
    cursor,
    toCells: (row) => {
      const passKey = String(row.passId?._id ?? row.passId);
      if (seenPassIds.has(passKey)) {
        return null; // a later scan of the same person is not another head
      }
      seenPassIds.add(passKey);
      const user = row.passId?.userId ?? {};
      return [
        user.fullName ?? "",
        user.emailAddress ?? "",
        user.phoneNumber ?? "",
        user.usn ?? "",
        user.participantId ?? "",
        user.collegeId?.commonName ?? "",
        row.scannedAt?.toISOString?.() ?? "",
      ];
    },
  });
}

async function streamPaymentsCsv(actorUserId, festId, response, scope, context = {}) {
  const fest = await loadFestOrThrow(festId);
  // Payment orders are keyed by paymentGroupId; the fest's groups are the ones
  // its registrations carry.
  // Scoped to the same events every other export resolves, so an ?eventId=
  // filter narrows the payment sheet exactly as it narrows the roster.
  const scopedEvents = await resolveScopedEventIds(fest, scope);
  const groupIds = await RegistrationModel.distinct("paymentGroupId", {
    eventId: { $in: scopedEvents.map((event) => event._id) },
    paymentGroupId: { $ne: null },
  });
  const cursor = PaymentOrderModel.find({ paymentGroupId: { $in: groupIds } }).lean().cursor();
  await streamCursorAsCsv({
    response,
    fest,
    exportType: "payments",
    actorUserId,
    context,
    cursor,
    headerCells: ["paymentGroupId", "razorpayOrderId", "razorpayPaymentId", "status", "amountPaise", "currency", "createdAt", "capturedAt"],
    toCells: (row) => [
      row.paymentGroupId,
      row.razorpayOrderId ?? "",
      row.razorpayPaymentId ?? "",
      row.status,
      row.totalAmountPaise ?? 0,
      "INR",
      row.createdAt?.toISOString?.() ?? "",
      // No capturedAt field exists; a captured order's updatedAt is the capture
      // write (approximate if edited later).
      row.status === "captured" ? row.updatedAt?.toISOString?.() ?? "" : "",
    ],
  });
}

async function streamScansCsv(actorUserId, festId, response, scope, context = {}) {
  const fest = await loadFestOrThrow(festId);
  /*
   * An event filter narrows to that event's own doors. Fest-level gates
   * (eventId null) are kept ONLY when nothing was narrowed — once the admin
   * asks for one event, gate traffic for the whole fest is not that event's
   * data.
   */
  const scopedEvents = await resolveScopedEventIds(fest, scope);
  const isNarrowed = Boolean(scope?.requestedEventIds?.length);
  const checkpointFilter = { festId: fest._id };
  if (isNarrowed) {
    checkpointFilter.eventId = { $in: scopedEvents.map((event) => event._id) };
  }
  const checkpoints = await CheckpointModel.find(checkpointFilter).select("checkpointName eventId").lean();
  const checkpointById = new Map(checkpoints.map((checkpoint) => [String(checkpoint._id), checkpoint]));
  const events = await EventModel.find({ festId: fest._id }).select("eventName").lean();
  const eventNameById = new Map(events.map((event) => [String(event._id), event.eventName]));

  const cursor = ScanModel.find({ checkpointId: { $in: checkpoints.map((checkpoint) => checkpoint._id) } })
    .populate({ path: "passId", select: "userId", populate: { path: "userId", select: "fullName" } })
    .populate({ path: "scannedByUserId", select: "fullName" })
    .lean()
    .cursor();

  await streamCursorAsCsv({
    response,
    fest,
    exportType: "scans",
    actorUserId,
    context,
    cursor,
    headerCells: ["scanId", "scannedAt", "checkpointName", "eventName", "direction", "result", "participantFullName", "scannedByFullName"],
    toCells: (row) => {
      const checkpoint = checkpointById.get(String(row.checkpointId));
      return [
        String(row._id),
        row.scannedAt?.toISOString?.() ?? "",
        checkpoint?.checkpointName ?? "",
        checkpoint?.eventId ? eventNameById.get(String(checkpoint.eventId)) ?? "" : "",
        row.direction,
        row.result,
        row.passId?.userId?.fullName ?? "",
        row.scannedByUserId?.fullName ?? "",
      ];
    },
  });
}

async function streamAuditLogCsv(actorUserId, festId, response, context = {}) {
  const fest = await loadFestOrThrow(festId);
  const eventIds = (await EventModel.find({ festId: fest._id }).select("_id").lean()).map((e) => e._id);
  const cursor = AuditLogModel.find({
    $or: [{ festId: fest._id }, { entityId: { $in: eventIds } }],
  })
    .populate({ path: "actorUserId", select: "fullName emailAddress" })
    .lean()
    .cursor();
  await streamCursorAsCsv({
    response,
    fest,
    exportType: "audit-log",
    actorUserId,
    context,
    cursor,
    headerCells: ["auditLogId", "createdAt", "action", "entityType", "entityId", "actorName", "actorEmail", "ipAddress"],
    toCells: (row) => [
      String(row._id),
      row.createdAt?.toISOString?.() ?? "",
      row.action,
      row.entityType,
      row.entityId ? String(row.entityId) : "",
      row.actorUserId?.fullName ?? "",
      row.actorUserId?.emailAddress ?? "",
      row.ipAddress ?? "",
    ],
  });
}

/*
 * The staff export's filter grammar: role / status / eventId, each repeatable,
 * all combined as AND. "expired" is DERIVED, not stored — the model only knows
 * active|revoked, so expired means "still active but validTo has passed";
 * selecting active alone therefore excludes lapsed windows, and selecting all
 * three (the UI default) is everything.
 */
function buildStaffAssignmentExportFilter(festId, filters = {}) {
  const query = { festId };
  const roles = filters.roles ?? [];
  const statuses = filters.statuses ?? [];
  const eventIds = filters.eventIds ?? [];

  if (roles.length > 0) {
    query.role = { $in: roles };
  }
  if (statuses.length > 0) {
    const now = new Date();
    const statusBranches = [];
    if (statuses.includes("active")) {
      statusBranches.push({ status: "active", $or: [{ validTo: null }, { validTo: { $gte: now } }] });
    }
    if (statuses.includes("revoked")) {
      statusBranches.push({ status: "revoked" });
    }
    if (statuses.includes("expired")) {
      statusBranches.push({ status: "active", validTo: { $lt: now } });
    }
    if (statusBranches.length > 0) {
      query.$or = statusBranches;
    }
  }
  if (eventIds.length > 0) {
    /*
     * "Staff of these events" includes fest-wide rows (empty eventIds) — a
     * fest-wide coordinator DOES staff every event, and an export that hid them
     * would read as "this event has no coordinator" on race day.
     */
    query.$and = [{ $or: [{ eventIds: { $in: eventIds } }, { eventIds: { $size: 0 } }] }];
  }
  return query;
}

/* The compact filter encoding for the audit row — reviewable, greppable. */
function describeStaffExportFilters(filters = {}) {
  const parts = [];
  if (filters.roles?.length) parts.push(`role=${filters.roles.join(",")}`);
  if (filters.statuses?.length) parts.push(`status=${filters.statuses.join(",")}`);
  if (filters.eventIds?.length) parts.push(`eventId=${filters.eventIds.map(String).join(",")}`);
  return parts.length > 0 ? parts.join(";") : "none";
}

/* The modal's "Will export N rows" preview — same filter builder, count only. */
async function countStaffAssignmentsForExport(festId, filters = {}) {
  const fest = await loadFestOrThrow(festId);
  const expandedEventIds = filters.includeDescendants
    ? await resolveRequestedEventScopeIds(fest._id, {
        requestedEventIds: filters.eventIds,
        includeDescendants: true,
      })
    : filters.eventIds;
  const rowCount = await StaffAssignmentModel.countDocuments(
    buildStaffAssignmentExportFilter(fest._id, {
      ...filters,
      eventIds: expandedEventIds ?? filters.eventIds ?? [],
    })
  );
  return { rowCount };
}

async function streamStaffAssignmentsCsv(actorUserId, festId, response, context = {}, filters = {}) {
  const fest = await loadFestOrThrow(festId);
  // A named parent event expands to its subtree when the caller asked for it.
  const expandedEventIds = filters.includeDescendants
    ? await resolveRequestedEventScopeIds(fest._id, {
        requestedEventIds: filters.eventIds,
        includeDescendants: true,
      })
    : filters.eventIds;
  const resolvedFilters = { ...filters, eventIds: expandedEventIds ?? filters.eventIds ?? [] };
  const { getWorkedHoursByUserId } = require("./volunteer-hours-service");
  const workedHoursByUserId = await getWorkedHoursByUserId(fest._id);
  const cursor = StaffAssignmentModel.find(buildStaffAssignmentExportFilter(fest._id, resolvedFilters))
    // +phoneNumber is a deliberate, named request (select:false) — it is
    // RESOLVED into contactPhone below and never emitted raw.
    .populate({ path: "userId", select: "fullName emailAddress +phoneNumber" })
    .populate({ path: "collegeId", select: "commonName" })
    .populate({ path: "eventIds", select: "eventName" })
    .populate({ path: "revokedByUserId", select: "fullName" })
    .lean()
    .cursor();
  await streamCursorAsCsv({
    response,
    fest,
    exportType: "staff-assignments",
    actorUserId,
    context,
    auditExtra: { filtersApplied: describeStaffExportFilters(resolvedFilters) },
    cursor,
    headerCells: [
      "assignmentId", "fullName", "emailAddress", "contactPhone", "role", "status", "totalHoursWorked",
      "eventNames", "allowedCheckpointTypes", "collegeName", "validFrom", "validTo",
      "assignedAt", "revokedAt", "revokedByFullName", "revocationReason",
    ],
    toCells: (row) => [
      String(row._id),
      row.userId?.fullName ?? "",
      row.userId?.emailAddress ?? "",
      // The prompt-30 resolver rule: override first, personal number second.
      row.assignmentContactPhone ?? row.userId?.phoneNumber ?? "",
      row.role,
      row.status,
      // Volunteers only — every other role has no shifts, and a 0 there would
      // read as "worked nothing" rather than "not applicable".
      row.role === "volunteer" ? String(workedHoursByUserId.get(String(row.userId?._id ?? row.userId)) ?? 0) : "",
      // " · " join; empty string IS the fest-wide signal.
      (row.eventIds ?? []).map((event) => event.eventName ?? "").filter(Boolean).join(" · "),
      (row.allowedCheckpointTypes ?? []).join(" · "),
      row.collegeId?.commonName ?? "",
      row.validFrom?.toISOString?.() ?? "",
      row.validTo?.toISOString?.() ?? "",
      row.createdAt?.toISOString?.() ?? "",
      row.revokedAt?.toISOString?.() ?? "",
      row.revokedByUserId?.fullName ?? "",
      row.revocationReason ?? "",
    ],
  });
}

async function streamCertificatesCsv(actorUserId, festId, response, context = {}) {
  const fest = await loadFestOrThrow(festId);
  const events = await EventModel.find({ festId: fest._id }).select("eventName").lean();
  const eventNameById = new Map(events.map((event) => [String(event._id), event.eventName]));
  const cursor = CertificateModel.find({ festId: fest._id })
    .populate({ path: "userId", select: "fullName emailAddress" })
    .lean()
    .cursor();
  await streamCursorAsCsv({
    response,
    fest,
    exportType: "certificates",
    actorUserId,
    context,
    cursor,
    headerCells: ["certificateId", "verificationCode", "participantFullName", "participantEmailAddress", "certificateType", "eventName", "status", "generatedAt", "releasedAt"],
    toCells: (row) => [
      String(row._id),
      row.verificationCode,
      row.userId?.fullName ?? "",
      row.userId?.emailAddress ?? "",
      row.certificateType,
      row.eventId ? eventNameById.get(String(row.eventId)) ?? "" : "",
      row.status,
      row.generatedAt?.toISOString?.() ?? "",
      row.releasedAt?.toISOString?.() ?? "",
    ],
  });
}

/*
 * Post-event feedback for the whole fest. The comment column is free text a
 * participant typed, so it goes through the same CSV escaping as every other
 * cell — a comment containing a comma or a quote must not shift the columns.
 */
async function streamFeedbackCsv(actorUserId, festId, response, context = {}) {
  const fest = await loadFestOrThrow(festId);
  const events = await EventModel.find({ festId: fest._id }).select("eventName").lean();
  const eventNameById = new Map(events.map((event) => [String(event._id), event.eventName]));
  const cursor = EventFeedbackModel.find({ festId: fest._id })
    .populate({ path: "userId", select: "fullName" })
    .sort({ submittedAt: -1 })
    .lean()
    .cursor();
  await streamCursorAsCsv({
    response,
    fest,
    exportType: "feedback",
    actorUserId,
    context,
    cursor,
    headerCells: ["eventId", "eventName", "userId", "fullName", "rating", "comment", "submittedAt"],
    toCells: (row) => [
      String(row.eventId),
      eventNameById.get(String(row.eventId)) ?? "",
      String(row.userId?._id ?? row.userId ?? ""),
      row.userId?.fullName ?? "",
      String(row.rating),
      row.comment ?? "",
      row.submittedAt?.toISOString?.() ?? "",
    ],
  });
}

/*
 * One round's participant list, for the clipboard a coordinator carries into
 * the hall. Streamed like every other export, though a round is tens of rows
 * rather than thousands — the shared spine also writes the data.exported audit
 * row, and an export that skipped the audit trail because it was small is
 * exactly the gap an audit trail exists to close.
 *
 * advancedToNextRound is derived from the NEXT round's roster rather than
 * stored: advancement IS membership of round N+1, and a duplicate boolean would
 * be one more thing to keep in step with it.
 */
async function streamRoundParticipantsCsv(actorUserId, festId, eventId, roundId, response, context = {}) {
  const fest = await loadFestOrThrow(festId);
  const { RoundModel } = require("../models/round-model");
  const { RoundScoreModel } = require("../models/round-score-model");

  const round = mongoose.Types.ObjectId.isValid(roundId)
    ? await RoundModel.findOne({ _id: roundId, eventId }).lean()
    : null;
  if (!round) {
    throw new ApplicationError(404, ERROR_CODES.ROUND_NOT_FOUND, "Round not found.");
  }
  const event = await EventModel.findById(eventId).select("eventName eventSlug").lean();

  // Scores for THIS round, and the next round's roster for the advanced flag.
  const [scores, nextRound] = await Promise.all([
    RoundScoreModel.find({ roundId: round._id }).select("participantUserId score").lean(),
    RoundModel.findOne({ eventId, roundNumber: round.roundNumber + 1 })
      .select("participantIds")
      .lean(),
  ]);
  const scoreByUserId = new Map(scores.map((row) => [String(row.participantUserId), row.score]));
  const advancedUserIds = new Set(
    (nextRound?.participantIds ?? []).map((participantId) => String(participantId))
  );

  const cursor = UserModel.find({ _id: { $in: round.participantIds ?? [] } })
    // +phoneNumber is select:false on the model and a named request here: this
    // sheet is the coordinator's contact list for the people in the room.
    .select("fullName usn collegeId +phoneNumber")
    .populate({ path: "collegeId", select: "commonName" })
    .sort({ fullName: 1 })
    .lean()
    .cursor();

  await streamCursorAsCsv({
    response,
    /*
     * Same shallow override the check-in sheets use: the shared helper builds
     * "{exportType}-{festSlug}-{date}.csv" and the spec here is
     * "round-{n}-{eventSlug}-{yyyymmdd}.csv", so the event slug rides in the
     * festSlug slot. fest._id survives, so the audit row is still fest-scoped.
     */
    fest: { ...fest, festSlug: event?.eventSlug ?? "event" },
    exportType: `round-${round.roundNumber}`,
    actorUserId,
    context,
    auditExtra: { roundId: String(round._id), roundNumber: round.roundNumber, eventId: String(eventId) },
    cursor,
    headerCells: [
      "participantFullName",
      "usn",
      "collegeName",
      "contactPhone",
      "score",
      "advancedToNextRound",
    ],
    toCells: (row) => {
      const score = scoreByUserId.get(String(row._id));
      return [
        row.fullName ?? "",
        row.usn ?? "",
        row.collegeId?.commonName ?? "",
        row.phoneNumber ?? "",
        // null is "not scored yet", which is not the same as a score of 0.
        score === null || score === undefined ? "" : String(score),
        advancedUserIds.has(String(row._id)) ? "true" : "false",
      ];
    },
  });
  return { roundNumber: round.roundNumber, eventSlug: event?.eventSlug ?? "event" };
}

/* Lightweight per-type counts so the exports tab can label its buttons. */
async function getExportCounts(festId, scope = null) {
  const fest = await loadFestOrThrow(festId);
  const scopedEvents = await resolveScopedEventIds(fest, scope);
  const scopedEventIds = scopedEvents.map((event) => event._id);
  const allEventIds = (await EventModel.find({ festId: fest._id }).select("_id").lean()).map((e) => e._id);
  const checkpointIds = (await CheckpointModel.find({ festId: fest._id }).select("_id").lean()).map(
    (checkpoint) => checkpoint._id
  );
  const [registrations, payments, scans, auditLogs, staffAssignments, certificates, feedback] = await Promise.all([
    RegistrationModel.countDocuments({ eventId: { $in: scopedEventIds } }),
    RegistrationModel.distinct("paymentGroupId", {
      eventId: { $in: allEventIds },
      paymentGroupId: { $ne: null },
    }).then((ids) => PaymentOrderModel.countDocuments({ paymentGroupId: { $in: ids } })),
    ScanModel.countDocuments({ checkpointId: { $in: checkpointIds } }),
    AuditLogModel.countDocuments({ $or: [{ festId: fest._id }, { entityId: { $in: allEventIds } }] }),
    StaffAssignmentModel.countDocuments({ festId: fest._id }),
    CertificateModel.countDocuments({ festId: fest._id }),
    EventFeedbackModel.countDocuments({ festId: fest._id }),
  ]);
  return { registrations, payments, scans, auditLogs, staffAssignments, certificates, feedback };
}

/*
 * ═══ Volunteer checkpoint exports (the volunteer dashboard's two downloads) ═══
 * The caller (backstage controller) has ALREADY authorised the volunteer for
 * this checkpoint via assertVolunteerMayExportCheckpoint; these just stream.
 * Filenames follow the shared convention with the checkpoint riding the slug
 * slot: {kind}-{festSlug}-{yyyymmdd}.csv.
 */

/*
 * Full expected list: everyone holding an ACTIVE entitlement valid at this
 * checkpoint. One aggregate cursor — entitlement → pass (fest scope + person)
 * → user → college, plus, for an event door, the registration row so the
 * per-event contactPhoneOverride wins over the account phone. Rows stream;
 * nothing accumulates.
 */
async function streamVolunteerCheckpointParticipantsCsv(volunteerUserId, checkpoint, entitlementMatch, response, context = {}) {
  const fest = await loadFestOrThrow(checkpoint.festId);

  const pipeline = [
    // fields: entitlementType, referenceId, status
    { $match: { ...entitlementMatch, status: ENTITLEMENT_STATUSES.ACTIVE } },
    { $lookup: { from: "passes", localField: "passId", foreignField: "_id", as: "pass" } },
    { $unwind: "$pass" },
    { $match: { "pass.festId": checkpoint.festId } },
    // one row per person even if they hold duplicate entitlements
    { $group: { _id: "$pass.userId", entitlementType: { $first: "$entitlementType" } } },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $lookup: { from: "colleges", localField: "user.collegeId", foreignField: "_id", as: "college" } },
    { $unwind: { path: "$college", preserveNullAndEmptyArrays: true } },
  ];
  if (checkpoint.eventId) {
    // The event door's contact sheet honours the per-registration override.
    pipeline.push({
      $lookup: {
        from: "registrations",
        let: { participantUserId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$participantUserId"] },
                  { $eq: ["$eventId", checkpoint.eventId] },
                ],
              },
            },
          },
          { $project: { contactPhoneOverride: 1 } },
        ],
        as: "registration",
      },
    });
  }

  const cursor = EntitlementModel.aggregate(pipeline).cursor();
  await streamCursorAsCsv({
    response,
    fest,
    exportType: "checkpoint-participants",
    actorUserId: volunteerUserId,
    context,
    auditExtra: { exportKind: "checkpointParticipants", checkpointId: String(checkpoint._id), volunteerUserId: String(volunteerUserId) },
    headerCells: ["fullName", "usn", "collegeName", "contactPhone", "entitlementType"],
    toCells: (row) => [
      row.user?.fullName ?? "",
      row.user?.usn ?? "",
      row.college?.commonName ?? "",
      // Single resolved contact, same rule as the roster: override, else account.
      row.registration?.[0]?.contactPhoneOverride ?? row.user?.phoneNumber ?? "",
      row.entitlementType,
    ],
    cursor,
  });
}

/*
 * Checked-in list: distinct participants with an accepted IN scan here, with
 * their FIRST in-time. The $group both dedupes and takes $min scannedAt, so the
 * cursor still streams one row per person.
 */
async function streamVolunteerCheckpointCheckedInCsv(volunteerUserId, checkpoint, response, context = {}) {
  const fest = await loadFestOrThrow(checkpoint.festId);

  const cursor = ScanModel.aggregate([
    // fields: checkpointId, result, direction, passId, scannedAt
    { $match: { checkpointId: checkpoint._id, result: SCAN_RESULTS.ACCEPTED, direction: SCAN_DIRECTIONS.IN } },
    { $group: { _id: "$passId", firstScannedAt: { $min: "$scannedAt" } } },
    { $lookup: { from: "passes", localField: "_id", foreignField: "_id", as: "pass" } },
    { $unwind: "$pass" },
    { $lookup: { from: "users", localField: "pass.userId", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $sort: { firstScannedAt: 1 } },
  ]).cursor();

  await streamCursorAsCsv({
    response,
    fest,
    exportType: "checkpoint-checked-in",
    actorUserId: volunteerUserId,
    context,
    auditExtra: { exportKind: "checkpointCheckedIn", checkpointId: String(checkpoint._id), volunteerUserId: String(volunteerUserId) },
    headerCells: ["fullName", "usn", "firstCheckedInAt"],
    toCells: (row) => [
      row.user?.fullName ?? "",
      row.user?.usn ?? "",
      row.firstScannedAt?.toISOString?.() ?? "",
    ],
    cursor,
  });
}

/*
 * Checked OUT: same shape as checked-in but direction OUT. Grouped on first
 * out-scan so someone who left and re-entered twice is one row, not three.
 */
async function streamVolunteerCheckpointCheckedOutCsv(volunteerUserId, checkpoint, response, context = {}) {
  const fest = await loadFestOrThrow(checkpoint.festId);

  const cursor = ScanModel.aggregate([
    // fields: checkpointId, result, direction, passId, scannedAt
    { $match: { checkpointId: checkpoint._id, result: SCAN_RESULTS.ACCEPTED, direction: SCAN_DIRECTIONS.OUT } },
    { $group: { _id: "$passId", firstScannedAt: { $min: "$scannedAt" } } },
    { $lookup: { from: "passes", localField: "_id", foreignField: "_id", as: "pass" } },
    { $unwind: "$pass" },
    { $lookup: { from: "users", localField: "pass.userId", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $sort: { firstScannedAt: 1 } },
  ]).cursor();

  await streamCursorAsCsv({
    response,
    fest,
    exportType: "checkpoint-checked-out",
    actorUserId: volunteerUserId,
    context,
    auditExtra: { exportKind: "checkpointCheckedOut", checkpointId: String(checkpoint._id), volunteerUserId: String(volunteerUserId) },
    headerCells: ["fullName", "usn", "firstCheckedOutAt"],
    toCells: (row) => [
      row.user?.fullName ?? "",
      row.user?.usn ?? "",
      row.firstScannedAt?.toISOString?.() ?? "",
    ],
    cursor,
  });
}

/*
 * Yet to check in: everyone the checkpoint admits, minus anyone with an
 * accepted IN scan. The subtraction runs inside the pipeline — pulling both
 * lists into memory to diff them would fall over on a large fest.
 */
async function streamVolunteerCheckpointYetToCheckInCsv(volunteerUserId, checkpoint, entitlementMatch, response, context = {}) {
  const fest = await loadFestOrThrow(checkpoint.festId);

  const cursor = EntitlementModel.aggregate([
    // fields: entitlementType, referenceId, status, passId
    { $match: { ...entitlementMatch, status: ENTITLEMENT_STATUSES.ACTIVE } },
    { $lookup: { from: "passes", localField: "passId", foreignField: "_id", as: "pass" } },
    { $unwind: "$pass" },
    { $match: { "pass.festId": checkpoint.festId } },
    { $group: { _id: "$pass.userId", passId: { $first: "$pass._id" } } },
    /* the subtraction: keep only people whose pass has NO accepted IN scan here */
    {
      $lookup: {
        from: "scans",
        let: { passId: "$passId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$passId", "$$passId"] },
                  { $eq: ["$checkpointId", checkpoint._id] },
                  { $eq: ["$result", SCAN_RESULTS.ACCEPTED] },
                  { $eq: ["$direction", SCAN_DIRECTIONS.IN] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "inScan",
      },
    },
    { $match: { inScan: { $size: 0 } } },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $sort: { "user.fullName": 1 } },
  ]).cursor();

  await streamCursorAsCsv({
    response,
    fest,
    exportType: "checkpoint-yet-to-checkin",
    actorUserId: volunteerUserId,
    context,
    auditExtra: { exportKind: "checkpointYetToCheckIn", checkpointId: String(checkpoint._id), volunteerUserId: String(volunteerUserId) },
    headerCells: ["fullName", "usn"],
    toCells: (row) => [row.user?.fullName ?? "", row.user?.usn ?? ""],
    cursor,
  });
}

/*
 * ── The coordinator event page's four stat-tile downloads ────────────────────
 *
 * These four existed as controller calls only: backstage-controller invoked
 * streamCoordinatorEvent*Csv, but no such functions were ever written here —
 * every coordinator download threw "not a function" (a 500 the frontend showed
 * as a failed download) while the volunteer checkpoint exports worked.
 *
 * Authorization: an ACTIVE coordinator/admin assignment on the event's fest
 * whose coverage includes this event — the same rule the scanner uses.
 */
async function assertMayExportEvent(actorUserId, eventId) {
  const event = await EventModel.findById(eventId).lean();
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const assignments = await StaffAssignmentModel.find({
    userId: actorUserId,
    festId: event.festId,
    role: { $in: [STAFF_ROLES.COORDINATOR, STAFF_ROLES.ADMINISTRATOR] },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();
  for (const assignment of assignments) {
    if (assignment.role === STAFF_ROLES.ADMINISTRATOR) return event;
    if (await assignmentCoversEvent(assignment, eventId)) return event;
  }
  throw new ApplicationError(403, ERROR_CODES.FORBIDDEN, "You do not coordinate this event.");
}

/* Everyone CONFIRMED on the event, streamed. */
async function streamCoordinatorEventParticipantsCsv(actorUserId, eventId, response, context = {}) {
  const event = await assertMayExportEvent(actorUserId, eventId);
  const fest = await loadFestOrThrow(event.festId);

  const cursor = RegistrationModel.aggregate([
    { $match: { eventId: event._id, status: REGISTRATION_STATUSES.CONFIRMED } },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $sort: { "user.fullName": 1 } },
  ]).cursor();

  await streamCursorAsCsv({
    response,
    fest,
    exportType: `event-participants`,
    actorUserId,
    context,
    auditExtra: { exportKind: "eventParticipants", eventId: String(event._id) },
    headerCells: ["fullName", "usn", "emailAddress"],
    toCells: (row) => [row.user?.fullName ?? "", row.user?.usn ?? "", row.user?.emailAddress ?? ""],
    cursor,
  });
}

/* One row per person with an accepted IN scan on this event's checkpoints. */
function eventScanCursor(event, direction) {
  return ScanModel.aggregate([
    {
      $lookup: { from: "checkpoints", localField: "checkpointId", foreignField: "_id", as: "checkpoint" },
    },
    { $unwind: "$checkpoint" },
    {
      $match: {
        result: SCAN_RESULTS.ACCEPTED,
        direction,
        "checkpoint.festId": event.festId,
        /* Event-bound checkpoints must match the event; fest-wide gates count
         * for every event of the fest. */
        $or: [{ "checkpoint.eventId": event._id }, { "checkpoint.eventId": null }],
      },
    },
    { $group: { _id: "$passId", firstScannedAt: { $min: "$scannedAt" } } },
    { $lookup: { from: "passes", localField: "_id", foreignField: "_id", as: "pass" } },
    { $unwind: "$pass" },
    { $lookup: { from: "users", localField: "pass.userId", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $sort: { firstScannedAt: 1 } },
  ]).cursor();
}

async function streamCoordinatorEventCheckedInCsv(actorUserId, eventId, response, context = {}) {
  const event = await assertMayExportEvent(actorUserId, eventId);
  const fest = await loadFestOrThrow(event.festId);
  await streamCursorAsCsv({
    response, fest, exportType: "event-checked-in", actorUserId, context,
    auditExtra: { exportKind: "eventCheckedIn", eventId: String(event._id) },
    headerCells: ["fullName", "usn", "firstCheckedInAt"],
    toCells: (row) => [row.user?.fullName ?? "", row.user?.usn ?? "", row.firstScannedAt?.toISOString?.() ?? ""],
    cursor: eventScanCursor(event, SCAN_DIRECTIONS.IN),
  });
}

async function streamCoordinatorEventCheckedOutCsv(actorUserId, eventId, response, context = {}) {
  const event = await assertMayExportEvent(actorUserId, eventId);
  const fest = await loadFestOrThrow(event.festId);
  await streamCursorAsCsv({
    response, fest, exportType: "event-checked-out", actorUserId, context,
    auditExtra: { exportKind: "eventCheckedOut", eventId: String(event._id) },
    headerCells: ["fullName", "usn", "firstCheckedOutAt"],
    toCells: (row) => [row.user?.fullName ?? "", row.user?.usn ?? "", row.firstScannedAt?.toISOString?.() ?? ""],
    cursor: eventScanCursor(event, SCAN_DIRECTIONS.OUT),
  });
}

/* Registered minus checked-in, subtracted inside the pipeline. */
async function streamCoordinatorEventYetToCheckInCsv(actorUserId, eventId, response, context = {}) {
  const event = await assertMayExportEvent(actorUserId, eventId);
  const fest = await loadFestOrThrow(event.festId);

  const cursor = RegistrationModel.aggregate([
    { $match: { eventId: event._id, status: REGISTRATION_STATUSES.CONFIRMED } },
    {
      $lookup: {
        from: "scans",
        let: { participantId: "$userId" },
        pipeline: [
          { $lookup: { from: "passes", localField: "passId", foreignField: "_id", as: "pass" } },
          { $unwind: "$pass" },
          { $lookup: { from: "checkpoints", localField: "checkpointId", foreignField: "_id", as: "checkpoint" } },
          { $unwind: "$checkpoint" },
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$pass.userId", "$$participantId"] },
                  { $eq: ["$result", SCAN_RESULTS.ACCEPTED] },
                  { $eq: ["$direction", SCAN_DIRECTIONS.IN] },
                  { $eq: ["$checkpoint.festId", event.festId] },
                  { $or: [{ $eq: ["$checkpoint.eventId", event._id] }, { $eq: ["$checkpoint.eventId", null] }] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "inScan",
      },
    },
    { $match: { inScan: { $size: 0 } } },
    { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $sort: { "user.fullName": 1 } },
  ]).cursor();

  await streamCursorAsCsv({
    response, fest, exportType: "event-yet-to-checkin", actorUserId, context,
    auditExtra: { exportKind: "eventYetToCheckIn", eventId: String(event._id) },
    headerCells: ["fullName", "usn"],
    toCells: (row) => [row.user?.fullName ?? "", row.user?.usn ?? ""],
    cursor,
  });
}

module.exports = {
  assertMayExportEvent,
  streamCoordinatorEventParticipantsCsv,
  streamCoordinatorEventCheckedInCsv,
  streamCoordinatorEventCheckedOutCsv,
  streamCoordinatorEventYetToCheckInCsv,
  streamVolunteerCheckpointCheckedOutCsv,
  streamVolunteerCheckpointYetToCheckInCsv,
  streamRegistrationsCsv,
  streamEventScanDirectionCsv,
  streamPaymentsCsv,
  streamScansCsv,
  streamAuditLogCsv,
  streamStaffAssignmentsCsv,
  streamCertificatesCsv,
  streamFeedbackCsv,
  streamRoundParticipantsCsv,
  streamVolunteerCheckpointParticipantsCsv,
  streamVolunteerCheckpointCheckedInCsv,
  getExportCounts,
  countStaffAssignmentsForExport,
};
