import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import {
  installEmailServiceMock,
  findRecordedEmailsOfKind,
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
} from "../../setup/create-test-fixtures.js";

installEmailServiceMock();
const staffAssignmentService = await import("../../../src/services/staff-assignment-service.js");

const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let outsider;
let fest;

function assignPayload(emailAddress, role) {
  return { emailAddress, role, eventIds: [] };
}

async function assign(emailAddress, role) {
  return staffAssignmentService.assignStaffMember(
    admin.user._id,
    fest.id,
    assignPayload(emailAddress, role)
  );
}

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
  await UserModel.createIndexes();
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

describe("listStaffAssignmentsForFest", () => {
  it("returns an empty list for a fest with no staff", async () => {
    expect(await staffAssignmentService.listStaffAssignmentsForFest(admin.user._id, fest.id))
      .toEqual([]);
  });

  it("returns only this fest's assignments", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    await assign("here@example.com", "coordinator");
    await staffAssignmentService.assignStaffMember(
      admin.user._id,
      otherFest.id,
      assignPayload("elsewhere@example.com", "coordinator")
    );

    const assignments = await staffAssignmentService.listStaffAssignmentsForFest(
      admin.user._id,
      fest.id
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0].festId.toString()).toBe(fest.id);
  });

  /* Active before revoked; coordinator before volunteer; newest first inside a tie. */
  it("sorts active before revoked, then coordinator before volunteer", async () => {
    const revoked = await assign("revoked@example.com", "coordinator");
    await staffAssignmentService.revokeStaffAssignment(admin.user._id, fest.id, revoked.id);
    await assign("volunteer@example.com", "volunteer");
    await assign("coordinator@example.com", "coordinator");

    const assignments = await staffAssignmentService.listStaffAssignmentsForFest(
      admin.user._id,
      fest.id
    );

    expect(assignments.map((assignment) => [assignment.status, assignment.role])).toEqual([
      ["active", "coordinator"],
      ["active", "volunteer"],
      ["revoked", "coordinator"],
    ]);
  });

  it("refuses a caller who does not administer the fest", async () => {
    await expect(
      staffAssignmentService.listStaffAssignmentsForFest(outsider.user._id, fest.id)
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED", statusCode: 403 });
  });

  it("refuses a fest that does not exist", async () => {
    await expect(
      staffAssignmentService.listStaffAssignmentsForFest(admin.user._id, MISSING_ID)
    ).rejects.toMatchObject({ errorCode: "FEST_NOT_FOUND" });
  });
});

describe("revokeStaffAssignment", () => {
  it("revokes an active assignment, stamps the time and emails the holder", async () => {
    const assignment = await assign("coordinator@example.com", "coordinator");

    const revoked = await staffAssignmentService.revokeStaffAssignment(
      admin.user._id,
      fest.id,
      assignment.id
    );

    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(revoked.revocationReason).toBe(null);

    const emails = findRecordedEmailsOfKind("assignmentRevocation");
    expect(emails).toHaveLength(1);
    expect(emails[0].emailAddress).toBe("coordinator@example.com");
  });

  it("records the reason when one is given, and passes it to the email", async () => {
    const assignment = await assign("coordinator@example.com", "coordinator");

    const revoked = await staffAssignmentService.revokeStaffAssignment(
      admin.user._id,
      fest.id,
      assignment.id,
      "Left the college"
    );

    expect(revoked.revocationReason).toBe("Left the college");
    expect(findRecordedEmailsOfKind("assignmentRevocation")[0].reason).toBe("Left the college");
  });

  /* Revoking twice is a no-op, and must not send a second email. */
  it("is idempotent", async () => {
    const assignment = await assign("coordinator@example.com", "coordinator");
    const first = await staffAssignmentService.revokeStaffAssignment(
      admin.user._id,
      fest.id,
      assignment.id
    );
    const second = await staffAssignmentService.revokeStaffAssignment(
      admin.user._id,
      fest.id,
      assignment.id,
      "A different reason"
    );

    expect(second.status).toBe("revoked");
    expect(second.revokedAt.getTime()).toBe(new Date(first.revokedAt).getTime());
    expect(second.revocationReason).toBe(null);
    expect(findRecordedEmailsOfKind("assignmentRevocation")).toHaveLength(1);
  });

  it("refuses a caller who does not administer the fest", async () => {
    const assignment = await assign("coordinator@example.com", "coordinator");

    await expect(
      staffAssignmentService.revokeStaffAssignment(outsider.user._id, fest.id, assignment.id)
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED" });
  });

  it("treats a missing assignment and a malformed id alike as a 404", async () => {
    for (const badId of [MISSING_ID, "not-an-object-id"]) {
      await expect(
        staffAssignmentService.revokeStaffAssignment(admin.user._id, fest.id, badId)
      ).rejects.toMatchObject({ errorCode: "ASSIGNMENT_NOT_FOUND", statusCode: 404 });
    }
  });

  /* An assignment under another fest must not be distinguishable from a missing one. */
  it("hides an assignment that belongs to another fest", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    const foreign = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      otherFest.id,
      assignPayload("elsewhere@example.com", "coordinator")
    );

    await expect(
      staffAssignmentService.revokeStaffAssignment(admin.user._id, fest.id, foreign.id)
    ).rejects.toMatchObject({ errorCode: "ASSIGNMENT_NOT_FOUND" });
  });
});

describe("listMyStaffAssignments", () => {
  it("returns the caller's active assignments across every fest", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    await assign("staff@example.com", "coordinator");
    await staffAssignmentService.assignStaffMember(
      admin.user._id,
      otherFest.id,
      assignPayload("staff@example.com", "volunteer")
    );

    const staffUser = await UserModel.findOne({ emailAddress: "staff@example.com" });
    const assignments = await staffAssignmentService.listMyStaffAssignments(staffUser._id);

    expect(assignments).toHaveLength(2);
  });

  /* A revoked assignment grants nothing, so it is not the holder's business to see. */
  it("hides revoked assignments", async () => {
    const assignment = await assign("staff@example.com", "coordinator");
    await staffAssignmentService.revokeStaffAssignment(admin.user._id, fest.id, assignment.id);

    const staffUser = await UserModel.findOne({ emailAddress: "staff@example.com" });
    expect(await staffAssignmentService.listMyStaffAssignments(staffUser._id)).toEqual([]);
  });

  it("never returns another user's assignments", async () => {
    await assign("staff@example.com", "coordinator");
    expect(await staffAssignmentService.listMyStaffAssignments(outsider.user._id)).toEqual([]);
  });

  it("returns an empty list for a user with no assignments", async () => {
    expect(await staffAssignmentService.listMyStaffAssignments(outsider.user._id)).toEqual([]);
  });
});
