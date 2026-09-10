const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { ContingentModel } = require("../models/contingent-model");
const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { UserModel } = require("../models/user-model");
const { applicationConfig } = require("../config/application-config");
const { sendMailQuietly } = require("./email-service");
const { CONTINGENT_CLAIM_STATUSES } = require("../constants/contingent-constants");

/*
 * The attendee invitation layer — F's DPDP mechanics. Fired only AFTER the
 * buyer's payment captures (an invite to an unpaid bundle would summon people to
 * seats that may lapse). ONE email per attendee, even when they are named on
 * several sub-events of the purchase. Same silent-fail contract as every other
 * sender: the claims are already persisted, and a dead provider must not undo a
 * paid purchase.
 */

function buildSignInLink(emailAddress) {
  // Deep link into the email sign-in screen, pre-filled with the address the
  // buyer gave — the attendee proves control of the mailbox themselves.
  return `${applicationConfig.frontendBaseUrl}/auth/email?emailAddress=${encodeURIComponent(emailAddress)}`;
}

async function sendContingentInviteEmails(contingentPurchaseGroupId) {
  const claims = await ContingentClaimModel.find({
    contingentPurchaseGroupId,
    // Buyer self-claims auto-accept at confirmation and get no invite (I.1).
    claimStatus: CONTINGENT_CLAIM_STATUSES.INVITED,
  }).lean();
  if (claims.length === 0) {
    return { sentCount: 0 };
  }

  const [contingent, fest, buyer, events] = await Promise.all([
    ContingentModel.findById(claims[0].contingentId).select("contingentName").lean(),
    FestModel.findById(claims[0].festId).select("festName").lean(),
    UserModel.findById(claims[0].buyerUserId).select("fullName emailAddress").lean(),
    EventModel.find({ _id: { $in: claims.map((claim) => claim.eventId) } })
      .select("eventName")
      .lean(),
  ]);
  const eventNameById = new Map(events.map((event) => [String(event._id), event.eventName]));
  const buyerName = buyer?.fullName || buyer?.emailAddress || "Someone";

  // One email per attendee address, covering every sub-event they are named on.
  const claimsByEmailAddress = new Map();
  for (const claim of claims) {
    const address = claim.attendeeEmailAddress;
    if (!claimsByEmailAddress.has(address)) {
      claimsByEmailAddress.set(address, []);
    }
    claimsByEmailAddress.get(address).push(claim);
  }

  let sentCount = 0;
  for (const [emailAddress, attendeeClaims] of claimsByEmailAddress) {
    const attendeeUser = attendeeClaims[0].attendeeUserId
      ? await UserModel.findById(attendeeClaims[0].attendeeUserId)
          .select("isProfileComplete")
          .lean()
      : null;
    const eventLines = attendeeClaims
      .map((claim) => `  - ${eventNameById.get(String(claim.eventId)) ?? "an event"}`)
      .join("\n");

    /*
     * A profile-complete user has signed in before: they get the lighter notice
     * pointing at /my-registrations, where the claims render as pending cards.
     * A placeholder user gets the full invite with the pre-filled sign-in link.
     */
    const hasSignedInBefore = Boolean(attendeeUser?.isProfileComplete);
    const messageBody = hasSignedInBefore
      ? `${buyerName} has included you in the contingent "${contingent?.contingentName}" for ${fest?.festName}:\n\n` +
        `${eventLines}\n\n` +
        `Open your registrations to accept or decline: ${applicationConfig.frontendBaseUrl}/my-registrations\n\n` +
        `Your pass is issued once you accept.`
      : `${buyerName} has included you in the contingent "${contingent?.contingentName}" for ${fest?.festName}:\n\n` +
        `${eventLines}\n\n` +
        `To confirm your spot, sign in with this email address and accept the invitation ` +
        `(you'll accept our terms yourself before your pass is issued):\n` +
        `${buildSignInLink(emailAddress)}\n\n` +
        `If you were not expecting this, you can ignore this email or decline after signing in.`;

    const wasSent = await sendMailQuietly({
      to: emailAddress,
      subject: `You've been added to "${contingent?.contingentName}" at ${fest?.festName}`,
      text: messageBody,
    });
    if (wasSent) {
      sentCount += 1;
    }
  }
  return { sentCount };
}

/*
 * H — the organiser cancelled the contingent. Every affected BUYER (one email
 * per buyer, not per claim) is told their purchase is refund-pending.
 */
async function sendContingentCancelledEmails(contingent, allClaims) {
  if (allClaims.length === 0) {
    return { sentCount: 0 };
  }
  const fest = await FestModel.findById(contingent.festId).select("festName").lean();
  const buyerIds = [...new Set(allClaims.map((claim) => String(claim.buyerUserId)))];
  const buyers = await UserModel.find({ _id: { $in: buyerIds } })
    .select("emailAddress fullName")
    .lean();

  let sentCount = 0;
  for (const buyer of buyers) {
    const wasSent = await sendMailQuietly({
      to: buyer.emailAddress,
      subject: `"${contingent.contingentName}" at ${fest?.festName} has been cancelled`,
      text:
        `Hi ${buyer.fullName || ""},\n\n` +
        `The organisers have cancelled the contingent "${contingent.contingentName}" at ${fest?.festName}.\n\n` +
        `Your purchase has been cancelled and your payment is marked for refund. ` +
        `The refund is processed by the organisers; contact them if it does not arrive.\n\n` +
        `— The Dedal team`,
    });
    if (wasSent) {
      sentCount += 1;
    }
  }
  return { sentCount };
}

module.exports = { sendContingentInviteEmails, sendContingentCancelledEmails };
