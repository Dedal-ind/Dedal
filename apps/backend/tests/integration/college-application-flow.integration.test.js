import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

import { CollegeModel } from "../../src/models/college-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { CollegeApplicationModel } from "../../src/models/college-application-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import {
  installEmailServiceMock,
  clearRecordedEmails,
  findRecordedEmailsOfKind,
} from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { createTestOutsider } from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const SUBMIT_PATH = "/api/v1/college-applications";
const ADMIN_LIST_PATH = "/api/v1/admin/college-applications";

const DEFAULT_CLIENT_IP = "203.0.113.10";

function buildApplicationPayload(overrides = {}) {
  return {
    applicantEmail: "principal@newcollege.edu",
    applicantFullName: "Prakash Rao",
    applicantPhone: "9876543210",
    applicantRole: "Principal",
    collegeName: "New Horizon College",
    collegeAddress: "100 Ring Road, Marathahalli",
    collegeCity: "Bengaluru",
    // The structured postal address became mandatory when the college address
    // was formalised; the free-text collegeAddress above remains the verifier's
    // at-a-glance summary.
    address: {
      addressLine1: "100 Ring Road",
      addressLine2: "Marathahalli",
      city: "Bengaluru",
      district: "Bengaluru Urban",
      state: "Karnataka",
      pinCode: "560037",
    },
    collegeState: "Karnataka",
    expectedFestSize: "500-1500",
    ...overrides,
  };
}

function postApplication(payload, clientIp = DEFAULT_CLIENT_IP) {
  return request(application)
    .post(SUBMIT_PATH)
    .set("X-Forwarded-For", clientIp)
    .send(payload);
}

/* The product owner: a user with an active platform-admin assignment and a token. */
async function createTestPlatformAdmin() {
  const user = await UserModel.create({
    emailAddress: "owner@example.com",
    fullName: "Platform Owner",
    isProfileComplete: true,
  });
  await StaffAssignmentModel.create({
    userId: user._id,
    collegeId: null,
    festId: null,
    role: "platformAdmin",
    status: "active",
    assignedByUserId: user._id,
  });
  const authenticationToken = createAuthenticationToken({
    id: user.id,
    emailAddress: user.emailAddress,
  });
  return { user, authenticationToken };
}

async function submitAndGetId(overrides = {}) {
  const response = await postApplication(buildApplicationPayload(overrides));
  expect(response.status).toBe(201);
  return response.body.data.application.id;
}

beforeAll(async () => {
  await setupTestDatabase();
  // The partial unique pending-email index is load-bearing for the 409 race.
  await CollegeApplicationModel.createIndexes();
  await UserModel.createIndexes();
});
beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
});
afterAll(teardownTestDatabase);

describe("public application submission", () => {
  it("accepts a valid application, returns it in the envelope, and sends the received email", async () => {
    const response = await postApplication(buildApplicationPayload());

    expect(response.status).toBe(201);
    const returnedApplication = response.body.data.application;
    expect(returnedApplication.id).toBeDefined();
    expect(returnedApplication.status).toBe("pending");
    expect(returnedApplication.applicantEmail).toBe("principal@newcollege.edu");
    expect(returnedApplication.collegeState).toBe("Karnataka");
    expect(returnedApplication._id).toBeUndefined();
    expect(returnedApplication.ipAddress).toBeUndefined();

    const receivedEmails = findRecordedEmailsOfKind("applicationReceived");
    expect(receivedEmails).toHaveLength(1);
    expect(receivedEmails[0].emailAddress).toBe("principal@newcollege.edu");
  });

  it("rejects a payload with missing fields, a bad email, a bad phone and a bad size", async () => {
    const response = await postApplication({
      applicantEmail: "not-an-email",
      applicantPhone: "12345",
      expectedFestSize: "gigantic",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.applicantEmail).toBeDefined();
    expect(response.body.error.details.applicantPhone).toBeDefined();
    expect(response.body.error.details.applicantFullName).toBeDefined();
    expect(response.body.error.details.expectedFestSize).toBeDefined();
    expect(await CollegeApplicationModel.countDocuments({})).toBe(0);
  });

  it("refuses a second pending application for the same email with 409", async () => {
    expect((await postApplication(buildApplicationPayload())).status).toBe(201);

    const duplicate = await postApplication(
      buildApplicationPayload({ collegeName: "Some Other College" })
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("APPLICATION_ALREADY_PENDING");
  });

  /*
   * A name matching a REFERENCE college must NOT block: the catalogue is
   * pre-seeded with real colleges that have no administrator yet, and those
   * are exactly the institutions this flow onboards. The match is remembered
   * as linkedCollegeId so approval elevates the entry instead of duplicating.
   */
  it("accepts an application matching a reference college and links it", async () => {
    const referenceCollege = await CollegeModel.create({
      collegeName: "New Horizon College",
      commonName: "New Horizon",
      city: "Bengaluru",
      state: "Karnataka",
      isVerified: true,
      status: "reference",
    });

    const response = await postApplication(
      buildApplicationPayload({ collegeName: "new horizon college" })
    );
    expect(response.status).toBe(201);
    expect(response.body.data.application.status).toBe("pending");
    expect(String(response.body.data.application.linkedCollegeId)).toBe(
      String(referenceCollege._id)
    );
  });

  it("refuses an application matching an ACTIVE college with 409", async () => {
    await CollegeModel.create({
      collegeName: "New Horizon College",
      commonName: "New Horizon",
      city: "Bengaluru",
      state: "Karnataka",
      isVerified: true,
      status: "active",
    });

    const response = await postApplication(
      buildApplicationPayload({ collegeName: "NEW HORIZON COLLEGE" })
    );
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("COLLEGE_ALREADY_REGISTERED");
    expect(await CollegeApplicationModel.countDocuments({})).toBe(0);
  });

  it("blocks a second application from an email that already has an APPROVED one", async () => {
    const { authenticationToken } = await createTestPlatformAdmin();
    const first = await postApplication(buildApplicationPayload());
    expect(first.status).toBe(201);
    await request(application)
      .post(`${ADMIN_LIST_PATH}/${first.body.data.application.id}/approve`)
      .set("Authorization", `Bearer ${authenticationToken}`);

    const second = await postApplication(
      buildApplicationPayload({ collegeName: "A Different College" })
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("APPLICATION_ALREADY_PENDING");
    expect(second.body.error.message).toContain("already administers");
  });

  it("returns 429 once one IP passes five submissions inside the hour", async () => {
    for (let sent = 0; sent < 5; sent += 1) {
      const response = await postApplication(
        buildApplicationPayload({
          applicantEmail: `applicant-${sent}@example.com`,
          collegeName: `College Number ${sent}`,
        })
      );
      expect(response.status).toBe(201);
    }

    const overflow = await postApplication(
      buildApplicationPayload({
        applicantEmail: "applicant-overflow@example.com",
        collegeName: "Overflow College",
      })
    );
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("APPLICATION_RATE_LIMITED");

    // A different IP is unaffected: the ceiling is per IP, not global.
    const otherIp = await postApplication(
      buildApplicationPayload({
        applicantEmail: "applicant-other-ip@example.com",
        collegeName: "Other IP College",
      }),
      "203.0.113.99"
    );
    expect(otherIp.status).toBe(201);
  });
});

describe("public status route", () => {
  it("returns only the projected fields — never applicant PII", async () => {
    const applicationId = await submitAndGetId();

    const response = await request(application).get(`${SUBMIT_PATH}/status/${applicationId}`);

    expect(response.status).toBe(200);
    const statusProjection = response.body.data.application;
    expect(Object.keys(statusProjection).sort()).toEqual(
      ["collegeName", "createdAt", "id", "rejectionReason", "reviewedAt", "status"].sort()
    );
    expect(statusProjection.status).toBe("pending");
    expect(statusProjection.applicantEmail).toBeUndefined();
    expect(statusProjection.applicantPhone).toBeUndefined();
    expect(statusProjection.applicantFullName).toBeUndefined();
  });

  it("returns 404 for an unknown or malformed id", async () => {
    const unknown = await request(application).get(
      `${SUBMIT_PATH}/status/6543210987654321fedcba98`
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("APPLICATION_NOT_FOUND");

    const malformed = await request(application).get(`${SUBMIT_PATH}/status/not-an-object-id`);
    expect(malformed.status).toBe(404);
    expect(malformed.body.error.code).toBe("APPLICATION_NOT_FOUND");
  });
});

describe("platform-admin review", () => {
  it("gates every admin route: 403 for a signed-in user with no platform-admin role", async () => {
    const { authenticationToken } = await createTestOutsider();
    const applicationId = await submitAndGetId();

    const listResponse = await request(application)
      .get(ADMIN_LIST_PATH)
      .set("Authorization", `Bearer ${authenticationToken}`);
    expect(listResponse.status).toBe(403);
    expect(listResponse.body.error.code).toBe("PERMISSION_DENIED");

    const approveResponse = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/approve`)
      .set("Authorization", `Bearer ${authenticationToken}`);
    expect(approveResponse.status).toBe(403);
  });

  it("lists applications with a status filter and populates the reviewer", async () => {
    const { user: reviewer, authenticationToken } = await createTestPlatformAdmin();
    const firstId = await submitAndGetId();
    await submitAndGetId({
      applicantEmail: "second@example.com",
      collegeName: "Second College",
    });

    await request(application)
      .post(`${ADMIN_LIST_PATH}/${firstId}/reject`)
      .set("Authorization", `Bearer ${authenticationToken}`)
      .send({ reason: "Insufficient supporting documentation." });

    const pendingOnly = await request(application)
      .get(`${ADMIN_LIST_PATH}?status=pending`)
      .set("Authorization", `Bearer ${authenticationToken}`);
    expect(pendingOnly.status).toBe(200);
    expect(pendingOnly.body.data.applications).toHaveLength(1);
    expect(pendingOnly.body.data.applications[0].collegeName).toBe("Second College");

    const rejectedOnly = await request(application)
      .get(`${ADMIN_LIST_PATH}?status=rejected`)
      .set("Authorization", `Bearer ${authenticationToken}`);
    expect(rejectedOnly.body.data.applications).toHaveLength(1);
    expect(rejectedOnly.body.data.applications[0].reviewedByUserId.emailAddress).toBe(
      reviewer.emailAddress
    );
  });

  it("approve creates the verified college, the administrator user and the assignment", async () => {
    const { user: reviewer, authenticationToken } = await createTestPlatformAdmin();
    const applicationId = await submitAndGetId();

    const response = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/approve`)
      .set("Authorization", `Bearer ${authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.application.status).toBe("approved");
    expect(response.body.data.application.reviewedAt).toBeDefined();

    const college = await CollegeModel.findOne({ collegeName: "New Horizon College" });
    expect(college).not.toBeNull();
    expect(college.isVerified).toBe(true);
    expect(college.status).toBe("active");
    expect(college.city).toBe("Bengaluru");

    const administratorUser = await UserModel.findOne({
      emailAddress: "principal@newcollege.edu",
    }).select("+phoneNumber");
    expect(administratorUser).not.toBeNull();
    expect(administratorUser.fullName).toBe("Prakash Rao");
    expect(administratorUser.phoneNumber).toBe("9876543210");
    expect(administratorUser.isProfileComplete).toBe(true);
    expect(administratorUser.emailVerifiedAt).not.toBeNull();
    expect(String(administratorUser.collegeId)).toBe(String(college._id));
    // OMITTED, never null — the sparse unique index must skip this document.
    const rawUser = await UserModel.collection.findOne({ _id: administratorUser._id });
    expect("participantId" in rawUser).toBe(false);

    const assignment = await StaffAssignmentModel.findOne({
      userId: administratorUser._id,
      role: "administrator",
      status: "active",
    });
    expect(assignment).not.toBeNull();
    expect(String(assignment.collegeId)).toBe(String(college._id));
    expect(assignment.festId).toBeNull();
    expect(String(assignment.assignedByUserId)).toBe(String(reviewer._id));

    expect(findRecordedEmailsOfKind("applicationApproved")).toHaveLength(1);
  });

  it("approve adopts an existing college and user instead of duplicating them", async () => {
    const { authenticationToken } = await createTestPlatformAdmin();
    const existingUser = await UserModel.create({
      emailAddress: "principal@newcollege.edu",
      fullName: "Existing Person",
    });
    const applicationId = await submitAndGetId();
    // Created AFTER submit, so the application carries no linkedCollegeId and
    // approval must adopt it through the case-insensitive name fallback.
    const existingCollege = await CollegeModel.create({
      collegeName: "New Horizon College",
      commonName: "NHC",
      city: "Bengaluru",
      state: "Karnataka",
      isVerified: false,
      status: "reference",
    });

    const response = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/approve`)
      .set("Authorization", `Bearer ${authenticationToken}`);
    expect(response.status).toBe(200);

    // No second college or user row; the existing college is elevated live.
    expect(await CollegeModel.countDocuments({})).toBe(1);
    expect(await UserModel.countDocuments({ emailAddress: "principal@newcollege.edu" })).toBe(1);
    const refreshedCollege = await CollegeModel.findById(existingCollege._id);
    expect(refreshedCollege.isVerified).toBe(true);
    expect(refreshedCollege.status).toBe("active");

    const assignment = await StaffAssignmentModel.findOne({
      userId: existingUser._id,
      role: "administrator",
      status: "active",
    });
    expect(assignment).not.toBeNull();
  });

  it("approve elevates the linked reference college in place — no new college row", async () => {
    const { authenticationToken } = await createTestPlatformAdmin();
    const referenceCollege = await CollegeModel.create({
      collegeName: "New Horizon College",
      commonName: "New Horizon",
      city: "Bengaluru",
      state: "Karnataka",
      isVerified: true,
      status: "reference",
    });
    const applicationId = await submitAndGetId();

    const storedApplication = await CollegeApplicationModel.findById(applicationId);
    expect(String(storedApplication.linkedCollegeId)).toBe(String(referenceCollege._id));

    const response = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/approve`)
      .set("Authorization", `Bearer ${authenticationToken}`);
    expect(response.status).toBe(200);

    // The SAME document went live; nothing was duplicated.
    expect(await CollegeModel.countDocuments({})).toBe(1);
    const elevatedCollege = await CollegeModel.findById(referenceCollege._id);
    expect(elevatedCollege.status).toBe("active");
    expect(elevatedCollege.isVerified).toBe(true);
    // The directory identity is untouched — only the status changed.
    expect(elevatedCollege.commonName).toBe("New Horizon");

    const administratorUser = await UserModel.findOne({
      emailAddress: "principal@newcollege.edu",
    });
    expect(String(administratorUser.collegeId)).toBe(String(referenceCollege._id));
  });

  it("refuses to approve an already-approved application with 409", async () => {
    const { authenticationToken } = await createTestPlatformAdmin();
    const applicationId = await submitAndGetId();

    const firstApproval = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/approve`)
      .set("Authorization", `Bearer ${authenticationToken}`);
    expect(firstApproval.status).toBe(200);

    const secondApproval = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/approve`)
      .set("Authorization", `Bearer ${authenticationToken}`);
    expect(secondApproval.status).toBe(409);
    expect(secondApproval.body.error.code).toBe("APPLICATION_ALREADY_REVIEWED");

    // The provisioning stayed idempotent: still exactly one assignment.
    expect(await StaffAssignmentModel.countDocuments({ role: "administrator" })).toBe(1);
  });

  it("reject requires a reason of at least ten characters and stores it", async () => {
    const { authenticationToken } = await createTestPlatformAdmin();
    const applicationId = await submitAndGetId();

    const missingReason = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/reject`)
      .set("Authorization", `Bearer ${authenticationToken}`)
      .send({});
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.error.code).toBe("VALIDATION_FAILED");

    const tooShort = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/reject`)
      .set("Authorization", `Bearer ${authenticationToken}`)
      .send({ reason: "too short" });
    expect(tooShort.status).toBe(400);

    const rejection = await request(application)
      .post(`${ADMIN_LIST_PATH}/${applicationId}/reject`)
      .set("Authorization", `Bearer ${authenticationToken}`)
      .send({ reason: "The AISHE registration could not be verified." });
    expect(rejection.status).toBe(200);
    expect(rejection.body.data.application.status).toBe("rejected");
    expect(rejection.body.data.application.rejectionReason).toBe(
      "The AISHE registration could not be verified."
    );

    const rejectionEmails = findRecordedEmailsOfKind("applicationRejected");
    expect(rejectionEmails).toHaveLength(1);
    expect(rejectionEmails[0].reason).toBe("The AISHE registration could not be verified.");

    // A rejected application no longer blocks the address from reapplying.
    const reapplication = await postApplication(buildApplicationPayload());
    expect(reapplication.status).toBe(201);
  });
});
