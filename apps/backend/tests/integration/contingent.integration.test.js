import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { PaymentOrderModel } from "../../src/models/payment-order-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { ScanModel } from "../../src/models/scan-model.js";
import { ContingentModel } from "../../src/models/contingent-model.js";
import { ContingentClaimModel } from "../../src/models/contingent-claim-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import {
  installEmailServiceMock,
  findRecordedEmailsOfKind,
  clearRecordedEmails,
} from "../setup/test-email-service.js";
import { installRazorpayClientMock, getRecordedOrders, clearRecordedOrders } from "../setup/test-razorpay-service.js";
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
  createTestEventCheckpoint,
  createTestPass,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

const PLATFORM_FEE_PAISE = 2000; // tests/setup/test-environment.js

function signPayment(razorpayOrderId, razorpayPaymentId) {
  return crypto
    .createHmac("sha256", "rzp_test_secret")
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
}

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

let college;
let admin;
let fest;
let buyer;
let parentEvent;
let subEventA; // fee 10000
let subEventB; // fee 20000
let participantCounter = 0;

async function nextParticipant(overrides = {}) {
  participantCounter += 1;
  return createTestParticipant(college, {
    emailAddress: `contingent${participantCounter}@example.com`,
    usn: `1CT00AA${participantCounter.toString().padStart(3, "0")}`,
    ...overrides,
  });
}

async function createSubEvent(slug, feeAmountPaise, overrides = {}) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: slug,
      eventName: slug.toUpperCase(),
      parentEventId: parentEvent._id,
      eventType: "solo",
      feeType: feeAmountPaise > 0 ? "perPerson" : "free",
      feeAmountPaise,
      ...overrides,
    })
  );
}

async function createPublishedContingent(overrides = {}) {
  const createResponse = await withToken(
    request(application).post(`/api/v1/fests/${fest.id}/contingents`),
    admin.authenticationToken
  ).send({
    parentEventId: String(parentEvent._id),
    contingentName: "Management Contingent",
    includedEventIds: [String(subEventA._id), String(subEventB._id)],
    pricePaise: 25000, // vs 30000 individually — a Rs 50 discount
    ...overrides,
  });
  expect(createResponse.status).toBe(201);
  const contingentId = createResponse.body.data.contingent.id;
  const publishResponse = await withToken(
    request(application).post(`/api/v1/fests/${fest.id}/contingents/${contingentId}/publish`),
    admin.authenticationToken
  );
  expect(publishResponse.status).toBe(200);
  return contingentId;
}

async function purchase(contingentId, attendees, token = buyer.authenticationToken) {
  return withToken(
    request(application).post(`/api/v1/fests/${fest.id}/contingents/${contingentId}/purchase`),
    token
  ).send({ attendees });
}

async function payForPurchase(razorpayOrderId, token = buyer.authenticationToken) {
  const paymentId = `pay_${razorpayOrderId}`;
  const verifyResponse = await withToken(request(application).post("/api/v1/payments/verify"), token).send({
    razorpayOrderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signPayment(razorpayOrderId, paymentId),
  });
  expect(verifyResponse.status).toBe(200);
}

function attendeeRow(eventId, fullName, emailAddress) {
  return {
    eventId: String(eventId),
    fullName,
    emailAddress,
    phoneNumber: "+919999999999",
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await RegistrationModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  clearRecordedOrders();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  buyer = await nextParticipant({ emailAddress: "buyer@example.com" });
  // The "management event" container: free, published, no category.
  parentEvent = await createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: "chidaranga",
      eventName: "Chidaranga",
      category: null,
      feeType: "free",
      feeAmountPaise: 0,
    })
  );
  subEventA = await createSubEvent("finance", 10000, { capacity: 10 });
  subEventB = await createSubEvent("marketing", 20000, { capacity: 10 });
});

afterAll(teardownTestDatabase);

describe("contingent creation constraints", () => {
  it("rejects a paid parent, a team sub-event, and an unpublished sub-event", async () => {
    const paidParent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "paid-parent", category: null, feeType: "perPerson", feeAmountPaise: 5000 })
    );
    const paidParentResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(paidParent._id),
      contingentName: "Bad Parent",
      includedEventIds: [String(subEventA._id), String(subEventB._id)],
      pricePaise: 1000,
    });
    expect(paidParentResponse.status).toBe(409);
    expect(paidParentResponse.body.error.code).toBe("CONTINGENT_PARENT_HAS_FEE");

    const teamChild = await createSubEvent("team-child", 5000, {
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
    });
    const teamResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(parentEvent._id),
      contingentName: "Team Bundle",
      includedEventIds: [String(subEventA._id), String(teamChild._id)],
      pricePaise: 1000,
    });
    expect(teamResponse.status).toBe(400);
    expect(teamResponse.body.error.details.includedEventIds[String(teamChild._id)]).toMatch(/team event/);

    const draftChild = await createSubEvent("draft-child", 5000, { status: "draft" });
    const draftResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(parentEvent._id),
      contingentName: "Draft Bundle",
      includedEventIds: [String(subEventA._id), String(draftChild._id)],
      pricePaise: 1000,
    });
    expect(draftResponse.status).toBe(400);
  });

  it("recomputes individualTotalPaise server-side and refuses an unintentional negative discount", async () => {
    const createResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(parentEvent._id),
      contingentName: "Overpriced",
      includedEventIds: [String(subEventA._id), String(subEventB._id)],
      pricePaise: 99000, // above the 30000 individual total
    });
    expect(createResponse.status).toBe(400);

    const allowedResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(parentEvent._id),
      contingentName: "Overpriced On Purpose",
      includedEventIds: [String(subEventA._id), String(subEventB._id)],
      pricePaise: 99000,
      allowNegativeDiscount: true,
    });
    expect(allowedResponse.status).toBe(201);
    expect(allowedResponse.body.data.contingent.individualTotalPaise).toBe(30000);
  });

  it("no two published contingents under the same parent may share a sub-event", async () => {
    await createPublishedContingent();
    const overlapResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(parentEvent._id),
      contingentName: "Championship Contingent",
      includedEventIds: [String(subEventA._id), String(subEventB._id)],
      pricePaise: 20000,
    });
    expect(overlapResponse.status).toBe(409);
    expect(overlapResponse.body.error.code).toBe("CONTINGENT_EVENT_CONFLICT");
    expect(overlapResponse.body.error.details.conflictingContingentName).toBe("Management Contingent");
  });

  it("stays editable while unpurchased; price/events freeze after a purchase; name stays editable; individualTotal stays snapshotted", async () => {
    const contingentId = await createPublishedContingent();

    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Attendee One", "unknown-one@example.com"),
      attendeeRow(subEventB._id, "Attendee Two", "unknown-two@example.com"),
    ]);
    expect(purchaseResponse.status).toBe(201);

    const structuralEdit = await withToken(
      request(application).patch(`/api/v1/fests/${fest.id}/contingents/${contingentId}`),
      admin.authenticationToken
    ).send({ pricePaise: 26000 });
    expect(structuralEdit.status).toBe(409);
    expect(structuralEdit.body.error.code).toBe("CONTINGENT_IMMUTABLE_AFTER_PURCHASE");

    const nameEdit = await withToken(
      request(application).patch(`/api/v1/fests/${fest.id}/contingents/${contingentId}`),
      admin.authenticationToken
    ).send({ contingentName: "Management Contingent 2027" });
    expect(nameEdit.status).toBe(200);

    // Deliberately snapshotted: a later sub-event fee edit never rewrites it.
    await EventModel.updateOne({ _id: subEventA._id }, { $set: { feeAmountPaise: 99900 } });
    const reloaded = await ContingentModel.findById(contingentId);
    expect(reloaded.individualTotalPaise).toBe(30000);
  });
});

describe("purchase, payment and the attendee claim flow", () => {
  it("full happy path: self + two unknown emails, pay, invites, accepts, roster and CSV", async () => {
    const subEventC = await createSubEvent("dance", 0, { capacity: 10 });
    const createResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(parentEvent._id),
      contingentName: "Full Contingent",
      includedEventIds: [String(subEventA._id), String(subEventB._id), String(subEventC._id)],
      pricePaise: 25000,
    });
    const contingentId = createResponse.body.data.contingent.id;
    await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents/${contingentId}/publish`),
      admin.authenticationToken
    );

    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Buyer Self", "buyer@example.com"),
      attendeeRow(subEventB._id, "New Person", "new-attendee@example.com"),
      attendeeRow(subEventC._id, "Known Person", "known-attendee@example.com"),
    ]);
    expect(purchaseResponse.status).toBe(201);
    const { contingentPurchaseGroupId, razorpayOrderId, amountPaise } = purchaseResponse.body.data;
    // Fee math: the bundle price, NOT event fees x N — plus the platform fee.
    expect(amountPaise).toBe(25000 + PLATFORM_FEE_PAISE);
    const recordedOrder = getRecordedOrders().find((order) => order.razorpayOrderId === razorpayOrderId);
    expect(recordedOrder.amountPaise).toBe(25000 + PLATFORM_FEE_PAISE);
    const order = await PaymentOrderModel.findOne({ paymentGroupId: contingentPurchaseGroupId }).lean();
    expect(order.purposeType).toBe("contingent");
    expect(order.registrationFeePaise).toBe(25000);

    // Unknown attendee users were created through the shared onboarding path.
    const newUser = await UserModel.findOne({ emailAddress: "new-attendee@example.com" });
    expect(newUser).not.toBeNull();
    expect(newUser.isProfileComplete).toBe(false);

    // Seats were claimed at purchase (all-or-nothing succeeded).
    expect((await EventModel.findById(subEventA._id)).registeredCount).toBe(1);
    expect((await EventModel.findById(subEventB._id)).registeredCount).toBe(1);

    // No invites before payment.
    expect(findRecordedEmailsOfKind("generic")).toHaveLength(0);

    await payForPurchase(razorpayOrderId);

    // Buyer's own slot auto-accepted with a materialised registration.
    const buyerClaim = await ContingentClaimModel.findOne({ attendeeUserId: buyer.user._id });
    expect(buyerClaim.claimStatus).toBe("accepted");
    const buyerRegistration = await RegistrationModel.findById(buyerClaim.registrationId);
    expect(buyerRegistration.status).toBe("confirmed");
    expect(String(buyerRegistration.contingentClaimId)).toBe(String(buyerClaim._id));
    expect(buyerRegistration.totalFeePaise).toBe(0); // the buyer paid the bundle, not the row

    // ONE invite email per attendee address, none for the buyer's own slot.
    const invites = findRecordedEmailsOfKind("generic");
    expect(invites.map((email) => email.emailAddress).sort()).toEqual([
      "known-attendee@example.com",
      "new-attendee@example.com",
    ]);

    // Coordinator roster BEFORE acceptance: pending invites named per seat.
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [subEventB._id] },
    });
    const pendingRoster = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/events/${subEventB.id}/participants`),
      coordinator.authenticationToken
    );
    expect(pendingRoster.status).toBe(200);
    expect(pendingRoster.body.data.pendingInvites).toHaveLength(1);
    expect(pendingRoster.body.data.pendingInvites[0]).toMatchObject({
      registrationType: "contingent",
      attendeeEmailAddress: "new-attendee@example.com",
      contingentName: "Full Contingent",
    });
    // Coverage scoping: the coordinator of B sees no claims from other sub-events.
    expect(
      pendingRoster.body.data.pendingInvites.every(
        (invite) => invite.attendeeEmailAddress !== "known-attendee@example.com"
      )
    ).toBe(true);

    // The new attendee signs in and completes their profile (consent captured
    // there per the legal work), then accepts.
    await UserModel.updateOne(
      { _id: newUser._id },
      {
        $set: {
          fullName: "New Person",
          collegeId: college._id,
          usn: "1NP00AA001",
          isProfileComplete: true,
        },
      }
    );
    const newAttendeeToken = createAuthenticationToken({ id: String(newUser._id), emailAddress: newUser.emailAddress });
    const myClaims = await withToken(request(application).get("/api/v1/contingent-claims/mine"), newAttendeeToken);
    expect(myClaims.status).toBe(200);
    expect(myClaims.body.data.claims).toHaveLength(1);
    const claimId = myClaims.body.data.claims[0].id;

    const acceptResponse = await withToken(
      request(application).post(`/api/v1/contingent-claims/${claimId}/accept`),
      newAttendeeToken
    );
    expect(acceptResponse.status).toBe(200);
    const acceptedRegistrationId = acceptResponse.body.data.registration.id;
    expect(acceptResponse.body.data.registration.status).toBe("confirmed");

    // Pass + event-entry entitlement minted, seat not double-claimed.
    const pass = await PassModel.findOne({ userId: newUser._id, festId: fest._id });
    expect(pass).not.toBeNull();
    const entitlement = await EntitlementModel.findOne({ passId: pass._id, entitlementType: "eventEntry" });
    expect(String(entitlement.referenceId)).toBe(String(subEventB._id));
    expect((await EventModel.findById(subEventB._id)).registeredCount).toBe(1);

    // Audit trail: contingentClaim.accepted with the accountability fields.
    const acceptAudit = await AuditLogModel.findOne({ action: "contingentClaim.accepted", entityId: claimId });
    expect(acceptAudit.afterState).toMatchObject({
      buyerUserId: String(buyer.user._id),
      registrationId: acceptedRegistrationId,
    });

    // Roster AFTER acceptance: a contingent slice row, labelled and attributed.
    const confirmedRoster = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/events/${subEventB.id}/participants`),
      coordinator.authenticationToken
    );
    expect(confirmedRoster.body.data.contingent).toHaveLength(1);
    expect(confirmedRoster.body.data.contingent[0]).toMatchObject({
      registrationType: "contingent",
      contingentName: "Full Contingent",
      claimStatus: "accepted",
    });
    expect(confirmedRoster.body.data.pendingInvites).toHaveLength(0);

    // CSV export carries the registration-type column and still streams.
    const exportResponse = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/exports/registrations.csv`),
      admin.authenticationToken
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers["content-type"]).toContain("text/csv");
    const [headerLine, ...dataLines] = exportResponse.text.trim().split("\n");
    expect(headerLine).toContain("registrationType");
    expect(dataLines.some((line) => line.includes("contingent"))).toBe(true);
  });

  it("all-or-nothing: one full sub-event fails the whole purchase with no partial seats", async () => {
    const fullEvent = await createSubEvent("boxing", 5000, { capacity: 1 });
    const filler = await nextParticipant();
    const fillResponse = await withToken(
      request(application).post(`/api/v1/events/${fullEvent.id}/registrations/solo`),
      filler.authenticationToken
    ).send({});
    expect(fillResponse.status).toBe(201);

    const createResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(parentEvent._id),
      contingentName: "Doomed Bundle",
      includedEventIds: [String(subEventA._id), String(fullEvent._id)],
      pricePaise: 10000,
    });
    const contingentId = createResponse.body.data.contingent.id;
    await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents/${contingentId}/publish`),
      admin.authenticationToken
    );

    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Person A", "a@example.com"),
      attendeeRow(fullEvent._id, "Person B", "b@example.com"),
    ]);
    expect(purchaseResponse.status).toBe(409);
    expect(purchaseResponse.body.error.code).toBe("CONTINGENT_SEAT_UNAVAILABLE");
    expect(purchaseResponse.body.error.details.eventName).toBe("BOXING");

    // The seat taken in subEventA during the attempt was compensated back.
    expect((await EventModel.findById(subEventA._id)).registeredCount).toBe(0);
    expect((await EventModel.findById(fullEvent._id)).registeredCount).toBe(1); // only the filler
    expect(await ContingentClaimModel.countDocuments({})).toBe(0);
  });

  it("an attendee with an individual registration blocks the purchase up front", async () => {
    const attendee = await nextParticipant({ emailAddress: "already@example.com" });
    await withToken(
      request(application).post(`/api/v1/events/${subEventB.id}/registrations/solo`),
      attendee.authenticationToken
    ).send({});
    // The fixture event is paid, so the hold is pendingPayment — still a blocker.

    const contingentId = await createPublishedContingent();
    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Fine Person", "fine@example.com"),
      attendeeRow(subEventB._id, "Already Registered", "already@example.com"),
    ]);
    expect(purchaseResponse.status).toBe(409);
    expect(purchaseResponse.body.error.code).toBe("INDIVIDUAL_REGISTRATION_EXISTS");
    expect(purchaseResponse.body.error.details.eventName).toBe("MARKETING");
  });

  it("declining releases the seat, refunds nothing, and writes the audit row", async () => {
    const contingentId = await createPublishedContingent();
    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Decliner", "decliner@example.com"),
      attendeeRow(subEventB._id, "Stayer", "stayer@example.com"),
    ]);
    const { contingentPurchaseGroupId, razorpayOrderId } = purchaseResponse.body.data;
    await payForPurchase(razorpayOrderId);

    const declinerUser = await UserModel.findOne({ emailAddress: "decliner@example.com" });
    const declinerToken = createAuthenticationToken({
      id: String(declinerUser._id),
      emailAddress: declinerUser.emailAddress,
    });
    const claim = await ContingentClaimModel.findOne({ attendeeUserId: declinerUser._id });

    const declineResponse = await withToken(
      request(application).post(`/api/v1/contingent-claims/${claim.id}/decline`),
      declinerToken
    );
    expect(declineResponse.status).toBe(200);
    expect(declineResponse.body.data.claim.claimStatus).toBe("declined");
    expect((await EventModel.findById(subEventA._id)).registeredCount).toBe(0);
    // No refund on decline — the order stays captured, never refund-pending.
    const order = await PaymentOrderModel.findOne({ paymentGroupId: contingentPurchaseGroupId }).lean();
    expect(order.status).toBe("captured");
    expect(await AuditLogModel.countDocuments({ action: "contingentClaim.declined" })).toBe(1);
  });

  it("payment captured after the 30-minute hold lapsed refunds, never resurrects seats", async () => {
    const contingentId = await createPublishedContingent();
    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Late One", "late-one@example.com"),
      attendeeRow(subEventB._id, "Late Two", "late-two@example.com"),
    ]);
    const { contingentPurchaseGroupId, razorpayOrderId } = purchaseResponse.body.data;

    // The lazy sweep's outcome, hand-applied: the hold lapsed, seats released.
    await ContingentClaimModel.updateMany(
      { contingentPurchaseGroupId },
      { $set: { claimStatus: "cancelled", paymentStatus: "expired" } }
    );

    const paymentId = `pay_${razorpayOrderId}`;
    const verifyResponse = await withToken(
      request(application).post("/api/v1/payments/verify"),
      buyer.authenticationToken
    ).send({
      razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signPayment(razorpayOrderId, paymentId),
    });
    expect(verifyResponse.status).toBe(409);
    expect(verifyResponse.body.error.code).toBe("PAYMENT_CAPTURED_AFTER_EXPIRY");
    expect(await AuditLogModel.countDocuments({ action: "payment.capturedAfterExpiry" })).toBe(1);
    // No claim came back to life.
    expect(await ContingentClaimModel.countDocuments({ claimStatus: "invited" })).toBe(0);
  });
});

describe("cancellation", () => {
  it("buyer cancels before any acceptance: claims cancelled, seats released, refund-pending marker", async () => {
    const contingentId = await createPublishedContingent();
    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Cancel A", "cancel-a@example.com"),
      attendeeRow(subEventB._id, "Cancel B", "cancel-b@example.com"),
    ]);
    const { contingentPurchaseGroupId, razorpayOrderId } = purchaseResponse.body.data;
    await payForPurchase(razorpayOrderId);

    const cancelResponse = await withToken(
      request(application).post(`/api/v1/contingent-purchases/${contingentPurchaseGroupId}/cancel`),
      buyer.authenticationToken
    );
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.data.cancelledClaimCount).toBe(2);

    expect(await ContingentClaimModel.countDocuments({ claimStatus: "cancelled" })).toBe(2);
    expect((await EventModel.findById(subEventA._id)).registeredCount).toBe(0);
    expect((await EventModel.findById(subEventB._id)).registeredCount).toBe(0);
    const order = await PaymentOrderModel.findOne({ paymentGroupId: contingentPurchaseGroupId }).lean();
    expect(order.status).toBe("refundPending");
    expect(await AuditLogModel.countDocuments({ action: "payment.refundPending" })).toBe(1);
    // The bundle slot came back too.
    expect((await ContingentModel.findById(contingentId)).soldBundleCount).toBe(0);
  });

  it("buyer cancel is blocked once an attendee has an accepted scan", async () => {
    const contingentId = await createPublishedContingent();
    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Scanned One", "scanned@example.com"),
      attendeeRow(subEventB._id, "Unscanned", "unscanned@example.com"),
    ]);
    const { contingentPurchaseGroupId, razorpayOrderId } = purchaseResponse.body.data;
    await payForPurchase(razorpayOrderId);

    const scannedUser = await UserModel.findOne({ emailAddress: "scanned@example.com" });
    await UserModel.updateOne(
      { _id: scannedUser._id },
      { $set: { fullName: "Scanned One", collegeId: college._id, usn: "1SC00AA001", isProfileComplete: true } }
    );
    const scannedToken = createAuthenticationToken({
      id: String(scannedUser._id),
      emailAddress: scannedUser.emailAddress,
    });
    const claim = await ContingentClaimModel.findOne({ attendeeUserId: scannedUser._id });
    await withToken(request(application).post(`/api/v1/contingent-claims/${claim.id}/accept`), scannedToken);

    // An accepted scan at the sub-event's checkpoint.
    const checkpoint = await createTestEventCheckpoint(fest, subEventA._id);
    const pass = await PassModel.findOne({ userId: scannedUser._id, festId: fest._id });
    await ScanModel.create({
      clientScanId: "contingent-scan-1",
      passId: pass._id,
      checkpointId: checkpoint._id,
      scannedByUserId: admin.user._id,
      scanMethod: "qr",
      direction: "in",
      result: "accepted",
      scannedAt: new Date(),
    });

    const cancelResponse = await withToken(
      request(application).post(`/api/v1/contingent-purchases/${contingentPurchaseGroupId}/cancel`),
      buyer.authenticationToken
    );
    expect(cancelResponse.status).toBe(409);
    expect(cancelResponse.body.error.code).toBe("CONTINGENT_CANCEL_BLOCKED_BY_SCANS");
  });

  it("cancelling a sub-event inside a live contingent is blocked and names the contingent", async () => {
    await createPublishedContingent();
    const cancelResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${subEventA.id}/cancel`),
      admin.authenticationToken
    );
    expect(cancelResponse.status).toBe(409);
    expect(cancelResponse.body.error.code).toBe("CONTINGENT_LOCKS_EVENT");
    expect(cancelResponse.body.error.details.contingentName).toBe("Management Contingent");
  });

  it("admin cancelling the contingent unwinds every purchase and emails the buyers", async () => {
    const contingentId = await createPublishedContingent();
    const purchaseResponse = await purchase(contingentId, [
      attendeeRow(subEventA._id, "Unwound A", "unwound-a@example.com"),
      attendeeRow(subEventB._id, "Unwound B", "unwound-b@example.com"),
    ]);
    const { contingentPurchaseGroupId, razorpayOrderId } = purchaseResponse.body.data;
    await payForPurchase(razorpayOrderId);
    clearRecordedEmails();

    const cancelResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents/${contingentId}/cancel`),
      admin.authenticationToken
    );
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.data.contingent.status).toBe("cancelled");
    expect(await ContingentClaimModel.countDocuments({ claimStatus: "cancelled" })).toBe(2);
    const order = await PaymentOrderModel.findOne({ paymentGroupId: contingentPurchaseGroupId }).lean();
    expect(order.status).toBe("refundPending");
    const buyerEmails = findRecordedEmailsOfKind("generic").filter(
      (email) => email.emailAddress === "buyer@example.com"
    );
    expect(buyerEmails).toHaveLength(1);
  });
});

describe("expiry sweep", () => {
  it("an unaccepted claim past fest start + 24h flips to EXPIRED and releases its seat", async () => {
    // A fest that already started well over 24h ago.
    const pastFest = await createTestFest(college, admin.user, {
      festName: "Past Fest",
      festSlug: "past-fest",
      status: "published",
      startsOn: new Date("2020-01-01T00:00:00.000Z"),
      endsOn: new Date("2020-01-05T00:00:00.000Z"),
    });
    const pastParent = await createTestEvent(
      pastFest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "past-parent", category: null, feeType: "free", feeAmountPaise: 0 })
    );
    const pastChildA = await createTestEvent(
      pastFest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "past-a",
        parentEventId: pastParent._id,
        feeType: "perPerson",
        feeAmountPaise: 5000,
        capacity: 5,
      })
    );
    const pastChildB = await createTestEvent(
      pastFest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "past-b",
        parentEventId: pastParent._id,
        feeType: "perPerson",
        feeAmountPaise: 5000,
        capacity: 5,
      })
    );
    const createResponse = await withToken(
      request(application).post(`/api/v1/fests/${pastFest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(pastParent._id),
      contingentName: "Stale Bundle",
      includedEventIds: [String(pastChildA._id), String(pastChildB._id)],
      pricePaise: 9000,
    });
    const contingentId = createResponse.body.data.contingent.id;
    await withToken(
      request(application).post(`/api/v1/fests/${pastFest.id}/contingents/${contingentId}/publish`),
      admin.authenticationToken
    );
    const purchaseResponse = await withToken(
      request(application).post(`/api/v1/fests/${pastFest.id}/contingents/${contingentId}/purchase`),
      buyer.authenticationToken
    ).send({
      attendees: [
        attendeeRow(pastChildA._id, "Never Shows", "never-shows@example.com"),
        attendeeRow(pastChildB._id, "Also Never", "also-never@example.com"),
      ],
    });
    expect(purchaseResponse.status).toBe(201);
    await payForPurchase(purchaseResponse.body.data.razorpayOrderId);
    expect((await EventModel.findById(pastChildA._id)).registeredCount).toBe(1);

    // The lazy sweep runs from the attendee's own claim read.
    const staleUser = await UserModel.findOne({ emailAddress: "never-shows@example.com" });
    const staleToken = createAuthenticationToken({
      id: String(staleUser._id),
      emailAddress: staleUser.emailAddress,
    });
    const listResponse = await withToken(request(application).get("/api/v1/contingent-claims/mine"), staleToken);
    expect(listResponse.status).toBe(200);

    const claim = await ContingentClaimModel.findOne({ attendeeUserId: staleUser._id });
    expect(claim.claimStatus).toBe("expired");
    expect((await EventModel.findById(pastChildA._id)).registeredCount).toBe(0);
  });
});
