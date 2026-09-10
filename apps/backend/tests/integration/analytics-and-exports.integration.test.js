import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
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
  createTestParticipant,
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let eventA;
let eventB;
let participantCounter = 0;

function asAdmin(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${admin.authenticationToken}`);
}

async function createRegistration(event, overrides = {}) {
  participantCounter += 1;
  const participant = await createTestParticipant(college, {
    emailAddress: `analytics${participantCounter}@example.com`,
    usn: `1AN00AA${participantCounter.toString().padStart(3, "0")}`,
  });
  const registration = await RegistrationModel.create({
    eventId: event._id,
    userId: participant.user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
    totalFeePaise: 0,
    registeredAt: new Date(),
    ...overrides,
  });
  return { participant, registration };
}

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  eventA = await createTestEvent(fest, admin.user, { status: "published", eventSlug: "event-a" });
  eventB = await createTestEvent(fest, admin.user, { status: "published", eventSlug: "event-b" });
});

afterAll(teardownTestDatabase);

describe("GET /api/v1/fests/:festId/analytics/summary", () => {
  it("funnel counts add up, revenue sums, and demographic buckets tie out including null gender", async () => {
    await createRegistration(eventA, { totalFeePaise: 10000 });
    await createRegistration(eventA, { totalFeePaise: 20000, genderCategory: "female" });
    await createRegistration(eventB, { status: "pendingPayment", paymentStatus: "pending", totalFeePaise: 5000 });
    await createRegistration(eventB, { status: "cancelled" });
    await createRegistration(eventB, { status: "paymentExpired", paymentStatus: "expired" });

    const response = await asAdmin(request(application).get(`/api/v1/fests/${fest.id}/analytics/summary`));
    expect(response.status).toBe(200);
    const { funnel, revenue, demographics } = response.body.data;

    // (a) initiated = pending + confirmed + cancelled + expired.
    expect(funnel.registrationsInitiated).toBe(5);
    expect(
      funnel.registrationsPendingPayment +
        funnel.registrationsConfirmed +
        funnel.registrationsCancelled +
        funnel.registrationsPaymentExpired
    ).toBe(funnel.registrationsInitiated);
    expect(funnel.conversion).toMatchObject({ numerator: 2, denominator: 5 });

    // (b) gross revenue equals the sum over confirmed rows only.
    expect(revenue.grossRevenuePaise).toBe(30000);
    expect(revenue.pendingRevenuePaise).toBe(5000);

    // (c) buckets sum to the distinct confirmed participant count, null gender included.
    const genderTotal = demographics.byGender.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(genderTotal).toBe(demographics.totalConfirmedParticipants);
    expect(demographics.totalConfirmedParticipants).toBe(2);
    expect(demographics.byGender.find((bucket) => bucket.gender === "unspecified")?.count).toBe(1);
  });

  it("(d) a coordinator sees only their covered events in the summary and export", async () => {
    await createRegistration(eventA);
    await createRegistration(eventB);
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "analytics-coordinator@example.com",
      assignment: { eventIds: [eventA._id] },
    });

    const summaryResponse = await request(application)
      .get(`/api/v1/fests/${fest.id}/analytics/summary`)
      .set("Authorization", `Bearer ${coordinator.authenticationToken}`);
    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.scopedEventCount).toBe(1);
    expect(summaryResponse.body.data.funnel.registrationsInitiated).toBe(1);

    const exportResponse = await request(application)
      .get(`/api/v1/fests/${fest.id}/exports/registrations.csv`)
      .set("Authorization", `Bearer ${coordinator.authenticationToken}`);
    expect(exportResponse.status).toBe(200);
    // Header row + exactly the one covered registration.
    const lines = exportResponse.text.trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("exports", () => {
  it("(e) streams a CSV with the right headers and row count, and (f) writes an audit row", async () => {
    await createRegistration(eventA);
    await createRegistration(eventA);

    const response = await asAdmin(
      request(application).get(`/api/v1/fests/${fest.id}/exports/registrations.csv`)
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain("registrations");
    const lines = response.text.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toContain("registrationId");

    const auditRow = await AuditLogModel.findOne({ action: "data.exported" }).lean();
    expect(auditRow).not.toBe(null);
    expect(auditRow.afterState).toMatchObject({ exportType: "registrations", rowCount: 2 });
  });

  it("refuses the payments export to a coordinator (admin only)", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "payments-coordinator@example.com",
      assignment: { eventIds: [eventA._id] },
    });
    const response = await request(application)
      .get(`/api/v1/fests/${fest.id}/exports/payments.csv`)
      .set("Authorization", `Bearer ${coordinator.authenticationToken}`);
    expect(response.status).toBe(403);
  });

  it("returns per-type counts for the exports tab", async () => {
    await createRegistration(eventA);
    const response = await asAdmin(request(application).get(`/api/v1/fests/${fest.id}/exports/counts`));
    expect(response.status).toBe(200);
    expect(response.body.data.registrations).toBe(1);
    expect(response.body.data.payments).toBe(0);
  });
});

describe("GET /api/v1/fests/:festId/analytics/hygiene", () => {
  it("(g) finds a manufactured confirmed-without-pass orphan and samples its id", async () => {
    // A confirmed registration whose holder was never issued a pass.
    const { registration } = await createRegistration(eventA);

    const response = await asAdmin(request(application).get(`/api/v1/fests/${fest.id}/analytics/hygiene`));
    expect(response.status).toBe(200);
    const finding = response.body.data.findings.find(
      (candidate) => candidate.code === "registrationsMarkedConfirmedWithoutPass"
    );
    expect(finding.count).toBe(1);
    expect(finding.sampleIds).toContain(String(registration._id));
  });
});
