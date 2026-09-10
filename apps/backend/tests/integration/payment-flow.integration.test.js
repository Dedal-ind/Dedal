import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { PaymentOrderModel } from "../../src/models/payment-order-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
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
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

// The signature Razorpay's Checkout callback would send, computed with the test secret.
function signPayment(razorpayOrderId, razorpayPaymentId) {
  return crypto
    .createHmac("sha256", "rzp_test_secret")
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
}

// The signature Razorpay's webhook would send over the raw body bytes.
function signWebhookBody(rawBody) {
  return crypto.createHmac("sha256", "rzp_test_webhook_secret").update(rawBody).digest("hex");
}

// What the lazy sweep does to a hold that outlived its window.
async function expirePaymentGroup(paymentGroupId) {
  await RegistrationModel.updateMany(
    { paymentGroupId },
    { $set: { status: "paymentExpired", paymentStatus: "expired" } }
  );
}

let college;
let admin;
let fest;
let participant;

function asParticipant(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${participant.authenticationToken}`);
}

function soloPath(eventId) {
  return `/api/v1/events/${eventId}/registrations/solo`;
}

async function paidEvent(overrides = {}) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventType: "solo",
      capacity: 10,
      feeType: "perPerson",
      feeAmountPaise: 45000,
      ...overrides,
    })
  );
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    PaymentOrderModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { festName: "Alliance Fest", status: "published" });
  participant = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

describe("paid registration opens a Razorpay order", () => {
  it("returns razorpayOrderId + razorpayKeyId and stores a created payment order", async () => {
    const event = await paidEvent({ eventSlug: "paid-1" });

    const response = await asParticipant(request(application).post(soloPath(event.id)));

    expect(response.status).toBe(201);
    const { payment } = response.body.data;
    expect(payment.paymentGroupId).toEqual(expect.any(String));
    expect(payment.razorpayOrderId).toEqual(expect.any(String));
    expect(payment.razorpayKeyId).toBe("rzp_test_key");

    const order = await PaymentOrderModel.findOne({ paymentGroupId: payment.paymentGroupId });
    expect(order.status).toBe("created");
    expect(order.razorpayOrderId).toBe(payment.razorpayOrderId);
  });

  it("create-order returns the pending registration id so a stateless checkout can land on success", async () => {
    const event = await paidEvent({ eventSlug: "paid-resume" });
    const registerResponse = await asParticipant(request(application).post(soloPath(event.id)));
    const { payment } = registerResponse.body.data;
    const registrationId = registerResponse.body.data.registration.id;

    // First call creates the order; the second returns the existing one. A
    // refresh or "resume pending payment" hits exactly these paths with no
    // router state, so both must carry the registration context.
    for (let call = 0; call < 2; call += 1) {
      const orderResponse = await asParticipant(
        request(application)
          .post("/api/v1/payments/create-order")
          .send({ paymentGroupId: payment.paymentGroupId })
      );
      expect(orderResponse.status).toBe(201);
      expect(orderResponse.body.data.registrationId).toBe(registrationId);
      expect(orderResponse.body.data.registrationCreatedAt).toBeTruthy();
    }
  });
});

describe("POST /api/v1/payments/verify", () => {
  it("captures the order and confirms the group on a valid signature", async () => {
    const event = await paidEvent({ eventSlug: "paid-2" });
    const register = await asParticipant(request(application).post(soloPath(event.id)));
    const { razorpayOrderId } = register.body.data.payment;
    const razorpayPaymentId = "pay_test_1";

    const response = await asParticipant(request(application).post("/api/v1/payments/verify")).send({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: signPayment(razorpayOrderId, razorpayPaymentId),
    });

    expect(response.status).toBe(200);
    expect((await PaymentOrderModel.findOne({ razorpayOrderId })).status).toBe("captured");

    const registration = await RegistrationModel.findOne({ eventId: event._id, userId: participant.user._id });
    expect(registration.status).toBe("confirmed");
    expect(registration.paymentStatus).toBe("completed");

    const pass = await PassModel.findOne({ userId: participant.user._id, festId: fest._id });
    expect(pass).not.toBe(null);
    expect(
      await EntitlementModel.countDocuments({ passId: pass._id, entitlementType: "eventEntry", referenceId: event._id })
    ).toBe(1);
  });

  it("rejects an invalid signature with 400 and changes nothing", async () => {
    const event = await paidEvent({ eventSlug: "paid-3" });
    const register = await asParticipant(request(application).post(soloPath(event.id)));
    const { razorpayOrderId } = register.body.data.payment;

    const response = await asParticipant(request(application).post("/api/v1/payments/verify")).send({
      razorpayOrderId,
      razorpayPaymentId: "pay_test_2",
      razorpaySignature: "deadbeef",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("PAYMENT_VERIFICATION_FAILED");
    expect((await PaymentOrderModel.findOne({ razorpayOrderId })).status).toBe("created");
    const registration = await RegistrationModel.findOne({ eventId: event._id, userId: participant.user._id });
    expect(registration.status).toBe("pendingPayment");
    expect(await PassModel.countDocuments({ userId: participant.user._id })).toBe(0);
  });
});

describe("GET /api/v1/payments/status/:paymentGroupId", () => {
  it("returns the caller's own group with statuses, amount and expiresAt", async () => {
    const event = await paidEvent({ eventSlug: "status-1" });
    const register = await asParticipant(request(application).post(soloPath(event.id)));
    const { payment } = register.body.data;
    const registrationId = register.body.data.registration.id;

    const response = await asParticipant(
      request(application).get(`/api/v1/payments/status/${payment.paymentGroupId}`)
    );

    expect(response.status).toBe(200);
    const status = response.body.data;
    expect(status.paymentGroupId).toBe(payment.paymentGroupId);
    expect(status.registrationStatus).toBe("pendingPayment");
    expect(status.paymentStatus).toBe("pending");
    expect(status.registrationId).toBe(registrationId);
    expect(status.totalAmountPaise).toBeGreaterThan(0);
    expect(new Date(status.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses another user's group with 403 PERMISSION_DENIED, same as an unknown id", async () => {
    const event = await paidEvent({ eventSlug: "status-2" });
    const register = await asParticipant(request(application).post(soloPath(event.id)));
    const { payment } = register.body.data;

    const otherParticipant = await createTestParticipant(college, {
      emailAddress: "other-participant@example.com",
      usn: "1BB00BB000",
    });
    const response = await request(application)
      .get(`/api/v1/payments/status/${payment.paymentGroupId}`)
      .set("Authorization", `Bearer ${otherParticipant.authenticationToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("capture landing after the hold expired", () => {
  it("verify answers 409 PAYMENT_CAPTURED_AFTER_EXPIRY, writes an audit row, and does not resurrect the seat", async () => {
    const event = await paidEvent({ eventSlug: "expired-1" });
    const register = await asParticipant(request(application).post(soloPath(event.id)));
    const { paymentGroupId, razorpayOrderId } = register.body.data.payment;

    await expirePaymentGroup(paymentGroupId);

    const razorpayPaymentId = "pay_after_expiry_1";
    const response = await asParticipant(request(application).post("/api/v1/payments/verify")).send({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: signPayment(razorpayOrderId, razorpayPaymentId),
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PAYMENT_CAPTURED_AFTER_EXPIRY");

    const auditRow = await AuditLogModel.findOne({ action: "payment.capturedAfterExpiry" }).lean();
    expect(auditRow).not.toBe(null);
    expect(auditRow.afterState.paymentGroupId).toBe(paymentGroupId);
    expect(auditRow.afterState.paymentReference).toBe(razorpayPaymentId);

    // The seat stays released: the row remains expired and no pass was minted.
    const registration = await RegistrationModel.findOne({ eventId: event._id, userId: participant.user._id });
    expect(registration.status).toBe("paymentExpired");
    expect(registration.paymentStatus).toBe("expired");
    expect(await PassModel.countDocuments({ userId: participant.user._id })).toBe(0);
  });

  it("the webhook still answers 200 for an expired group", async () => {
    const event = await paidEvent({ eventSlug: "expired-2" });
    const register = await asParticipant(request(application).post(soloPath(event.id)));
    const { paymentGroupId, razorpayOrderId } = register.body.data.payment;

    await expirePaymentGroup(paymentGroupId);

    const webhookBody = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_after_expiry_2", order_id: razorpayOrderId } } },
    });
    const response = await request(application)
      .post("/api/v1/payments/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signWebhookBody(webhookBody))
      .send(webhookBody);

    expect(response.status).toBe(200);
    const registration = await RegistrationModel.findOne({ eventId: event._id, userId: participant.user._id });
    expect(registration.status).toBe("paymentExpired");
  });
});

describe("verify idempotency on an already-captured order", () => {
  it("answers alreadyCaptured without a second confirmation or duplicate pass/entitlement", async () => {
    const event = await paidEvent({ eventSlug: "idem-1" });
    const register = await asParticipant(request(application).post(soloPath(event.id)));
    const { razorpayOrderId } = register.body.data.payment;
    const razorpayPaymentId = "pay_idem_1";
    const payload = {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: signPayment(razorpayOrderId, razorpayPaymentId),
    };

    const first = await asParticipant(request(application).post("/api/v1/payments/verify")).send(payload);
    expect(first.status).toBe(200);

    const second = await asParticipant(request(application).post("/api/v1/payments/verify")).send(payload);
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyCaptured).toBe(true);

    const pass = await PassModel.findOne({ userId: participant.user._id, festId: fest._id });
    expect(await PassModel.countDocuments({ userId: participant.user._id })).toBe(1);
    expect(
      await EntitlementModel.countDocuments({ passId: pass._id, entitlementType: "eventEntry", referenceId: event._id })
    ).toBe(1);
  });
});

describe("GET checkout-summary", () => {
  function summaryPath(eventId, teamSize) {
    return `/api/v1/fests/${fest.id}/events/${eventId}/checkout-summary?teamSize=${teamSize}`;
  }

  it("breaks down a perPerson event for a team of 3", async () => {
    const event = await paidEvent({ eventSlug: "sum-pp", feeAmountPaise: 45000 });

    const response = await asParticipant(request(application).get(summaryPath(event.id, 3)));

    expect(response.status).toBe(200);
    const summary = response.body.data;
    expect(summary.registrationFeePaise).toBe(135000); // 45000 × 3
    expect(summary.platformFeePaise).toBe(2000); // from config
    expect(summary.gstAmountPaise).toBe(0); // toggle off
    expect(summary.totalAmountPaise).toBe(137000);
    expect(summary.eventName).toEqual(expect.any(String));
    expect(summary.festName).toBe("Alliance Fest");
  });

  it("returns a zero total and a single free line item for a free event", async () => {
    const event = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "sum-free" })
    );

    const response = await asParticipant(request(application).get(summaryPath(event.id, 1)));

    expect(response.status).toBe(200);
    expect(response.body.data.totalAmountPaise).toBe(0);
    expect(response.body.data.lineItems).toHaveLength(1);
    expect(response.body.data.lineItems[0].amountPaise).toBe(0);
  });
});
