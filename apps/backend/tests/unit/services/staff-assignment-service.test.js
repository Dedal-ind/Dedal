import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import {
  installEmailServiceMock,
  getRecordedEmails,
  clearRecordedEmails,
} from "../../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
} from "../../setup/create-test-fixtures.js";

// Seeded before the service graph requires the real email service.
installEmailServiceMock();
const staffAssignmentService = await import("../../../src/services/staff-assignment-service.js");

const INVITEE_EMAIL = "coordinator@example.com";
const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let outsider;
let fest;

function buildPayload(overrides = {}) {
  return { emailAddress: INVITEE_EMAIL, role: "coordinator", eventIds: [], ...overrides };
}

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
  await UserModel.createIndexes();
  await EventModel.createIndexes();
  await FestModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("assignStaffMember", () => {
  it("creates an active fest-scoped assignment and emails the invitee", async () => {
    const assignment = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload()
    );

    expect(assignment.role).toBe("coordinator");
    expect(assignment.status).toBe("active");
    expect(assignment.festId.toString()).toBe(fest.id);
    expect(assignment.assignedByUserId.toString()).toBe(admin.user._id.toString());
    expect(getRecordedEmails()).toHaveLength(1);
    expect(getRecordedEmails()[0].emailAddress).toBe(INVITEE_EMAIL);
  });

  /* An invitee who has never signed in still needs a userId to hang the grant on. */
  it("creates a placeholder user for an address that has none", async () => {
    await staffAssignmentService.assignStaffMember(admin.user._id, fest.id, buildPayload());

    const invitee = await UserModel.findOne({ emailAddress: INVITEE_EMAIL });
    expect(invitee).not.toBeNull();
    expect(invitee.emailVerifiedAt).toBe(null);
    expect(invitee.isProfileComplete).toBe(false);
  });

  it("reuses an existing user rather than creating a second one", async () => {
    const existing = await UserModel.create({ emailAddress: INVITEE_EMAIL });

    const assignment = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload()
    );

    // userId is populated on insert, so it is a summary object rather than a bare id.
    expect(assignment.userId.id).toBe(existing._id.toString());
    expect(await UserModel.countDocuments({ emailAddress: INVITEE_EMAIL })).toBe(1);
  });

  it("populates the invitee summary on the returned assignment", async () => {
    const assignment = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload()
    );

    expect(typeof assignment.userId).toBe("object");
    expect(assignment.userId.emailAddress).toBe(INVITEE_EMAIL);
    expect(assignment.userId).toHaveProperty("isProfileComplete");
  });

  it("assigns a volunteer as readily as a coordinator", async () => {
    const assignment = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload({ role: "volunteer" })
    );
    expect(assignment.role).toBe("volunteer");
  });

  it("refuses a caller who does not administer the fest", async () => {
    await expect(
      staffAssignmentService.assignStaffMember(outsider.user._id, fest.id, buildPayload())
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED", statusCode: 403 });
  });

  it("refuses a fest that does not exist", async () => {
    await expect(
      staffAssignmentService.assignStaffMember(admin.user._id, MISSING_ID, buildPayload())
    ).rejects.toMatchObject({ errorCode: "FEST_NOT_FOUND", statusCode: 404 });
  });

  it("refuses to assign the administrator to their own fest", async () => {
    await expect(
      staffAssignmentService.assignStaffMember(
        admin.user._id,
        fest.id,
        buildPayload({ emailAddress: admin.user.emailAddress })
      )
    ).rejects.toMatchObject({ errorCode: "CANNOT_ASSIGN_SELF", statusCode: 400 });
  });

  it("refuses a duplicate active grant of the same role", async () => {
    await staffAssignmentService.assignStaffMember(admin.user._id, fest.id, buildPayload());

    await expect(
      staffAssignmentService.assignStaffMember(admin.user._id, fest.id, buildPayload())
    ).rejects.toMatchObject({ errorCode: "ASSIGNMENT_ALREADY_EXISTS", statusCode: 409 });
  });

  /* The unique index is filtered to active rows, so a revoked grant is re-grantable. */
  it("re-invites a revoked member as a new row, leaving the revoked one untouched", async () => {
    const first = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload()
    );
    await staffAssignmentService.revokeStaffAssignment(admin.user._id, fest.id, first.id);

    const second = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload()
    );

    expect(second.status).toBe("active");
    expect(second.id).not.toBe(first.id);

    // The revoked row survives as history rather than being resurrected.
    const revokedRow = await StaffAssignmentModel.findById(first.id);
    expect(revokedRow.status).toBe("revoked");
    expect(revokedRow.revokedAt).toBeInstanceOf(Date);

    expect(await StaffAssignmentModel.countDocuments({ festId: fest._id })).toBe(2);
  });

  /* Only a live grant blocks a re-invite, and the conflict names the row that blocks it. */
  it("names the blocking assignment when an active grant already exists", async () => {
    const existing = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload()
    );

    const error = await staffAssignmentService
      .assignStaffMember(admin.user._id, fest.id, buildPayload())
      .catch((caughtError) => caughtError);

    expect(error.errorCode).toBe("ASSIGNMENT_ALREADY_EXISTS");
    expect(error.statusCode).toBe(409);
    expect(error.details.existingAssignmentId).toBe(existing.id);
    expect(error.details.role).toBe("coordinator");
  });

  it("lets the same person hold both roles in one fest", async () => {
    await staffAssignmentService.assignStaffMember(admin.user._id, fest.id, buildPayload());
    const volunteer = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload({ role: "volunteer" })
    );
    expect(volunteer.status).toBe("active");
  });

  /* The mock always delivers; the warning field only appears when it does not. */
  /* An empty list means "no assignments", never an error, so the Home tile can trust it. */
  it("returns an empty array for a user with no assignments", async () => {
    const result = await staffAssignmentService.listMyStaffAssignments(outsider.user._id);

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });

  it("carries no warning when the invitation is delivered", async () => {
    const assignment = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload()
    );

    expect(assignment.warning).toBeUndefined();
    // The admin's own college grant, plus the one just created.
    expect(await StaffAssignmentModel.countDocuments()).toBe(2);
  });
});
