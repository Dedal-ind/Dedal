/*
 * PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
 *
 * These tests exist as much to pin the BOUNDS as the behaviour: the environment
 * gate, the one-fest scope, the preserved audit row, and the untouched
 * neighbouring fest. If the tool is removed at handover, this file goes with it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { ScanModel } from "../../src/models/scan-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { PaymentOrderModel } from "../../src/models/payment-order-model.js";
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
  createTestPass,
  createTestGateEntitlement,
  createTestGateCheckpoint,
  createTestStaffMember,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");
const { applicationConfig } = await import("../../src/config/application-config.js");

let college;
let admin;
let fest;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

/* A fest with something in every collection the purge walks. */
async function seedFullFest(festOverrides = {}) {
  const seededFest = await createTestFest(college, admin.user, {
    status: "published",
    ...festOverrides,
  });
  const event = await createTestEvent(
    seededFest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: `${seededFest.festSlug}-event`,
      eventName: "Finance",
    })
  );
  const participant = await createTestParticipant(college, {
    emailAddress: `purge-${seededFest.festSlug}@example.com`,
    usn: `1PG${seededFest.festSlug.slice(0, 3).toUpperCase()}001`,
  });
  await RegistrationModel.create({
    eventId: event._id,
    userId: participant.user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
    totalFeePaise: 5000,
    paymentStatus: "completed",
    paymentGroupId: `purge-group-${seededFest.festSlug}`,
    registeredAt: new Date(),
  });
  await PaymentOrderModel.create({
    paymentGroupId: `purge-group-${seededFest.festSlug}`,
    razorpayOrderId: `order_purge_${seededFest.festSlug}`,
    registrationFeePaise: 5000,
    totalAmountPaise: 7000,
    status: "captured",
  });
  const pass = await createTestPass(seededFest, participant.user);
  await createTestGateEntitlement(pass);
  const checkpoint = await createTestGateCheckpoint(seededFest);
  await ScanModel.create({
    clientScanId: `purge-scan-${seededFest.festSlug}`,
    passId: pass._id,
    checkpointId: checkpoint._id,
    scannedByUserId: admin.user._id,
    scanMethod: "qr",
    direction: "in",
    result: "accepted",
    scannedAt: new Date(),
  });
  await createTestStaffMember(seededFest, "volunteer", {
    emailAddress: `purge-volunteer-${seededFest.festSlug}@example.com`,
  });
  return { fest: seededFest, event, participant };
}

beforeAll(async () => {
  await setupTestDatabase();
  await RegistrationModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  const seeded = await seedFullFest({ festName: "Purge Me", festSlug: "purge-me" });
  fest = seeded.fest;
});

afterAll(teardownTestDatabase);

describe("dev-only fest purge — the bounds", () => {
  it("refuses in production with 403 PURGE_NOT_ALLOWED_IN_ENVIRONMENT and deletes NOTHING", async () => {
    const productionSpy = vi
      .spyOn(applicationConfig, "applicationEnvironment", "get")
      .mockReturnValue("production");

    try {
      const response = await withToken(
        request(application).delete(`/api/v1/fests/${fest.id}/purge`),
        admin.authenticationToken
      );
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("PURGE_NOT_ALLOWED_IN_ENVIRONMENT");
      // The gate is at the route, so nothing was touched.
      expect(await FestModel.countDocuments({ _id: fest._id })).toBe(1);
      expect(await EventModel.countDocuments({ festId: fest._id })).toBe(1);
      expect(await RegistrationModel.countDocuments({})).toBe(1);

      const previewResponse = await withToken(
        request(application).get(`/api/v1/fests/${fest.id}/purge-preview`),
        admin.authenticationToken
      );
      expect(previewResponse.status).toBe(403);
    } finally {
      productionSpy.mockRestore();
    }
  });

  it("there is no purge-all-fests route — one fest per request, always", async () => {
    const response = await withToken(
      request(application).delete("/api/v1/fests/purge"),
      admin.authenticationToken
    );
    // Whatever it matches, it must not be a successful mass purge.
    expect(response.status).not.toBe(200);
    expect(await FestModel.countDocuments({})).toBeGreaterThan(0);
  });
});

describe("dev-only fest purge — behaviour", () => {
  it("previews real counts, then purges every dependent and the fest itself", async () => {
    const preview = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/purge-preview`),
      admin.authenticationToken
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.festName).toBe("Purge Me");
    expect(preview.body.data.counts).toMatchObject({
      events: 1,
      registrations: 1,
      passes: 1,
      entitlements: 1,
      checkpoints: 1,
      scans: 1,
      paymentOrders: 1,
      staffAssignments: 1,
      // Compliance evidence about a PERSON outlives anything an admin deletes.
      consentRecordsPreserved: true,
    });

    const response = await withToken(
      request(application).delete(`/api/v1/fests/${fest.id}/purge`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data.purgedCounts.registrations).toBe(1);

    // Everything under the fest is gone, the fest last.
    expect(await FestModel.countDocuments({ _id: fest._id })).toBe(0);
    expect(await EventModel.countDocuments({ festId: fest._id })).toBe(0);
    expect(await RegistrationModel.countDocuments({})).toBe(0);
    expect(await PassModel.countDocuments({ festId: fest._id })).toBe(0);
    expect(await EntitlementModel.countDocuments({})).toBe(0);
    expect(await CheckpointModel.countDocuments({ festId: fest._id })).toBe(0);
    expect(await ScanModel.countDocuments({})).toBe(0);
    expect(await PaymentOrderModel.countDocuments({})).toBe(0);
    // The deletion guard was bypassed only through the marked purge option.
    expect(await StaffAssignmentModel.countDocuments({ festId: fest._id })).toBe(0);

    /*
     * The purge audit row SURVIVES its own purge: written first, excluded from the
     * audit delete, and still naming what was destroyed.
     */
    const purgeAudit = await AuditLogModel.findOne({ action: "test.festPurged" });
    expect(purgeAudit).not.toBeNull();
    expect(purgeAudit.beforeState.festName).toBe("Purge Me");
    expect(purgeAudit.afterState.purgedCounts.registrations).toBe(1);
    // …and every other audit row for that fest is gone.
    expect(
      await AuditLogModel.countDocuments({ festId: fest._id, action: { $ne: "test.festPurged" } })
    ).toBe(0);
  });

  it("touches only the named fest — a neighbouring fest is completely unaffected", async () => {
    const neighbour = await seedFullFest({ festName: "Keep Me", festSlug: "keep-me" });

    await withToken(
      request(application).delete(`/api/v1/fests/${fest.id}/purge`),
      admin.authenticationToken
    );

    expect(await FestModel.countDocuments({ _id: neighbour.fest._id })).toBe(1);
    expect(await EventModel.countDocuments({ festId: neighbour.fest._id })).toBe(1);
    expect(await PassModel.countDocuments({ festId: neighbour.fest._id })).toBe(1);
    expect(await CheckpointModel.countDocuments({ festId: neighbour.fest._id })).toBe(1);
    expect(await ScanModel.countDocuments({})).toBe(1);
    expect(await RegistrationModel.countDocuments({})).toBe(1);
    expect(await StaffAssignmentModel.countDocuments({ festId: neighbour.fest._id })).toBe(1);
  });

  it("rate limits an administrator to five purges an hour", async () => {
    // Four more fests, so six purges are attempted in total.
    const extraFests = [];
    for (let index = 0; index < 5; index += 1) {
      const seeded = await seedFullFest({
        festName: `Rate ${index}`,
        festSlug: `rate-limit-${index}`,
      });
      extraFests.push(seeded.fest);
    }

    // The beforeEach fest is purge #1; four of the extras take it to five.
    await withToken(
      request(application).delete(`/api/v1/fests/${fest.id}/purge`),
      admin.authenticationToken
    );
    for (let index = 0; index < 4; index += 1) {
      const response = await withToken(
        request(application).delete(`/api/v1/fests/${extraFests[index].id}/purge`),
        admin.authenticationToken
      );
      expect(response.status).toBe(200);
    }

    const sixth = await withToken(
      request(application).delete(`/api/v1/fests/${extraFests[4].id}/purge`),
      admin.authenticationToken
    );
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("PURGE_RATE_LIMITED");
    // The sixth fest survives the refusal.
    expect(await FestModel.countDocuments({ _id: extraFests[4]._id })).toBe(1);
  });
});

describe("GET /health/environment", () => {
  it("reports the environment so a client can feature-detect without guessing at hostnames", async () => {
    const response = await request(application).get("/api/v1/health/environment");
    expect(response.status).toBe(200);
    expect(typeof response.body.data.environment).toBe("string");
  });
});
