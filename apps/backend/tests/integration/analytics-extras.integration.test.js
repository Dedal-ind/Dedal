/*
 * analytics-extras.integration.test.js
 *
 * The six aggregations added to the fest summary: add-ons, contingents,
 * attendance, certificates, revenue by purpose and registration velocity.
 *
 * The bar these have to clear is not "returns a number" — it is "returns the
 * RIGHT number when the data is messy". Every fest has abandoned checkouts,
 * declined contingent seats and duplicate gate scans, and each of those is a
 * way for a total to come out wrong in a direction nobody notices until an
 * organiser reconciles it against their bank statement.
 *
 * The empty-data case is tested as carefully as the populated one, because a
 * fest with no add-ons and no certificates is the normal state for most of the
 * year and an analytics panel must never be the thing that fails a dashboard.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { AddOnOrderModel } from "../../src/models/add-on-order-model.js";
import { ContingentModel } from "../../src/models/contingent-model.js";
import { ContingentClaimModel } from "../../src/models/contingent-claim-model.js";
import { CertificateModel } from "../../src/models/certificate-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
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
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();

const {
  getAddOnAnalytics,
  getContingentAnalytics,
  getAttendanceAnalytics,
  getCertificateAnalytics,
  getRevenueByPurpose,
  getEngagementVelocity,
} = await import("../../src/services/analytics-extras-service.js");

let college;
let fest;
let event;
let participant;

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  const administrator = await createTestAdministrator(college);
  fest = await createTestFest(college, administrator.user);
  event = await createTestEvent(fest, administrator.user);
  participant = (await createTestParticipant(college)).user;
});

function buildAddOnOrder(status, amountPaise, offerKey) {
  return {
    registrationId: new mongoose.Types.ObjectId(),
    userId: participant._id,
    festId: fest._id,
    eventId: event._id,
    paymentGroupId: `group-${status}-${offerKey}`,
    offerSelections: [
      { offerId: new mongoose.Types.ObjectId(), offerKey, scope: "fest", numberOfPeople: 1, numberOfDays: 1 },
    ],
    amountPaise,
    status,
  };
}

describe("add-on analytics", () => {
  it("counts only completed orders as revenue, with mixed order statuses present", async () => {
    await AddOnOrderModel.create([
      buildAddOnOrder("completed", 15000, "shuttle"),
      buildAddOnOrder("completed", 45000, "merch-tee"),
      /* Neither of these is money the fest has taken. */
      buildAddOnOrder("pending", 99900, "shuttle"),
      buildAddOnOrder("cancelled", 88800, "locker"),
    ]);

    const result = await getAddOnAnalytics(fest._id, [event._id], 4);

    expect(result.totalOrders).toBe(2);
    expect(result.revenuePaise).toBe(60000);
    /* A pending checkout is reported, separately, so it is visible without
       being counted as earnings. */
    expect(result.pendingOrders).toBe(1);
    expect(result.pendingRevenuePaise).toBe(99900);
    /* The cancelled order appears in neither bucket. */
    expect(result.revenuePaise).not.toContain(88800);
  });

  it("ranks the most popular offer by order count, ignoring uncompleted orders", async () => {
    await AddOnOrderModel.create([
      buildAddOnOrder("completed", 15000, "shuttle"),
      buildAddOnOrder("completed", 15000, "shuttle"),
      buildAddOnOrder("completed", 45000, "merch-tee"),
      buildAddOnOrder("pending", 15000, "locker"),
    ]);

    const result = await getAddOnAnalytics(fest._id, [event._id], 3);

    expect(result.mostPopularOffer.offerKey).toBe("shuttle");
    expect(result.mostPopularOffer.orderCount).toBe(2);
    /* The pending "locker" never reaches the breakdown at all. */
    expect(result.byOffer.map((row) => row.offerKey)).not.toContain("locker");
  });

  it("computes attach rate as completed orders over confirmed registrations", async () => {
    await AddOnOrderModel.create([
      buildAddOnOrder("completed", 15000, "shuttle"),
      buildAddOnOrder("completed", 15000, "merch-tee"),
    ]);

    const result = await getAddOnAnalytics(fest._id, [event._id], 8);

    expect(result.attachRate).toMatchObject({ numerator: 2, denominator: 8 });
    expect(result.attachRate.rate).toBeCloseTo(0.25);
  });

  it("returns zeroes rather than throwing when no add-ons exist", async () => {
    const result = await getAddOnAnalytics(fest._id, [event._id], 0);

    expect(result).toMatchObject({ totalOrders: 0, revenuePaise: 0, byOffer: [] });
    expect(result.mostPopularOffer).toBeNull();
    /* Nothing over nothing is zero, not NaN or a divide-by-zero throw. */
    expect(result.attachRate.rate).toBe(0);
  });
});

describe("contingent analytics", () => {
  async function seedContingent(overrides = {}) {
    return ContingentModel.create({
      festId: fest._id,
      contingentName: "Full Access",
      includedEventIds: [event._id, new mongoose.Types.ObjectId()],
      pricePaise: 900000,
      individualTotalPaise: 1200000,
      status: "published",
      maximumBundleClaims: 10,
      soldBundleCount: 3,
      createdByUserId: participant._id,
      ...overrides,
    });
  }

  it("counts bundles as purchases and claims as seats, which are different units", async () => {
    const contingent = await seedContingent();
    /* Five seats across three bundles — the two must not be conflated. */
    await ContingentClaimModel.create(
      ["invited", "accepted", "accepted", "declined", "cancelled"].map((claimStatus, index) => ({
        contingentId: contingent._id,
        festId: fest._id,
        eventId: event._id,
        contingentPurchaseGroupId: `purchase-${index}`,
        buyerUserId: participant._id,
        attendeeEmailAddress: `attendee${index}@example.com`,
        attendeeFullName: `Attendee ${index}`,
        attendeePhoneNumber: "9000000000",
        claimStatus,
      }))
    );

    const result = await getContingentAnalytics(fest._id);

    expect(result.totalPurchases).toBe(3);
    expect(result.revenuePaise).toBe(3 * 900000);
    /* invited + accepted occupy a seat; declined and cancelled gave theirs back. */
    expect(result.byPackage[0].seatsClaimed).toBe(3);
  });

  it("counts slots filled against capacity", async () => {
    await seedContingent({ soldBundleCount: 4, maximumBundleClaims: 10 });

    const result = await getContingentAnalytics(fest._id);

    expect(result.slotsSold).toBe(4);
    expect(result.slotsTotal).toBe(10);
    expect(result.slotFill.rate).toBeCloseTo(0.4);
  });

  it("does not divide by an imaginary ceiling for an uncapped package", async () => {
    await seedContingent({ maximumBundleClaims: null, soldBundleCount: 6 });

    const result = await getContingentAnalytics(fest._id);

    /* Capacity null means "limited by the sub-events", so the sales are the
       denominator; the alternative renders as "6 of 0". */
    expect(result.slotsTotal).toBe(6);
    expect(result.slotFill.rate).toBe(1);
  });

  it("returns zeroes rather than throwing when no contingents exist", async () => {
    const result = await getContingentAnalytics(fest._id);

    expect(result).toMatchObject({
      totalPurchases: 0,
      revenuePaise: 0,
      slotsSold: 0,
      byPackage: [],
    });
    expect(result.slotFill.rate).toBe(0);
  });
});

describe("attendance analytics", () => {
  it("returns a zeroed check-in rate rather than throwing with no checkpoints", async () => {
    const result = await getAttendanceAnalytics(fest._id, [event._id], 10);

    expect(result.checkInRate).toMatchObject({ numerator: 0, denominator: 10 });
    expect(result.checkInRate.rate).toBe(0);
    expect(result.peakHour).toBeNull();
    expect(result.perEvent).toEqual([]);
    expect(result.perGate).toEqual([]);
  });

  it("keeps the registered count as the denominator so the rate is scan over registered", async () => {
    const result = await getAttendanceAnalytics(fest._id, [event._id], 42);

    /* The denominator is the confirmed-registration count handed in, which is
       what makes this a RATE rather than a raw scan tally. */
    expect(result.checkInRate.denominator).toBe(42);
  });
});

describe("certificate analytics", () => {
  /*
   * A DISTINCT RECIPIENT PER CERTIFICATE. certificates carry a unique index on
   * (userId, festId, eventId) — the same constraint insertCertificate leans on
   * to skip duplicates — so one person can hold exactly one certificate for one
   * event. Four certificates means four people.
   */
  async function issue(certificateType, code) {
    return CertificateModel.create({
      userId: new mongoose.Types.ObjectId(),
      festId: fest._id,
      eventId: event._id,
      certificateType,
      verificationCode: code,
      status: "released",
      metadata: { fullName: "Test Participant" },
    });
  }

  it("breaks the issued count down across the eight-value type enum", async () => {
    await issue("participation", "AAA111");
    await issue("participation", "AAA222");
    await issue("winner1st", "BBB111");
    await issue("coordinator", "CCC111");

    const result = await getCertificateAnalytics(fest._id, [event._id]);

    expect(result.totalIssued).toBe(4);
    const byType = Object.fromEntries(
      result.byType.map((row) => [row.certificateType, row.count])
    );
    expect(byType.participation).toBe(2);
    expect(byType.winner1st).toBe(1);
    expect(byType.coordinator).toBe(1);
    /*
     * Every type is present even at zero. A breakdown that omitted the empty
     * ones would make a chart's bars move between refreshes, and "no volunteer
     * certificates yet" is itself an answer.
     */
    expect(result.byType).toHaveLength(8);
    expect(byType.winner2nd).toBe(0);
    expect(byType.specialMention).toBe(0);
  });

  it("returns every type at zero rather than throwing when none are issued", async () => {
    const result = await getCertificateAnalytics(fest._id, [event._id]);

    expect(result.totalIssued).toBe(0);
    expect(result.byType).toHaveLength(8);
    expect(result.byType.every((row) => row.count === 0)).toBe(true);
  });
});

describe("revenue by purpose", () => {
  it("returns zeroes and declares that a payment-method breakdown is unavailable", async () => {
    const result = await getRevenueByPurpose(fest._id);

    expect(result.capturedTotalPaise).toBe(0);
    expect(result.byPurpose).toEqual([]);
    /*
     * PaymentOrderModel never stores the Razorpay method, so a by-method
     * breakdown cannot be computed from this database. The flag is in the
     * payload so a dashboard can omit the panel rather than render an empty one
     * that looks like a failed load.
     */
    expect(result.paymentMethodBreakdownAvailable).toBe(false);
  });
});

describe("engagement velocity", () => {
  it("reports acceleration when this week beats last week", async () => {
    const now = new Date();
    const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    await RegistrationModel.collection.insertMany([
      { eventId: event._id, userId: new mongoose.Types.ObjectId(), status: "confirmed", createdAt: daysAgo(1), updatedAt: daysAgo(1) },
      { eventId: event._id, userId: new mongoose.Types.ObjectId(), status: "confirmed", createdAt: daysAgo(2), updatedAt: daysAgo(2) },
      { eventId: event._id, userId: new mongoose.Types.ObjectId(), status: "confirmed", createdAt: daysAgo(3), updatedAt: daysAgo(3) },
      { eventId: event._id, userId: new mongoose.Types.ObjectId(), status: "confirmed", createdAt: daysAgo(10), updatedAt: daysAgo(10) },
    ]);

    const result = await getEngagementVelocity(fest._id, [event._id], fest, now);

    expect(result.registrationsThisWindow).toBe(3);
    expect(result.registrationsPreviousWindow).toBe(1);
    expect(result.trend).toBe("accelerating");
  });

  it("returns a steady trend and zeroes rather than throwing with no registrations", async () => {
    const result = await getEngagementVelocity(fest._id, [event._id], fest);

    expect(result).toMatchObject({
      registrationsThisWindow: 0,
      registrationsPreviousWindow: 0,
      trend: "steady",
    });
    /* Zero over zero must not become NaN or an infinite percentage. */
    expect(result.perDayThisWindow).toBe(0);
    expect(typeof result.daysUntilFest).toBe("number");
  });
});
