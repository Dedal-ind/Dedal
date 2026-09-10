const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { AchievementModel } = require("../models/achievement-model");
const { FestModel } = require("../models/fest-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_SCORING_FORMATS } = require("../constants/event-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { ACHIEVEMENT_TYPES } = require("../constants/achievement-constants");
const { EventScoreModel } = require("../models/event-score-model");

const LEADERBOARD_TOP_LIMIT = 10;

/*
 * The admin's consolidated results board: every event of the fest with its
 * leaderboard (top 10) — or, for a bracket event, the winner read from the
 * WINNER_1ST registration the final match stamped. One call; the frontend
 * renders. Coordinator-or-admin scoped at the route, like the analytics summary.
 */
async function getResultsBoard(festId) {
  const fest = await FestModel.findById(festId).select("_id").lean();
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }

  const events = await EventModel.find({ festId: fest._id })
    .select("eventName scoringFormat category startsAt status")
    .sort({ startsAt: 1 })
    .lean();

  const board = [];
  for (const event of events) {
    const isBracket = event.scoringFormat === EVENT_SCORING_FORMATS.BRACKET_SINGLE_ELIMINATION;
    const confirmedCount = await RegistrationModel.countDocuments({
      eventId: event._id,
      status: {
        $in: [
          REGISTRATION_STATUSES.CONFIRMED,
          REGISTRATION_STATUSES.ATTENDED,
          REGISTRATION_STATUSES.WINNER_1ST,
          REGISTRATION_STATUSES.WINNER_2ND,
          REGISTRATION_STATUSES.WINNER_3RD,
          REGISTRATION_STATUSES.ELIMINATED,
        ],
      },
    });
    const achievementCount = await AchievementModel.countDocuments({
      eventId: event._id,
      achievementType: ACHIEVEMENT_TYPES.EVENT_RESULT,
    });

    let leaderboard = [];
    let bracketWinnerName = null;
    if (isBracket) {
      // The final match stamps its winner's registration WINNER_1ST — that row
      // IS the result; a bracket has no running leaderboard to show.
      const winnerRegistration = await RegistrationModel.findOne({
        eventId: event._id,
        status: REGISTRATION_STATUSES.WINNER_1ST,
      })
        .populate({ path: "userId", select: "fullName" })
        .populate({ path: "teamId", select: "teamName" })
        .lean();
      bracketWinnerName =
        winnerRegistration?.teamId?.teamName ?? winnerRegistration?.userId?.fullName ?? null;
    } else {
      /*
       * Parallel to score-service.getLeaderboard, WITHOUT its
       * isLeaderboardVisible gate — that flag hides the board from
       * participants; the organiser's results board must show it regardless.
       */
      const scores = await EventScoreModel.find({ eventId: event._id })
        .sort({ score: -1, updatedAt: 1 })
        .limit(LEADERBOARD_TOP_LIMIT)
        .populate("userId", "fullName")
        .populate("teamId", "teamName")
        .lean();
      leaderboard = scores.map((scoreRow, index) => ({
        rank: index + 1,
        score: scoreRow.score,
        isFinalized: scoreRow.isFinalized,
        fullName: scoreRow.userId?.fullName ?? null,
        teamName: scoreRow.teamId?.teamName ?? null,
      }));
    }

    board.push({
      eventId: String(event._id),
      eventName: event.eventName,
      scoringFormat: event.scoringFormat,
      category: event.category,
      startsAt: event.startsAt,
      confirmedCount,
      achievementCount,
      leaderboard,
      bracketWinnerName,
    });
  }
  return { events: board };
}

module.exports = { getResultsBoard };
