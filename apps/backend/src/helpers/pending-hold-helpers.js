const { TeamModel } = require("../models/team-model");
const { RegistrationModel } = require("../models/registration-model");
const { PaymentOrderModel } = require("../models/payment-order-model");
const { TEAM_STATUSES } = require("../constants/team-constants");
const {
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
} = require("../constants/registration-constants");
const { releaseTeamSeats } = require("./registration-seat-helpers");

/*
 * A pending-payment hold is a paid registration that took its seat but has not
 * paid yet: for a team it is the leader's LOCKED team plus its member rows, for a
 * solo it is the single row. This helper answers the two questions the retry and
 * cancel paths ask of one — "does the caller already hold one here" and "give it
 * back" — in one place so their seat arithmetic cannot drift from the claim's.
 *
 * The seat count released is deliberately the number of PENDING_PAYMENT rows, not
 * ACTIVE_REGISTRATION_STATUSES rows: a pending hold's rows are none of the active
 * statuses, so the cancellation path's helpers (which count active rows) would
 * release nothing and leak the held seats upward for good.
 */

/*
 * The caller's own pending hold for an event, or null. Team is matched by
 * leadership — only the leader may supersede or cancel the roster, exactly as the
 * cancellation path enforces — and solo by the row's own owner.
 */
async function findCallerPendingHold(userId, eventId) {
  const team = await TeamModel.findOne({
    eventId,
    leaderUserId: userId,
    status: { $ne: TEAM_STATUSES.DISQUALIFIED },
  });
  if (team) {
    const registrations = await RegistrationModel.find({
      teamId: team._id,
      status: REGISTRATION_STATUSES.PENDING_PAYMENT,
    });
    if (registrations.length > 0) {
      return { kind: "team", team, registrations, paymentGroupId: registrations[0].paymentGroupId };
    }
  }

  const soloRegistration = await RegistrationModel.findOne({
    eventId,
    userId,
    teamId: null,
    status: REGISTRATION_STATUSES.PENDING_PAYMENT,
  });
  if (soloRegistration) {
    return {
      kind: "solo",
      team: null,
      registrations: [soloRegistration],
      paymentGroupId: soloRegistration.paymentGroupId,
    };
  }

  return null;
}

/*
 * Whether a hold ever opened a Razorpay order. A hold with an order is a real
 * checkout in flight — the caller must resume or explicitly cancel it. A hold
 * without one can never be paid (the order create is what failed), so it is safe
 * to supersede silently on the caller's own retry.
 */
async function pendingHoldHasPaymentOrder(paymentGroupId) {
  if (!paymentGroupId) {
    return false;
  }
  const order = await PaymentOrderModel.findOne({ paymentGroupId }).select("_id").lean();
  return Boolean(order);
}

/*
 * Terminates a pending hold and gives back exactly the seats it claimed: each
 * PENDING_PAYMENT row held one counted seat (claimTeamSeats/claimSoloSeat
 * incremented once per member on a capped event), so releaseTeamSeats gives back
 * the row count — and no-ops on an uncapped event, mirroring the claim.
 */
async function releasePendingHold(event, hold) {
  await RegistrationModel.updateMany(
    { _id: { $in: hold.registrations.map((registration) => registration._id) } },
    {
      $set: {
        status: REGISTRATION_STATUSES.PAYMENT_EXPIRED,
        paymentStatus: PAYMENT_STATUSES.EXPIRED,
      },
    }
  );
  if (hold.team) {
    await TeamModel.updateOne(
      { _id: hold.team._id },
      { $set: { status: TEAM_STATUSES.DISQUALIFIED } }
    );
  }
  return releaseTeamSeats(event, hold.registrations.length);
}

module.exports = {
  findCallerPendingHold,
  pendingHoldHasPaymentOrder,
  releasePendingHold,
};
