const mongoose = require("mongoose");
const { UserModel } = require("../models/user-model");
const { EventModel } = require("../models/event-model");
const { CollegeModel } = require("../models/college-model");
const { PassModel } = require("../models/pass-model");
const { RegistrationModel } = require("../models/registration-model");
const { CertificateModel } = require("../models/certificate-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { SignInLogModel } = require("../models/sign-in-log-model");
const { OtpCodeModel } = require("../models/otp-code-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { generateParticipantId } = require("../helpers/participant-id-helpers");
const consentService = require("./consent-service");
const { POLICY_DOCUMENT_KINDS } = require("../constants/consent-constants");

const DUPLICATE_KEY_ERROR_CODE = 11000;
const PARTICIPANT_ID_COLLISION_RETRIES = 3;

/*
 * Saves the user, retrying on a participantId collision. Two participants with the
 * same name pattern and the same last-four digits are rare but possible; each retry
 * appends one random digit and tries again. If the retries exhaust, the id is
 * dropped and the profile is still saved — a missing id is cosmetic, a blocked
 * signup is a lost participant.
 */
async function saveWithParticipantId(user) {
  for (let attempt = 0; attempt <= PARTICIPANT_ID_COLLISION_RETRIES; attempt += 1) {
    try {
      await user.save();
      return;
    } catch (error) {
      const isParticipantIdCollision =
        error?.code === DUPLICATE_KEY_ERROR_CODE &&
        Object.keys(error.keyPattern || {}).includes("participantId");
      if (!isParticipantIdCollision) {
        throw error;
      }
      console.error(`participantId collision for user ${user._id}: ${user.participantId}`);
      if (attempt === PARTICIPANT_ID_COLLISION_RETRIES) {
        user.participantId = undefined;
      } else {
        user.participantId = `${user.participantId}${Math.floor(Math.random() * 10)}`;
      }
    }
  }
  await user.save();
}

/*
 * The caller's own profile, re-read from the database.
 *
 * The clients cache the user object they were handed at sign-in, and until this
 * existed that cache was the only copy they had: a field the server started
 * returning later — or a value changed by anything other than the profile form —
 * stayed invisible until the user signed in again. This is the endpoint that lets
 * a session refresh itself.
 *
 * phoneNumber is select: false and asked for by name because this is the owner
 * reading their own record: the profile form prefills from it, and a form that
 * loads it blank silently overwrites it with nothing on save.
 */
async function getMyProfile(userId) {
  const user = await UserModel.findById(userId).select("+phoneNumber");
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "User not found.");
  }
  return user.toJSON();
}

/*
 * A blocked account cannot edit its profile, and the college must exist and be
 * verified — an unverified or missing college is reported the same way so the
 * endpoint cannot be used to probe which college ids exist.
 */
async function updateUserProfile(userId, payload, context = {}) {
  /*
   * Their own profile, and the response refreshes their session — phoneNumber is
   * select: false, so it is asked for by name or the refreshed session (and the
   * profile form prefilling from it) would carry it blank.
   */
  const user = await UserModel.findById(userId).select("+phoneNumber");
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "User not found.");
  }
  if (user.isBlocked) {
    throw new ApplicationError(403, ERROR_CODES.USER_BLOCKED, "This account is blocked.");
  }

  const college = await CollegeModel.findOne({ _id: payload.collegeId, isVerified: true });
  if (!college) {
    throw new ApplicationError(
      400,
      ERROR_CODES.PROFILE_COLLEGE_NOT_FOUND,
      "That college could not be found."
    );
  }

  user.fullName = payload.fullName;
  user.collegeId = college._id;
  user.usn = payload.usn;
  user.phoneNumber = payload.phoneNumber;
  user.yearOfStudy = payload.yearOfStudy;
  user.department = payload.department;
  user.studentIdUrl = payload.studentIdUrl;
  /*
   * Assigned only when present, unlike the fields above: it is optional, and a
   * partial update that omits it must not silently wipe an address the
   * participant set earlier. (undefined = absent, null = an explicit clear.)
   */
  if (payload.professionalEmail !== undefined) {
    user.professionalEmail = payload.professionalEmail;
  }
  if (payload.profilePictureUrl !== undefined) {
    user.profilePictureUrl = payload.profilePictureUrl;
  }
  if (payload.dateOfBirth !== undefined) {
    user.dateOfBirth = payload.dateOfBirth;
  }
  user.recomputeIsProfileComplete();

  /*
   * CONSENT IS A RECORD, NOT A STAMP. A ticked checkbox writes an append-only
   * ConsentRecord naming the policy version THE FORM DISPLAYED — the id the
   * client sent with the tick, verified by consent-service to be the version
   * currently in effect — plus its content hash and the request's IP and user
   * agent. A tick against a superseded version is refused with
   * POLICY_VERSION_STALE rather than recorded against the newer text. The
   * deprecated termsOfServiceConsentedAt / privacyPolicyConsentedAt fields are
   * no longer written. recordAcceptance is idempotent against the version
   * already stood on, so re-saving the form is not re-consenting.
   *
   * Written before the user save so a failed consent write fails the request
   * loudly rather than leaving a completed profile with no consent behind it.
   */
  if (payload.hasAcceptedTerms) {
    await consentService.recordAcceptance(
      {
        userId: user._id,
        documentKind: POLICY_DOCUMENT_KINDS.TERMS_OF_SERVICE,
        submittedVersionId: payload.termsPolicyVersionId,
      },
      context
    );
  }
  if (payload.hasAcceptedPrivacyPolicy) {
    await consentService.recordAcceptance(
      {
        userId: user._id,
        documentKind: POLICY_DOCUMENT_KINDS.PRIVACY_POLICY,
        submittedVersionId: payload.privacyPolicyVersionId,
      },
      context
    );
  }

  /*
   * Minted once, at completion, from the identity just written. Skipped if the user
   * already carries one, so a later name edit never changes it.
   */
  if (user.isProfileComplete && !user.participantId) {
    const generatedId = generateParticipantId(user.fullName, user.phoneNumber);
    if (generatedId) {
      user.participantId = generatedId;
    }
  }

  await saveWithParticipantId(user);

  return user.toJSON();
}

async function deleteMyAccount(userId) {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "User not found.");
  }

  // Clean up all user-related data across collections.
  // Staff assignments are permanent history — revoke instead of delete.
  // Consent records are deliberately NOT deleted: they are the evidence that
  // processing up to this moment was lawful, and the model refuses deletion.
  await StaffAssignmentModel.updateMany({ userId }, { status: "revoked" });
  await PassModel.deleteMany({ userId });
  await RegistrationModel.deleteMany({ userId });
  await CertificateModel.deleteMany({ userId });
  await SignInLogModel.deleteMany({ userId });
  await OtpCodeModel.deleteMany({ emailAddress: user.emailAddress });

  await UserModel.findByIdAndDelete(userId);
  return { deleted: true };
}

/*
 * Saved (bookmarked) events.
 *
 * $addToSet / $pull rather than read-modify-write: tapping the bookmark twice
 * quickly, or on two devices at once, must not race into a duplicate or a lost
 * save. Both operations are idempotent, so a retried request is harmless.
 *
 * Saving verifies the event exists — a bookmark pointing at a deleted event
 * would render as a blank row on the saved list with no way to clear it.
 * Unsaving deliberately does NOT verify: if the event was deleted, removing the
 * dangling id is exactly what the user is trying to do.
 */
function assertValidEventId(eventId) {
  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid event id.");
  }
}

async function saveEventForUser(userId, eventId) {
  assertValidEventId(eventId);

  const event = await EventModel.findById(eventId).select("_id").lean();
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $addToSet: { savedEventIds: event._id } },
    { new: true }
  )
    .select("savedEventIds")
    .lean();
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "User not found.");
  }
  return { savedEventIds: (user.savedEventIds ?? []).map(String) };
}

async function unsaveEventForUser(userId, eventId) {
  assertValidEventId(eventId);

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $pull: { savedEventIds: new mongoose.Types.ObjectId(eventId) } },
    { new: true }
  )
    .select("savedEventIds")
    .lean();
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "User not found.");
  }
  return { savedEventIds: (user.savedEventIds ?? []).map(String) };
}

/*
 * The saved list, with enough of each event to render a card without a second
 * round of requests. Events deleted since they were saved simply drop out —
 * populate returns null for them — so the list self-heals rather than showing
 * blanks.
 */
async function listSavedEventsForUser(userId) {
  const user = await UserModel.findById(userId)
    .select("savedEventIds")
    .populate({
      path: "savedEventIds",
      select: "eventName eventSlug category eventType startsAt endsAt venue posterImageUrl festId",
      populate: { path: "festId", select: "festName festSlug", model: "Fest" },
    })
    .lean();
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "User not found.");
  }

  const events = (user.savedEventIds ?? []).filter(Boolean).map((event) => ({
    ...event,
    id: String(event._id),
  }));
  return { events, savedEventIds: events.map((event) => event.id) };
}

module.exports = {
  getMyProfile,
  updateUserProfile,
  deleteMyAccount,
  saveEventForUser,
  unsaveEventForUser,
  listSavedEventsForUser,
};;
