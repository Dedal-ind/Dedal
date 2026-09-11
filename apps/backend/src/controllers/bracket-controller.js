const bracketService = require("../services/bracket-service");
const { FestModel } = require("../models/fest-model");
const { extractRequestContext } = require("../helpers/request-context");
const { hasAdministratorAuthority } = require("../helpers/administrator-helpers");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

/*
 * expectedVersion rides in the body of every match write. It is read here rather
 * than destructured alongside the result fields because it is not part of the
 * result — it says which copy of the match the caller was looking at when they
 * typed it, and the service needs it before it will consider the rest.
 */
function staffOptions(request) {
  return {
    actorUserId: request.authenticatedUser.userId,
    isAdministrator: Boolean(request.isAdministrator),
    festId: request.params.festId,
    expectedVersion: (request.body || {}).expectedVersion,
    context: extractRequestContext(request),
  };
}

async function postGenerateBracket(request, response) {
  const { festId, eventId } = request.params;
  const matches = await bracketService.generateBracketForEvent(festId, eventId, staffOptions(request));
  return response.status(201).json({ data: matches });
}

/*
 * Force-regeneration is an administrator act with its own route and its own
 * middleware, so the reason is all that needs pulling out of the body here.
 */
async function postForceRegenerateBracket(request, response) {
  const { festId, eventId } = request.params;
  const { regenerationReason } = request.body || {};
  const matches = await bracketService.forceRegenerateBracket(festId, eventId, {
    ...staffOptions(request),
    regenerationReason,
  });
  return response.status(200).json({ data: matches });
}

/*
 * This route carries only the authentication gate — a participant reads their
 * own bracket through it — so request.isAdministrator is never populated here
 * and cannot be trusted. The check is made directly against the assignment, and
 * only when the archive is actually asked for, so the ordinary read stays a
 * single query.
 */
async function isAdministratorOfFest(request, festId) {
  const fest = await FestModel.findById(festId).select("hostCollegeId").lean();
  if (!fest) {
    return false;
  }
  return hasAdministratorAuthority(request.authenticatedUser.userId, fest.hostCollegeId);
}

/*
 * Public to any authenticated user: participants read the bracket too.
 *
 * includeSuperseded is honoured only for an administrator. The archive is an
 * audit surface, and a participant reading their own bracket has no business
 * seeing a buried result — nor any way to tell it apart from a live one. A
 * non-admin who asks gets the live bracket rather than a 403: they have asked
 * for something they cannot have, not done something wrong.
 */
async function getBracket(request, response) {
  const { festId, eventId } = request.params;
  const event = await bracketService.loadEventOrThrow(festId, eventId);
  const includeSuperseded =
    request.query.includeSuperseded === "true" && (await isAdministratorOfFest(request, festId));
  const matches = await bracketService.getBracket(event._id, { includeSuperseded });
  return response.status(200).json({ data: matches });
}

async function patchMatch(request, response) {
  const { eventId, matchId } = request.params;
  const {
    winnerUserId,
    winnerTeamId,
    participantAScore,
    participantBScore,
    decisionType,
    scoresheetImageUrl,
  } = request.body || {};

  const match = await bracketService.enterMatchResult(
    eventId,
    matchId,
    { winnerUserId, winnerTeamId, participantAScore, participantBScore, decisionType, scoresheetImageUrl },
    staffOptions(request)
  );
  return response.status(200).json({ data: match });
}

/*
 * Blanks are dropped rather than rejected: a comma-separated box collects them
 * from ordinary typing ("Asha, Ravi, ") and an error about an empty judge nobody
 * meant to enter helps no one. An absent field means "leave the judges alone";
 * an empty array means "clear them".
 */
function parseJudgeNames(rawValue) {
  if (rawValue === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawValue)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "judgeNames must be a list.", {
      judgeNames: "must be an array of names",
    });
  }
  return rawValue
    .filter((name) => typeof name === "string")
    .map((name) => name.trim())
    .filter(Boolean);
}

/*
 * A URL, a judging panel, or both — but not neither. The two are independent
 * because they arrive independently: the sheet is scanned at the desk and the
 * panel is confirmed whenever someone gets round to it.
 */
async function postScoresheet(request, response) {
  const { eventId, matchId } = request.params;
  const { scoresheetImageUrl } = request.body || {};
  const judgeNames = parseJudgeNames((request.body || {}).judgeNames);

  const hasUrl = typeof scoresheetImageUrl === "string" && scoresheetImageUrl.trim().length > 0;
  if (!hasUrl && judgeNames === undefined) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "A scoresheet image URL is required.", {
      scoresheetImageUrl: "is required",
    });
  }

  const match = await bracketService.setScoresheet(
    eventId,
    matchId,
    hasUrl ? scoresheetImageUrl : null,
    { ...staffOptions(request), judgeNames }
  );
  return response.status(200).json({ data: match });
}

module.exports = {
  postGenerateBracket,
  postForceRegenerateBracket,
  getBracket,
  patchMatch,
  postScoresheet,
};
