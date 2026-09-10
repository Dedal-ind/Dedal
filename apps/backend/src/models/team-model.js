const mongoose = require("mongoose");
const { TEAM_STATUSES } = require("../constants/team-constants");
const { TEAM_NAME_MIN_LENGTH, TEAM_NAME_MAX_LENGTH, INVITE_CODE_LENGTH } = require("../constants/registration-constants");

const teamSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    teamName: {
      type: String,
      required: true,
      trim: true,
      minlength: TEAM_NAME_MIN_LENGTH,
      maxlength: TEAM_NAME_MAX_LENGTH,
    },
    leaderUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Includes the leader; the hook below enforces that.
    memberUserIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      required: true,
      validate: { validator: (value) => value.length >= 1, message: "A team needs at least one member." },
    },
    /*
     * The member who speaks for the team on the ground — the person a
     * coordinator calls when a match is about to start.
     *
     * Distinct from leaderUserId, deliberately. The leader is whoever CREATED
     * the team and is fixed by that act; the captain is claimed afterwards by
     * whichever member is actually turning up to run things, and on most teams
     * those are different people. null means nobody has claimed it yet, which is
     * every team that existed before this field.
     */
    captainUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    inviteCode: {
      type: String,
      required: true,
      uppercase: true,
      minlength: INVITE_CODE_LENGTH,
      maxlength: INVITE_CODE_LENGTH,
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(TEAM_STATUSES),
      default: TEAM_STATUSES.LOCKED,
    },
  },
  { timestamps: true }
);

/* The leader is always one of the members, so a leader can never sit outside their own team. */
teamSchema.pre("validate", function ensureLeaderIsMember(next) {
  const hasLeader = (this.memberUserIds || []).some((memberId) => memberId.equals(this.leaderUserId));
  if (!hasLeader) {
    this.invalidate("memberUserIds", "memberUserIds must include the leaderUserId.");
  }
  return next();
});

teamSchema.index({ eventId: 1 }, { name: "index_teams_eventId" });
teamSchema.index({ inviteCode: 1 }, { name: "index_teams_inviteCode", unique: true });
teamSchema.index({ leaderUserId: 1 }, { name: "index_teams_leaderUserId" });

teamSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const TeamModel = mongoose.model("Team", teamSchema, "teams");

module.exports = { TeamModel };
