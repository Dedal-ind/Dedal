import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { VolunteerShiftModel } from "../../src/models/volunteer-shift-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestStaffMember,
  createTestGateCheckpoint,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * The ADMIN shift path over REAL HTTP — middleware included.
 *
 * The shifts-screen 500 lived precisely in the gap these tests close: the
 * service's happy path was unit-tested with a hand-built actor (isAdministrator
 * true), and the HTTP suites only asserted the REJECTION paths — so nothing ever
 * exercised requireAdministratorMiddleware → buildActor → coordinatorCoverageSet
 * together. That chain never set request.isAdministrator, the admin was treated
 * as a coordinator with no assignment, and assignmentCoversEvent dereferenced
 * undefined. Every test here goes through the full route, never the service.
 */
let college;
let admin;
let fest;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  await setupTestDatabase();
  await VolunteerShiftModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("admin shift endpoints over HTTP", () => {
  it("lists 200 with an empty array for a fest with volunteers but zero shifts (the screenshot state)", async () => {
    await createTestStaffMember(fest, "volunteer", {
      emailAddress: "empty-list-volunteer@example.com",
    });
    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/shifts?status=all`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data.shifts).toEqual([]);
  });

  it("an administrator CREATES a shift through the real route — the exact call that 500ed", async () => {
    const volunteer = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "shift-volunteer@example.com",
    });
    const checkpoint = await createTestGateCheckpoint(fest);
    const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    const createResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/shifts`),
      admin.authenticationToken
    ).send({
      userId: String(volunteer.user._id),
      checkpointId: String(checkpoint._id),
      startsAt,
      endsAt,
    });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.shift).toMatchObject({
      userFullName: null, // fixture volunteer has no fullName; the DTO degrades, not crashes
      checkpointName: "Main Gate",
      status: "scheduled",
    });

    // …and the row shows in the list the screen renders.
    const listResponse = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/shifts?status=all`),
      admin.authenticationToken
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.shifts).toHaveLength(1);

    // …and the volunteer sees it on /shifts/mine — the /backstage banner's source.
    const mineResponse = await withToken(
      request(application).get("/api/v1/shifts/mine"),
      volunteer.authenticationToken
    );
    expect(mineResponse.status).toBe(200);
    expect(mineResponse.body.data.shifts).toHaveLength(1);
    expect(mineResponse.body.data.shifts[0]).toMatchObject({
      checkpointName: "Main Gate",
      festName: fest.festName,
    });
  });

  it("admin update and cancel also survive the real route (same broken chain)", async () => {
    const volunteer = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "mutate-volunteer@example.com",
    });
    const checkpoint = await createTestGateCheckpoint(fest);
    const created = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/shifts`),
      admin.authenticationToken
    ).send({
      userId: String(volunteer.user._id),
      checkpointId: String(checkpoint._id),
      startsAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });
    const shiftId = created.body.data.shift.shiftId;

    const patched = await withToken(
      request(application).patch(`/api/v1/fests/${fest.id}/shifts/${shiftId}`),
      admin.authenticationToken
    ).send({ endsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() });
    expect(patched.status).toBe(200);

    const cancelled = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/shifts/${shiftId}/cancel`),
      admin.authenticationToken
    ).send({ cancellationReason: "Rescheduled marshal" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.shift.status).toBe("cancelled");
  });
});
