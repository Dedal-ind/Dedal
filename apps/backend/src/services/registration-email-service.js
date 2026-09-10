/*
 * The "what you registered for" email dispatch.
 *
 * ONE CALL SITE. Every path that seats a participant — solo free, team create,
 * team join, team roster, contingent accept, and paid-after-confirmation — funnels
 * through pass-service's ensurePassAndEventEntitlement, which is where this is
 * called from. Wiring the five services individually would have meant five
 * chances to miss one, and the paid path in particular must fire only after the
 * registration flips to CONFIRMED, which is exactly when that choke point runs.
 *
 * A PENDING_PAYMENT registration is deliberately never emailed: the participant
 * has not paid, the seat is not theirs yet, and telling them "you're registered"
 * before capture is the one message that cannot be walked back.
 */

const { RegistrationModel } = require("../models/registration-model");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");

/*
 * The coordinator number shown on the event page, resolved the same way: the
 * assignment's override first, then the staff member's personal number. Never
 * fabricated — an event with no reachable staff simply omits the line rather
 * than printing a dead number.
 */
async function resolveCoordinatorContactPhone(eventId) {
  try {
    const { StaffAssignmentModel } = require("../models/staff-assignment-model");
    const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

    const assignment = await StaffAssignmentModel.findOne({
      eventIds: eventId,
      role: STAFF_ROLES.COORDINATOR,
      status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    })
      .select("assignmentContactPhone userId")
      .populate({ path: "userId", select: "+phoneNumber" })
      .lean();

    if (!assignment) {
      return null;
    }
    return assignment.assignmentContactPhone ?? assignment.userId?.phoneNumber ?? null;
  } catch {
    // A contact line is a nicety; never let it cost the email.
    return null;
  }
}

/*
 * Claim-then-send. The stamp is written first and rolled back on failure, so a
 * transport error becomes a retry on the participant's next registration rather
 * than a confirmation that is silently never sent. Mirrors sendPassEmailOnce.
 */
async function sendRegistrationConfirmationEmailOnce(userId, eventId) {
  const claimed = await RegistrationModel.findOneAndUpdate(
    {
      userId,
      eventId,
      // CONFIRMED only. A waitlisted or pending-payment seat is not a registration
      // anyone should be congratulated for.
      status: REGISTRATION_STATUSES.CONFIRMED,
      registrationConfirmationEmailSentAt: null,
    },
    { $set: { registrationConfirmationEmailSentAt: new Date() } },
    { new: true }
  )
    .populate({ path: "teamId", select: "teamName inviteCode" })
    .lean();

  if (!claimed) {
    return false; // already emailed, not confirmed, or a parallel write claimed it
  }

  try {
    const { UserModel } = require("../models/user-model");
    const { EventModel } = require("../models/event-model");

    const [user, event] = await Promise.all([
      UserModel.findById(userId).select("fullName emailAddress").lean(),
      EventModel.findById(eventId).populate("festId", "festName bannerImageUrl").lean(),
    ]);
    if (!user?.emailAddress) {
      throw new Error("registrant has no email address");
    }
    if (!event) {
      throw new Error("event not found");
    }

    const contactPhone = await resolveCoordinatorContactPhone(eventId);

    // Late require: pass-service and friends are pulled into the require graph
    // before a test suite installs its email mock, so a top-level capture would
    // bind the real transport for the whole run.
    const { sendRegistrationConfirmationEmail } = require("./email-service");
    const wasSent = await sendRegistrationConfirmationEmail({
      user,
      registration: claimed,
      event,
      fest: event.festId,
      team: claimed.teamId ?? null,
      contactPhone,
    });
    if (!wasSent) {
      throw new Error("email transport reported failure");
    }
    return true;
  } catch (error) {
    await RegistrationModel.updateOne(
      { _id: claimed._id },
      { $set: { registrationConfirmationEmailSentAt: null } }
    );
    console.error(
      `Registration confirmation email failed for user ${userId} on event ${eventId}: ${error.message}`
    );
    return false;
  }
}

module.exports = { sendRegistrationConfirmationEmailOnce };
