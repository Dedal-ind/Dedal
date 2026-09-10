const { TeamModel } = require("../models/team-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { TEAM_STATUSES } = require("../constants/team-constants");
const {
  REGISTRATION_STATUSES,
  ACTIVE_REGISTRATION_STATUSES,
  CANCELLED_BY_ROLES,
} = require("../constants/registration-constants");
const { releaseTeamSeats } = require("./registration-seat-helpers");
const { revokeEventEntitlementOnCancel } = require("../services/pass-service");

/*
 * A team seat is not the member's to give up: the roster was submitted as one
 * unit by the leader, and a member walking out alone would leave a team below
 * its minimum size. Only the leader may cancel, and doing so cancels everyone.
 *
 * Staff bypass the leader check — a coordinator striking a team off their event
 * is not the leader and must not have to be.
 */
/*
 * Takes the event document rather than an id: the caller has already loaded it,
 * and releaseTeamSeats needs its capacity to know whether these seats were ever
 * counted. Re-reading it here would be a second query for data already in hand.
 */
async function cancelTeamRegistration(userId, event, festId, registration, cancellation = {}) {
  const eventId = event._id;
  const team = await TeamModel.findById(registration.teamId);
  const isSelfPolicy = cancellation.policy === undefined || cancellation.policy === CANCELLED_BY_ROLES.SELF;
  if (!team || (isSelfPolicy && String(team.leaderUserId) !== String(userId))) {
    throw new ApplicationError(403, ERROR_CODES.TEAM_CANCEL_LEADER_ONLY, "Only the team leader can cancel.");
  }
  /*
   * ACTIVE_REGISTRATION_STATUSES includes waitlisted, while claimTeamSeats only
   * ever counted confirmed rows. Harmless today — teams cannot waitlist — but
   * the moment waitlist auto-promotion ships for teams, this count and the one
   * that was incremented stop agreeing and releaseTeamSeats gives back seats
   * nobody took. Whoever builds team waitlisting has to revisit this line.
   */
  const activeMemberRegistrations = await RegistrationModel.find({
    teamId: team._id,
    status: { $in: ACTIVE_REGISTRATION_STATUSES },
  });

  team.status = TEAM_STATUSES.DISQUALIFIED;
  await team.save();
  await RegistrationModel.updateMany(
    { teamId: team._id, status: { $in: ACTIVE_REGISTRATION_STATUSES } },
    {
      $set: {
        status: REGISTRATION_STATUSES.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: cancellation.reason || "team leader cancelled",
        cancelledByRole: cancellation.policy || CANCELLED_BY_ROLES.SELF,
        cancelledByUserId: cancellation.actorUserId || userId,
      },
    }
  );

  // Each member loses their event-entry entitlement; the pass and its gate access stay.
  for (const memberRegistration of activeMemberRegistrations) {
    await revokeEventEntitlementOnCancel(memberRegistration.userId, festId, eventId);
  }

  const teamSize = activeMemberRegistrations.length;
  const updatedEvent = await releaseTeamSeats(event, teamSize);
  return { cancelledCount: teamSize, event: updatedEvent.toJSON() };
}

module.exports = { cancelTeamRegistration };
