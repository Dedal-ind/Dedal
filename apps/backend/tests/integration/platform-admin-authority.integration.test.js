/*
 * platform-admin-authority.integration.test.js
 *
 * The platform owner's god mode, pinned at the gate that refused it.
 *
 * A platform admin's staff assignment carries no collegeId and no festId — it
 * is not "of" a college, it is over every college. So the college-scoped row
 * lookup findActiveAdministratorAssignment returns null for them against every
 * college on the system, and any gate that asked THAT question instead of "does
 * this user hold administrator authority here" refused the one account that is
 * supposed to be able to open everything.
 *
 * requireCoordinatorOrAdminMiddleware asked the wrong one, which is why the
 * analytics summary, the hygiene report and the export counts all returned 403
 * to the platform owner while the administrator-only exports on the SAME router
 * returned 200 — that chain had grown its own private god-mode branch.
 *
 * These tests are deliberately at the HTTP boundary and deliberately cover both
 * chains, because the failure was a divergence BETWEEN the two: a unit test on
 * either middleware alone would have passed throughout.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestOutsider,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let fest;
let platformAdminToken;

/*
 * The platform owner, built here rather than in the shared fixtures because the
 * shape is the point: collegeId and festId are BOTH absent. A fixture that
 * quietly attached a college would make every assertion below vacuous.
 */
async function createPlatformAdmin() {
  const user = await UserModel.create({ emailAddress: "owner@example.com" });
  await StaffAssignmentModel.create({
    userId: user._id,
    role: "platformAdmin",
    assignedByUserId: user._id,
  });
  return createAuthenticationToken({ id: user.id, emailAddress: user.emailAddress });
}

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  /*
   * The fest is hosted by a college the platform admin holds NO assignment for.
   * That is the whole scenario — authority has to come from the platform role
   * alone, never from an incidental membership.
   */
  const college = await createTestCollege();
  const administrator = await createTestAdministrator(college);
  fest = await createTestFest(college, administrator.user);
  await createTestEvent(fest, administrator.user);
  platformAdminToken = await createPlatformAdmin();
});

function asPlatformAdmin(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${platformAdminToken}`);
}

describe("platform admin authority on the coordinator-or-admin gate", () => {
  it("the platform owner holds no assignment for the fest's host college", async () => {
    /* Guards the premise. If this ever starts failing, the tests below are
       passing for the wrong reason — an incidental college assignment. */
    const collegeScopedRows = await StaffAssignmentModel.find({
      role: "administrator",
      collegeId: { $ne: null },
    }).lean();
    const platformRow = await StaffAssignmentModel.findOne({ role: "platformAdmin" }).lean();

    expect(platformRow).not.toBeNull();
    expect(platformRow.collegeId ?? null).toBeNull();
    expect(platformRow.festId ?? null).toBeNull();
    expect(
      collegeScopedRows.some((row) => String(row.userId) === String(platformRow.userId))
    ).toBe(false);
  });

  it("serves the analytics summary to the platform owner", async () => {
    const response = await asPlatformAdmin(
      request(application).get(`/api/v1/fests/${fest._id}/analytics/summary`)
    );

    expect(response.status).toBe(200);
  });

  it("serves the hygiene report to the platform owner", async () => {
    const response = await asPlatformAdmin(
      request(application).get(`/api/v1/fests/${fest._id}/analytics/hygiene`)
    );

    expect(response.status).toBe(200);
  });

  it("serves the export counts to the platform owner", async () => {
    const response = await asPlatformAdmin(
      request(application).get(`/api/v1/fests/${fest._id}/exports/counts`)
    );

    expect(response.status).toBe(200);
  });

  it("agrees with the administrator-only chain on the same fest", async () => {
    /*
     * The regression in one assertion: both gates must reach the same verdict
     * for the same user on the same fest. Before the fix the payments export
     * (administrator-only, which had god mode) returned 200 while the summary
     * (coordinator-or-admin, which did not) returned 403.
     */
    const administratorChain = await asPlatformAdmin(
      request(application).get(`/api/v1/fests/${fest._id}/exports/payments.csv`)
    );
    const coordinatorOrAdminChain = await asPlatformAdmin(
      request(application).get(`/api/v1/fests/${fest._id}/analytics/summary`)
    );

    expect(administratorChain.status).toBe(200);
    expect(coordinatorOrAdminChain.status).toBe(200);
  });

  it("still refuses a user with no assignment anywhere", async () => {
    /* God mode must not have widened into "any authenticated user". */
    const outsider = await createTestOutsider();

    const response = await request(application)
      .get(`/api/v1/fests/${fest._id}/analytics/summary`)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`);

    expect(response.status).toBe(403);
  });

  it("refuses a platform admin whose assignment is revoked", async () => {
    await StaffAssignmentModel.updateOne({ role: "platformAdmin" }, { $set: { status: "revoked" } });

    const response = await asPlatformAdmin(
      request(application).get(`/api/v1/fests/${fest._id}/analytics/summary`)
    );

    expect(response.status).toBe(403);
  });
});
