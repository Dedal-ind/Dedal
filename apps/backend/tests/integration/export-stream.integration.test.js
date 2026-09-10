import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
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
  createTestEvent,
  createTestParticipant,
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * The Data Controls export downloads, end to end over HTTP.
 *
 * These exist because five of the six exports shipped WITHOUT passing their
 * cursor into streamCursorAsCsv: the header row went out (200, streaming), then
 * `for await (undefined)` threw mid-stream and the connection was destroyed —
 * curl reported "transfer closed with outstanding read data remaining", the
 * browser's response.blob() rejected, and the admin saw "could not be
 * downloaded". A status-code assertion alone cannot catch that class of bug;
 * the BODY must be asserted complete (header + data rows).
 */
let college;
let admin;
let fest;
let event;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user);
});

describe("export CSV streaming", () => {
  it("registrations.csv arrives complete: 200, text/csv, header + a data row", async () => {
    const participant = await createTestParticipant(college, {
      emailAddress: "export-person@example.com",
      fullName: "Export Person",
    });
    await RegistrationModel.create({
      eventId: event._id,
      userId: participant.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: 0,
      registeredAt: new Date(),
    });

    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/exports/registrations.csv`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    const lines = response.text.trim().split(/\r?\n/);
    expect(lines[0]).toContain("registrationId");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(response.text).toContain("Export Person");
  });

  it("staff-assignments.csv (one of the five that streamed nothing) arrives complete", async () => {
    await createTestStaffMember(fest, "volunteer", {
      emailAddress: "exported-volunteer@example.com",
    });

    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/exports/staff-assignments.csv`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    const lines = response.text.trim().split(/\r?\n/);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(response.text).toContain("exported-volunteer@example.com");
  });
});
