const mongoose = require("mongoose");

const { TeamModel } = require("../models/team-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { FEST_VISIBILITIES } = require("../constants/fest-constants");
const { TEAM_STATUSES } = require("../constants/team-constants");
const { ACTIVE_REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { findOrCreateUserByEmailAddress } = require("./staff-assignment-helpers");
const { belongsToHostCollege } = require("./registration-guards");
const { sendTeamInvitationEmail } = require("../services/email-service");
const { applicationConfig } = require("../config/application-config");

/* Assembling and vetting a roster, before any of it is committed. */
function buildTeamRoster(leader, memberEmails) {
  const roster = memberEmails.filter((email) => email !== leader.emailAddress);
  return [leader.emailAddress, ...roster];
}

function assertTeamSize(size, event) {
  if (size < event.minimumTeamSize || size > event.maximumTeamSize) {
    throw new ApplicationError(400, ERROR_CODES.INVALID_TEAM_SIZE, "The team size is out of range.", { min: event.minimumTeamSize, max: event.maximumTeamSize });
  }
}

/* One member per email, creating a placeholder for any that has never signed in. */

async function resolveMembers(emails) {
  const members = [];
  for (const email of emails) {
    const { user } = await findOrCreateUserByEmailAddress(email);
    if (user.isBlocked) {
      throw new ApplicationError(403, ERROR_CODES.TEAM_MEMBER_BLOCKED, "A member of this team is blocked.", { blockedEmail: email });
    }
    /*
     * KNOWN GAP, deliberately left open pending a product decision — see
     * docs/contact-number-coverage.md.
     *
     * findOrCreateUserByEmailAddress above mints a PLACEHOLDER user for an
     * unknown email, and the caller then issues that member a pass and a door
     * entitlement. A placeholder has no phoneNumber (and no isProfileComplete),
     * so this is the ONE registration path that can seat a team member with no
     * contact number on file. Every other entry point — solo registration, team
     * create, team code join, contingent accept — routes through
     * loadRegisterableUser, which refuses an incomplete profile.
     *
     * Closing it by refusing incomplete members here would disable
     * invite-a-teammate-who-has-no-account-yet, which is an intended, tested
     * feature of this path. The fix therefore needs the client to choose; the
     * document above records both options.
     */
    members.push({ email, user });
  }
  return members;
}

function assertTeamCollege(members, fest) {
  if (fest.visibility !== FEST_VISIBILITIES.INTRA_COLLEGE) {
    return;
  }
  const outsider = members.find((member) => !belongsToHostCollege(member.user, fest));
  if (outsider) {
    throw new ApplicationError(403, ERROR_CODES.WRONG_COLLEGE, "Every team member must belong to the host college.", { wrongMemberEmail: outsider.email });
  }
}

/* No member may already sit on another team for this event, nor hold their own active registration. */

async function assertMembersFree(members, eventId) {
  for (const member of members) {
    const onTeam = await TeamModel.findOne({
      eventId,
      memberUserIds: member.user._id,
      status: { $ne: TEAM_STATUSES.DISQUALIFIED },
    });
    if (onTeam) {
      throw new ApplicationError(409, ERROR_CODES.MEMBER_ALREADY_IN_TEAM, "A member is already on a team for this event.", { conflictingMemberEmail: member.email });
    }
    const registered = await RegistrationModel.findOne({
      eventId,
      userId: member.user._id,
      status: { $in: ACTIVE_REGISTRATION_STATUSES },
    });
    if (registered) {
      throw new ApplicationError(409, ERROR_CODES.ALREADY_REGISTERED, "A member is already registered for this event.", { conflictingMemberEmail: member.email });
    }
  }
}

/* Teams are never waitlisted for the MVP: the whole roster fits or the attempt fails. */

async function notifyTeammates(members, leader, team, event, fest) {
  const teammates = members.filter((member) => !member.user._id.equals(leader._id));
  await Promise.all(
    teammates.map((member) =>
      sendTeamInvitationEmail({
        memberEmail: member.email,
        teamName: team.teamName,
        eventName: event.eventName,
        festName: fest.festName,
        festBannerImageUrl: fest.bannerImageUrl ?? null,
        leaderName: leader.fullName || leader.emailAddress,
        signInUrl: applicationConfig.frontendBaseUrl,
      })
    )
  );
}

module.exports = {
  buildTeamRoster,
  assertTeamSize,
  resolveMembers,
  assertTeamCollege,
  assertMembersFree,
  notifyTeammates,
};
