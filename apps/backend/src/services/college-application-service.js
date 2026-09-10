const mongoose = require("mongoose");

const {
  CollegeApplicationModel,
  COLLEGE_APPLICATION_STATUSES,
} = require("../models/college-application-model");
const { CollegeModel } = require("../models/college-model");
const { UserModel } = require("../models/user-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { UNKNOWN_IP_ADDRESS } = require("../constants/sign-in-constants");
const {
  sendCollegeApplicationReceivedEmail,
  sendCollegeApplicationApprovedEmail,
  sendCollegeApplicationRejectedEmail,
} = require("./email-service");

const IP_ROLLING_WINDOW_MINUTES = 60;
const IP_ROLLING_MAXIMUM_SUBMISSIONS = 5;

const MINIMUM_REJECTION_REASON_LENGTH = 10;

const EMAIL_DELIVERY_WARNING = "email_delivery_failed";

const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

function escapeForRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function caseInsensitiveExact(text) {
  return new RegExp(`^${escapeForRegExp(text)}$`, "i");
}

/*
 * Per-IP submission throttle, reading the applications collection as its own
 * rolling-window store — the same pattern as the per-IP OTP send limit. The
 * unknown-IP bucket is never throttled, for the same reason: it is a
 * test-harness or misconfigured-proxy path, and refusing everyone in it at
 * once is worse than the abuse the limit exists to stop.
 */
async function enforcePerIpSubmissionLimit(ipAddress) {
  if (!ipAddress || ipAddress === UNKNOWN_IP_ADDRESS) {
    return;
  }

  const windowStart = new Date(Date.now() - IP_ROLLING_WINDOW_MINUTES * 60 * 1000);
  const recentCount = await CollegeApplicationModel.countDocuments({
    ipAddress,
    createdAt: { $gte: windowStart },
  });

  if (recentCount >= IP_ROLLING_MAXIMUM_SUBMISSIONS) {
    // No retryAfterSeconds: it would publish the rolling window length.
    throw new ApplicationError(
      429,
      ERROR_CODES.APPLICATION_RATE_LIMITED,
      "Too many applications submitted from this network. Try again later."
    );
  }
}

function isDuplicatePendingApplicationError(error) {
  return (
    error?.code === MONGO_DUPLICATE_KEY_ERROR_CODE &&
    error?.keyPattern &&
    Object.prototype.hasOwnProperty.call(error.keyPattern, "applicantEmail")
  );
}

function throwAlreadyPendingError() {
  throw new ApplicationError(
    409,
    ERROR_CODES.APPLICATION_ALREADY_PENDING,
    "An application for this email address is already pending review."
  );
}

async function submitApplication(attributes, ipAddress) {
  await enforcePerIpSubmissionLimit(ipAddress);

  const applicantEmail = attributes.applicantEmail.trim().toLowerCase();

  // Abuse-tracing breadcrumb: enough to reconstruct who tried to apply and from
  // where the next time submissions vanish or a duplicate check misfires.
  console.log(
    `College application submit attempt: email=${applicantEmail} ` +
      `college="${attributes.collegeName}" ip=${ipAddress || UNKNOWN_IP_ADDRESS}`
  );

  /*
   * One live application per email: a pending one blocks (it is already in the
   * queue), an approved one blocks (that email already administers a college),
   * but a REJECTED one does not — a rejected applicant may fix the problem and
   * reapply. The partial unique index on (applicantEmail, pending) is what
   * settles the pending race; approved is pre-check only, which is fine because
   * approval is a reviewed action, not a race with the applicant.
   */
  const blockingApplication = await CollegeApplicationModel.findOne({
    applicantEmail,
    status: {
      $in: [COLLEGE_APPLICATION_STATUSES.PENDING, COLLEGE_APPLICATION_STATUSES.APPROVED],
    },
  })
    .select("status")
    .lean();
  if (blockingApplication) {
    console.log(
      `College application blocked: email=${applicantEmail} reason=${blockingApplication.status}`
    );
    if (blockingApplication.status === COLLEGE_APPLICATION_STATUSES.APPROVED) {
      throw new ApplicationError(
        409,
        ERROR_CODES.APPLICATION_ALREADY_PENDING,
        "This email address already administers an approved college. Sign in instead."
      );
    }
    throwAlreadyPendingError();
  }

  /*
   * A name matching a college in the catalogue is only a rejection when that
   * college is a live tenant. The catalogue is pre-seeded with REFERENCE
   * entries — real colleges with no administrator yet, exactly the
   * institutions this flow exists to onboard — so a match against one of those
   * is allowed and remembered as linkedCollegeId, and approval ELEVATES the
   * existing record instead of duplicating it. Only status "active" (an
   * approved tenant with an administrator) blocks.
   */
  let linkedCollegeId = null;
  const matchedCollege = await CollegeModel.findOne({
    collegeName: caseInsensitiveExact(attributes.collegeName),
  })
    .select("_id status")
    .lean();
  if (matchedCollege) {
    if (matchedCollege.status === "active") {
      console.log(
        `College application blocked: college="${attributes.collegeName}" ` +
          `matches ACTIVE college ${matchedCollege._id}`
      );
      throw new ApplicationError(
        409,
        ERROR_CODES.COLLEGE_ALREADY_REGISTERED,
        "This college already has a registered administrator on Dedal. Ask them for access."
      );
    }
    linkedCollegeId = matchedCollege._id;
    console.log(
      `College application name match: college="${attributes.collegeName}" ` +
        `matches ${matchedCollege.status || "reference"} college ${matchedCollege._id} — ` +
        `allowed, linked for elevation on approval.`
    );
  }

  let application;
  try {
    application = await CollegeApplicationModel.create({
      ...attributes,
      applicantEmail,
      linkedCollegeId,
      ipAddress: ipAddress || UNKNOWN_IP_ADDRESS,
    });
  } catch (error) {
    if (isDuplicatePendingApplicationError(error)) {
      throwAlreadyPendingError();
    }
    throw error;
  }

  // Delivery failure is a warning, not a rollback — mirrors the OTP flow.
  const emailDelivered = await sendCollegeApplicationReceivedEmail({
    applicantEmail,
    applicantFullName: application.applicantFullName,
    collegeName: application.collegeName,
  });

  const responseData = { application: application.toJSON() };
  if (!emailDelivered) {
    responseData.warning = EMAIL_DELIVERY_WARNING;
  }
  return responseData;
}

async function findApplicationOrThrow(applicationId) {
  const application = mongoose.isValidObjectId(applicationId)
    ? await CollegeApplicationModel.findById(applicationId)
    : null;
  if (!application) {
    throw new ApplicationError(404, ERROR_CODES.APPLICATION_NOT_FOUND, "Application not found.");
  }
  return application;
}

/*
 * The public status projection. Deliberately NOT toJSON(): the status route is
 * unauthenticated, so it must never leak applicant PII — only the fields a
 * poller needs to render "where is my application".
 */
async function getApplicationStatus(applicationId) {
  const application = await findApplicationOrThrow(applicationId);
  return {
    id: application.id,
    status: application.status,
    collegeName: application.collegeName,
    createdAt: application.createdAt,
    reviewedAt: application.reviewedAt,
    rejectionReason: application.rejectionReason,
  };
}

async function listApplications({ status } = {}) {
  const filter = {};
  if (status) {
    filter.status = status;
  }
  const applications = await CollegeApplicationModel.find(filter)
    .sort({ createdAt: -1 })
    .populate("reviewedByUserId", "fullName emailAddress");
  return applications.map((application) => application.toJSON());
}

async function getApplicationById(applicationId) {
  const application = await findApplicationOrThrow(applicationId);
  await application.populate("reviewedByUserId", "fullName emailAddress");
  return application.toJSON();
}

function assertApplicationIsReviewable(application) {
  const reviewableStatuses = [
    COLLEGE_APPLICATION_STATUSES.PENDING,
    COLLEGE_APPLICATION_STATUSES.UNDER_REVIEW,
  ];
  if (!reviewableStatuses.includes(application.status)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.APPLICATION_ALREADY_REVIEWED,
      `This application has already been ${application.status}.`
    );
  }
}

/*
 * Resolve the college to go live: prefer the one linked at submit (so a
 * reference directory entry is ELEVATED, never duplicated), fall back to a
 * case-insensitive name lookup, and only then create a fresh active college.
 */
async function resolveApprovedCollege(application) {
  if (application.linkedCollegeId) {
    const linkedCollege = await CollegeModel.findById(application.linkedCollegeId);
    if (linkedCollege) {
      return linkedCollege;
    }
    // Linked college deleted since submit — fall through to name lookup/create.
  }

  const existingCollege = await CollegeModel.findOne({
    collegeName: caseInsensitiveExact(application.collegeName),
  });
  if (existingCollege) {
    return existingCollege;
  }

  return CollegeModel.create({
    collegeName: application.collegeName,
    commonName: application.collegeName,
    city: application.collegeCity,
    state: application.collegeState,
    /*
     * An approved application carries a real structured address, so the college
     * it creates never needs the migration sentinel. Older applications have no
     * detail object; those colleges fall to the migration like any other.
     */
    ...(application.collegeAddressDetail
      ? { address: application.collegeAddressDetail.toObject() }
      : {}),
    isVerified: true,
    status: "active",
  });
}

async function resolveApprovedAdministratorUser(application, college) {
  const existingUser = await UserModel.findOne({ emailAddress: application.applicantEmail });
  if (existingUser) {
    // Adopt the college if the account has none; never overwrite a chosen one.
    if (!existingUser.collegeId) {
      existingUser.collegeId = college._id;
      await existingUser.save();
    }
    return existingUser;
  }

  return UserModel.create({
    emailAddress: application.applicantEmail,
    fullName: application.applicantFullName,
    phoneNumber: application.applicantPhone,
    collegeId: college._id,
    /*
     * Set directly rather than recomputed: an administrator has no USN, and
     * recomputing would trap them on the profile-completion screen.
     */
    isProfileComplete: true,
    // The application was reviewed against this address, so it is trusted.
    emailVerifiedAt: new Date(),
    /*
     * participantId is deliberately OMITTED, not set to null: it carries a
     * unique SPARSE index, which skips only ABSENT fields — an explicit null
     * would collide with the next administrator created this way.
     */
  });
}

async function ensureAdministratorAssignment(user, college, reviewerUserId) {
  const existingAssignment = await StaffAssignmentModel.findOne({
    userId: user._id,
    collegeId: college._id,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  });
  if (existingAssignment) {
    return existingAssignment;
  }

  return StaffAssignmentModel.create({
    userId: user._id,
    collegeId: college._id,
    festId: null,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    assignedByUserId: reviewerUserId,
  });
}

/*
 * Approval provisions everything the college needs to go live: the college row
 * (verified), the administrator account, and the college-scoped administrator
 * assignment. Every step looks the record up first and creates only what is
 * absent, so a retry after a partial failure completes instead of duplicating.
 */
async function approveApplication(applicationId, reviewerUserId) {
  const application = await findApplicationOrThrow(applicationId);
  assertApplicationIsReviewable(application);

  const college = await resolveApprovedCollege(application);
  // Elevate whatever we resolved — a reference directory entry becomes a live
  // tenant, an unverified self-registration goes live. Idempotent on retry.
  if (!college.isVerified || college.status !== "active") {
    college.isVerified = true;
    college.status = "active";
    await college.save();
  }

  const administratorUser = await resolveApprovedAdministratorUser(application, college);
  await ensureAdministratorAssignment(administratorUser, college, reviewerUserId);

  application.status = COLLEGE_APPLICATION_STATUSES.APPROVED;
  application.reviewedByUserId = reviewerUserId;
  application.reviewedAt = new Date();
  await application.save();

  const emailDelivered = await sendCollegeApplicationApprovedEmail({
    applicantEmail: application.applicantEmail,
    applicantFullName: application.applicantFullName,
    collegeName: application.collegeName,
  });

  await application.populate("reviewedByUserId", "fullName emailAddress");
  const responseData = { application: application.toJSON() };
  if (!emailDelivered) {
    responseData.warning = EMAIL_DELIVERY_WARNING;
  }
  return responseData;
}

async function rejectApplication(applicationId, reviewerUserId, reason) {
  if (typeof reason !== "string" || reason.trim().length < MINIMUM_REJECTION_REASON_LENGTH) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "One or more fields are invalid.", {
      reason: `is required and must be at least ${MINIMUM_REJECTION_REASON_LENGTH} characters`,
    });
  }

  const application = await findApplicationOrThrow(applicationId);
  assertApplicationIsReviewable(application);

  application.status = COLLEGE_APPLICATION_STATUSES.REJECTED;
  application.reviewedByUserId = reviewerUserId;
  application.reviewedAt = new Date();
  application.rejectionReason = reason.trim();
  await application.save();

  const emailDelivered = await sendCollegeApplicationRejectedEmail({
    applicantEmail: application.applicantEmail,
    applicantFullName: application.applicantFullName,
    collegeName: application.collegeName,
    reason: application.rejectionReason,
  });

  await application.populate("reviewedByUserId", "fullName emailAddress");
  const responseData = { application: application.toJSON() };
  if (!emailDelivered) {
    responseData.warning = EMAIL_DELIVERY_WARNING;
  }
  return responseData;
}

module.exports = {
  submitApplication,
  getApplicationStatus,
  listApplications,
  getApplicationById,
  approveApplication,
  rejectApplication,
  IP_ROLLING_MAXIMUM_SUBMISSIONS,
};
