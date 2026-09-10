const { RegistrationModel } = require("../../models/registration-model");
const { EventModel } = require("../../models/event-model");
const { REGISTRATION_STATUSES, PAYMENT_STATUSES } = require("../../constants/registration-constants");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../../constants/audit-log-constants");
const { recordAuditLog } = require("../audit-log-service");

/*
 * Promotion off the waitlist, when a seat comes back.
 *
 * AUTOMATED, NOT AN ADMIN BUTTON. A seat frees at 2am when a pending payment
 * lapses; nobody is watching. The promotion therefore hangs off the two places
 * a seat is actually released — cancelRegistration and
 * releaseExpiredPendingPaymentSeats — rather than off a screen someone has to
 * remember to open.
 *
 * ONE PROMOTION PER RELEASED SEAT. Called with the number of seats that just
 * came back, and it promotes at most that many. Promoting "everyone who fits"
 * would race the count and overbook.
 *
 * ORDER IS createdAt, NOT waitlistPosition. Position is what the participant
 * was told; createdAt is when they actually joined, and it is the field that
 * cannot tie (two racing joins can be handed the same position — see
 * claimWaitlistPosition). Whoever asked first goes first.
 *
 * NEVER THROWS. This runs inside a cancellation that has already committed. A
 * promotion that fails must not roll back someone else's cancellation, so
 * failures are logged and the seat simply stays open for the next release.
 */

/*
 * A promoted paid registration gets the same window a fresh one does. It is not
 * imported from registration-payment-helpers to avoid a require cycle
 * (that module already pulls in the seat helpers); the value is asserted equal
 * by the promotion test.
 */
const PROMOTION_PAYMENT_WINDOW_MINUTES = 30;

async function loadNextWaitlistedRegistrations(eventId, seatCount) {
  return RegistrationModel.find({
    eventId,
    status: REGISTRATION_STATUSES.WAITLISTED,
  })
    .sort({ createdAt: 1 })
    .limit(seatCount)
    .lean();
}

/*
 * Claims one row out of the queue atomically. The status filter is the lock:
 * two concurrent releases cannot both promote the same person, because only the
 * first update finds a row still WAITLISTED.
 */
async function claimWaitlistedRegistration(registrationId, nextStatus) {
  return RegistrationModel.findOneAndUpdate(
    { _id: registrationId, status: REGISTRATION_STATUSES.WAITLISTED },
    {
      $set: {
        status: nextStatus,
        // Cleared on promotion: the row is no longer in the queue, and a stale
        // position would render as "waitlisted, position 3" on a confirmed seat.
        waitlistPosition: null,
        promotedFromWaitlistAt: new Date(),
        ...(nextStatus === REGISTRATION_STATUSES.PENDING_PAYMENT
          ? { paymentStatus: PAYMENT_STATUSES.PENDING }
          : {}),
      },
    },
    { new: true }
  );
}

async function notifyPromotedParticipant(registration, event, isPaid) {
  try {
    const { UserModel } = require("../../models/user-model");
    const { FestModel } = require("../../models/fest-model");

    const [user, fest] = await Promise.all([
      UserModel.findById(registration.userId).select("fullName emailAddress").lean(),
      FestModel.findById(event.festId).select("festName bannerImageUrl").lean(),
    ]);
    if (!user?.emailAddress) {
      return;
    }

    // Late require so a test's email mock is the one that receives this.
    const { sendWaitlistPromotionEmail } = require("../email-service");
    await sendWaitlistPromotionEmail({
      emailAddress: user.emailAddress,
      fullName: user.fullName,
      eventName: event.eventName,
      festName: fest?.festName ?? "",
      festBannerImageUrl: fest?.bannerImageUrl ?? null,
      isPaid,
      paymentWindowMinutes: PROMOTION_PAYMENT_WINDOW_MINUTES,
    });
  } catch (error) {
    // A seat won and an email lost is far better than a seat not given.
    console.error(
      `Waitlist promotion email failed for registration ${registration._id}: ${error.message}`
    );
  }
}

/*
 * Promote up to `releasedSeatCount` people off this event's waitlist.
 * Returns the number actually promoted.
 */
async function promoteFromWaitlist(eventId, releasedSeatCount = 1, actorUserId = null) {
  if (!eventId || releasedSeatCount < 1) {
    return 0;
  }

  try {
    const event = await EventModel.findById(eventId)
      .select("eventName festId capacity registeredCount feeAmountPaise waitlistEnabled")
      .lean();
    if (!event) {
      return 0;
    }

    const candidates = await loadNextWaitlistedRegistrations(eventId, releasedSeatCount);
    if (candidates.length === 0) {
      return 0;
    }

    const isPaid = (event.feeAmountPaise ?? 0) > 0;
    const nextStatus = isPaid
      ? REGISTRATION_STATUSES.PENDING_PAYMENT
      : REGISTRATION_STATUSES.CONFIRMED;

    let promotedCount = 0;
    for (const candidate of candidates) {
      const promoted = await claimWaitlistedRegistration(candidate._id, nextStatus);
      if (!promoted) {
        continue; // another release got there first
      }

      /*
       * The seat is taken NOW, for both paths. A promoted paid row holds its
       * place for the payment window exactly as a fresh PENDING_PAYMENT does —
       * and if that window lapses, the ordinary expiry sweep releases it and
       * promotes the next person, which is the same machinery running again.
       */
      if (event.capacity !== null) {
        await EventModel.updateOne({ _id: eventId }, { $inc: { registeredCount: 1 } });
      }

      /*
       * A free promotion is a real, entered registration: it earns the pass and
       * the event entitlement immediately, the same as a free seat claimed at
       * the front door. A paid one earns nothing until payment captures.
       */
      if (!isPaid) {
        try {
          const { ensurePassAndEventEntitlement } = require("../pass-service");
          await ensurePassAndEventEntitlement(promoted.userId, event.festId, eventId);
        } catch (error) {
          console.error(
            `Pass issue failed for promoted registration ${promoted._id}: ${error.message}`
          );
        }
      }

      await notifyPromotedParticipant(promoted, event, isPaid);

      await recordAuditLog({
        actorUserId,
        festId: event.festId,
        action: AUDIT_ACTIONS.WAITLIST_PROMOTED,
        entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
        entityId: promoted._id,
        afterState: {
          eventId: String(eventId),
          userId: String(promoted.userId),
          promotedTo: nextStatus,
        },
      });
      promotedCount += 1;
    }
    return promotedCount;
  } catch (error) {
    console.error(`Waitlist promotion failed for event ${eventId}: ${error.message}`);
    return 0;
  }
}

module.exports = {
  promoteFromWaitlist,
  PROMOTION_PAYMENT_WINDOW_MINUTES,
};
