import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { ContingentModel } from "../../src/models/contingent-model.js";
import { ContingentClaimModel } from "../../src/models/contingent-claim-model.js";
import { PaymentOrderModel } from "../../src/models/payment-order-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import {
  installEmailServiceMock,
  findRecordedEmailsOfKind,
  clearRecordedEmails,
} from "../setup/test-email-service.js";
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
  createTestEventEntitlement,
  createTestEventCheckpoint,
  createTestStaffMember,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * Cancelling used to be a status flip that left every downstream fact
 * contradicting it. These tests pin the cascade: the registrations end, the door
 * entitlement is revoked, the checkpoint stops scanning, captured money is
 * marked refund-pending, and everyone is told — while gate access, other events
 * and offer claims are deliberately left alone.
 */
let college;
let admin;
let fest;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

/* Five paid, confirmed registrations on one event, each with a real pass whose
 * entitlements mirror what registration would have minted. */
async function seedFiveParticipants(event, otherEvent) {
  const participants = [];
  for (let index = 0; index < 5; index += 1) {
    const participant = await createTestParticipant(college, {
      emailAddress: `cascade${index}@example.com`,
      usn: `1CS00AA00${index}`,
    });
    const paymentGroupId = `group-${index}`;
    const registration = await RegistrationModel.create({
      eventId: event._id,
      userId: participant.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 50000,
      totalFeePaise: 50000,
      paymentStatus: "completed",
      paymentGroupId,
      registeredAt: new Date(),
    });
    // A captured order is what makes a refund owed.
    await PaymentOrderModel.create({
      paymentGroupId,
      razorpayOrderId: `order_cascade_${index}`,
      razorpayPaymentId: `pay_cascade_${index}`,
      registrationFeePaise: 50000,
      totalAmountPaise: 52000,
      status: "captured",
    });

    const pass = await createTestPass(fest, participant.user);
    await createTestGateEntitlement(pass);
    await createTestEventEntitlement(pass, event._id);
    // A second event's entry, which must survive the first event's cancellation.
    await createTestEventEntitlement(pass, otherEvent._id);

    participants.push({ participant, registration, pass });
  }
  return participants;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([RegistrationModel.createIndexes(), EntitlementModel.createIndexes()]);
});

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, {
    status: "published",
    contactEmail: "help@example.com",
  });
});

afterAll(teardownTestDatabase);

describe("cancelEvent cascade", () => {
  it("(1) flips all 5 registrations, revokes their door entitlements, deactivates the checkpoint, marks 5 refunds and emails 5 people", async () => {
    const event = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "cascade-event", eventName: "Finance" })
    );
    const otherEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "survivor-event", eventName: "Marketing" })
    );
    const checkpoint = await createTestEventCheckpoint(fest, event._id);
    const seeded = await seedFiveParticipants(event, otherEvent);

    // The preview an admin sees BEFORE confirming, on its own read-only route.
    const preview = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/events/${event.id}/cancel-preview`),
      admin.authenticationToken
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      activeRegistrationCount: 5,
      paidRegistrationCount: 5,
      entitlementCount: 5,
      contingentClaimCount: 0,
      hasActiveScans: false,
      totalRefundPendingPaise: 250000,
    });

    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/cancel`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data.cascade).toMatchObject({
      registrationsFlipped: 5,
      entitlementsRevoked: 5,
      checkpointsDeactivated: 1,
      refundMarkerCount: 5,
      notifiedCount: 5,
    });

    // Registrations end as the ORGANISER's act, distinct from self-cancellation.
    const cancelledRows = await RegistrationModel.find({ eventId: event._id }).lean();
    expect(cancelledRows).toHaveLength(5);
    for (const row of cancelledRows) {
      expect(row.status).toBe("eventCancelled");
      expect(row.eventCancelledAt).toBeInstanceOf(Date);
      expect(row.cancelledByRole).toBe("admin");
      expect(row.cancellationReason).toBeTruthy();
    }

    // The door is shut: entitlement revoked and checkpoint deactivated, neither deleted.
    const doorEntitlements = await EntitlementModel.find({
      entitlementType: "eventEntry",
      referenceId: event._id,
    }).lean();
    expect(doorEntitlements).toHaveLength(5);
    expect(doorEntitlements.every((entitlement) => entitlement.status === "revoked")).toBe(true);
    const reloadedCheckpoint = await CheckpointModel.findById(checkpoint._id);
    expect(reloadedCheckpoint).not.toBeNull();
    expect(reloadedCheckpoint.isActive).toBe(false);

    // Captured money is owed back: marker on the order plus an audit row each.
    const refundPendingOrders = await PaymentOrderModel.countDocuments({ status: "refundPending" });
    expect(refundPendingOrders).toBe(5);
    expect(await AuditLogModel.countDocuments({ action: "payment.refundPending" })).toBe(5);

    // One email each, naming the event.
    const notices = findRecordedEmailsOfKind("generic").filter((email) =>
      email.subject.includes("Finance has been cancelled")
    );
    expect(notices).toHaveLength(5);
    expect(notices[0].text).toMatch(/marked for refund/);

    // The event itself, and the audit row carrying the cascade counts.
    expect((await EventModel.findById(event._id)).status).toBe("cancelled");
    const eventAudit = await AuditLogModel.findOne({
      action: "event.cancelled",
      entityId: event._id,
    });
    expect(eventAudit.afterState).toMatchObject({ registrationsFlipped: 5, refundMarkerCount: 5 });
    expect(seeded).toHaveLength(5);
  });

  it("(2) leaves gate access and the OTHER event's entry entitlements untouched", async () => {
    const event = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "blast-radius", eventName: "Finance" })
    );
    const otherEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "blast-radius-other", eventName: "Marketing" })
    );
    await createTestEventCheckpoint(fest, event._id);
    await seedFiveParticipants(event, otherEvent);

    await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/cancel`),
      admin.authenticationToken
    );

    const gateEntitlements = await EntitlementModel.find({ entitlementType: "gateAccess" }).lean();
    expect(gateEntitlements).toHaveLength(5);
    expect(gateEntitlements.every((entitlement) => entitlement.status === "active")).toBe(true);

    const otherEventEntitlements = await EntitlementModel.find({
      entitlementType: "eventEntry",
      referenceId: otherEvent._id,
    }).lean();
    expect(otherEventEntitlements).toHaveLength(5);
    expect(otherEventEntitlements.every((entitlement) => entitlement.status === "active")).toBe(true);

    // The other event's own registrations and checkpoint are not in scope either.
    expect(
      await RegistrationModel.countDocuments({ eventId: otherEvent._id, status: "eventCancelled" })
    ).toBe(0);
  });

  it("(3) refuses with CONTINGENT_LOCKS_EVENT and cascades NOTHING when a contingent locks the event", async () => {
    const parentEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "locked-parent", category: null })
    );
    const lockedEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "locked-event",
        eventName: "Finance",
        parentEventId: parentEvent._id,
      })
    );
    const secondEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "locked-second",
        parentEventId: parentEvent._id,
      })
    );
    const checkpoint = await createTestEventCheckpoint(fest, lockedEvent._id);
    await seedFiveParticipants(lockedEvent, secondEvent);

    await ContingentModel.create({
      festId: fest._id,
      parentEventId: parentEvent._id,
      contingentName: "Management Contingent",
      includedEventIds: [lockedEvent._id, secondEvent._id],
      pricePaise: 10000,
      individualTotalPaise: 20000,
      status: "published",
      createdByUserId: admin.user._id,
    });

    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${lockedEvent.id}/cancel`),
      admin.authenticationToken
    );
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONTINGENT_LOCKS_EVENT");
    expect(response.body.error.details.contingentName).toBe("Management Contingent");

    // NOTHING ran: the guard is before the cascade, so no half-cancelled state.
    expect(await RegistrationModel.countDocuments({ status: "eventCancelled" })).toBe(0);
    expect(
      await EntitlementModel.countDocuments({ entitlementType: "eventEntry", status: "revoked" })
    ).toBe(0);
    expect((await CheckpointModel.findById(checkpoint._id)).isActive).toBe(true);
    expect(await PaymentOrderModel.countDocuments({ status: "refundPending" })).toBe(0);
    expect(findRecordedEmailsOfKind("generic")).toHaveLength(0);
    expect((await EventModel.findById(lockedEvent._id)).status).not.toBe("cancelled");
  });
});

describe("fest archive and unarchive", () => {
  it("(4) unarchiveFest returns the fest to DRAFT — verbatim, so a future change cannot quietly alter it", async () => {
    const archiveResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/archive`),
      admin.authenticationToken
    );
    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body.data.status).toBe("archived");
    expect(archiveResponse.body.data.archivedAt).toBeTruthy();

    const unarchiveResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/unarchive`),
      admin.authenticationToken
    );
    expect(unarchiveResponse.status).toBe(200);
    // DRAFT, not back to published: the fest must be re-checked and re-published.
    expect(unarchiveResponse.body.data.status).toBe("draft");
    expect(unarchiveResponse.body.data.archivedAt).toBeNull();
  });

  it("(5) archiving an already-archived fest is 409 INVALID_FEST_STATE — NOT idempotent, NOT 400", async () => {
    await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/archive`),
      admin.authenticationToken
    );
    const secondArchive = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/archive`),
      admin.authenticationToken
    );
    // Recorded verbatim: 409, INVALID_FEST_STATE, with both context fields.
    expect(secondArchive.status).toBe(409);
    expect(secondArchive.body.error.code).toBe("INVALID_FEST_STATE");
    expect(secondArchive.body.error.details).toMatchObject({
      currentStatus: "archived",
      attemptedTransition: "archived",
    });
  });

  it("a DRAFT fest is archivable — the UI now offers it for every non-archived status", async () => {
    const draftFest = await createTestFest(college, admin.user, {
      festName: "Draft Fest",
      festSlug: "draft-fest-archive",
      status: "draft",
    });
    const response = await withToken(
      request(application).post(`/api/v1/fests/${draftFest.id}/archive`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("archived");
  });
});

describe("fest cancellation", () => {
  it("cascades every event, groups ONE email per participant, cancels contingents, closes the gate, and is irreversible", async () => {
    const firstEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "fest-cancel-one", eventName: "Finance" })
    );
    const secondEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "fest-cancel-two", eventName: "Marketing" })
    );
    await createTestEventCheckpoint(fest, firstEvent._id);
    await createTestEventCheckpoint(fest, secondEvent._id, {
      checkpointName: "Marketing Entry",
    });

    // One participant in BOTH events: they must receive exactly one email.
    const shared = await createTestParticipant(college, {
      emailAddress: "shared@example.com",
      usn: "1SH00AA001",
    });
    const sharedPass = await createTestPass(fest, shared.user);
    await createTestGateEntitlement(sharedPass);
    for (const event of [firstEvent, secondEvent]) {
      await RegistrationModel.create({
        eventId: event._id,
        userId: shared.user._id,
        status: "confirmed",
        feeAmountSnapshotPaise: 50000,
        totalFeePaise: 50000,
        paymentStatus: "completed",
        paymentGroupId: `shared-${event.eventSlug}`,
        registeredAt: new Date(),
      });
      await PaymentOrderModel.create({
        paymentGroupId: `shared-${event.eventSlug}`,
        razorpayOrderId: `order_shared_${event.eventSlug}`,
        razorpayPaymentId: `pay_shared_${event.eventSlug}`,
        registrationFeePaise: 50000,
        totalAmountPaise: 52000,
        status: "captured",
      });
      await createTestEventEntitlement(sharedPass, event._id);
    }

    const contingent = await ContingentModel.create({
      festId: fest._id,
      parentEventId: firstEvent._id,
      contingentName: "Doomed Contingent",
      includedEventIds: [firstEvent._id, secondEvent._id],
      pricePaise: 10000,
      individualTotalPaise: 20000,
      status: "published",
      createdByUserId: admin.user._id,
    });
    await ContingentClaimModel.create({
      contingentId: contingent._id,
      festId: fest._id,
      eventId: firstEvent._id,
      contingentPurchaseGroupId: "doomed-group",
      buyerUserId: shared.user._id,
      attendeeUserId: shared.user._id,
      attendeeEmailAddress: "shared@example.com",
      attendeeFullName: "Shared Person",
      attendeePhoneNumber: "+919000000000",
      claimStatus: "invited",
      paymentStatus: "completed",
    });

    const preview = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/cancel-preview`),
      admin.authenticationToken
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      eventCount: 2,
      registrationCount: 2,
      paidRegistrationCount: 2,
      contingentCount: 1,
      contingentClaimCount: 1,
      participantCount: 1, // one PERSON, two registrations
      totalRefundPendingPaise: 100000,
    });

    clearRecordedEmails();
    const shortReason = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/cancel`),
      admin.authenticationToken
    ).send({ reason: "too short" });
    expect(shortReason.status).toBe(400);
    expect(shortReason.body.error.code).toBe("CANCELLATION_REASON_REQUIRED");

    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/cancel`),
      admin.authenticationToken
    ).send({ reason: "Venue withdrawn; the fest cannot go ahead." });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      eventsCancelled: 2,
      registrationsFlipped: 2,
      contingentsCancelled: 1,
      claimsCancelled: 1,
      participantsNotified: 1,
    });

    // ONE email for the whole fest, listing both events.
    const festNotices = findRecordedEmailsOfKind("generic").filter((email) =>
      email.subject.includes("has been cancelled")
    );
    expect(festNotices).toHaveLength(1);
    expect(festNotices[0].text).toMatch(/Finance/);
    expect(festNotices[0].text).toMatch(/Marketing/);

    expect((await FestModel.findById(fest._id)).status).toBe("cancelled");
    expect(await EventModel.countDocuments({ festId: fest._id, status: "cancelled" })).toBe(2);
    expect(
      await EntitlementModel.countDocuments({ entitlementType: "gateAccess", status: "revoked" })
    ).toBe(1);
    expect((await ContingentModel.findById(contingent._id)).status).toBe("cancelled");
    expect(await ContingentClaimModel.countDocuments({ claimStatus: "cancelled" })).toBe(1);
    expect(await PaymentOrderModel.countDocuments({ status: "refundPending" })).toBe(2);

    // IRREVERSIBLE: no un-cancel, and archive cannot launder it back to a draft.
    const secondCancel = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/cancel`),
      admin.authenticationToken
    ).send({ reason: "Trying to cancel it twice over." });
    expect(secondCancel.status).toBe(409);
    const archiveAttempt = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/archive`),
      admin.authenticationToken
    );
    expect(archiveAttempt.status).toBe(409);
  });

  it("refuses to cancel a fest that is not published — a draft has nobody to notify", async () => {
    const draftFest = await createTestFest(college, admin.user, {
      festName: "Draft Fest",
      festSlug: "draft-cancel",
      status: "draft",
    });
    const response = await withToken(
      request(application).post(`/api/v1/fests/${draftFest.id}/cancel`),
      admin.authenticationToken
    ).send({ reason: "Nobody is registered for this yet." });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_FEST_STATE");
  });
});

describe("staff revocation on cancellation", () => {
  it("cancelEvent revokes ONLY an assignment scoped to exactly this event", async () => {
    const targetEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "staff-target", eventName: "Finance" })
    );
    const otherEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "staff-other", eventName: "Marketing" })
    );

    const { StaffAssignmentModel } = await import("../../src/models/staff-assignment-model.js");
    // Scoped to the cancelled event alone → revoked.
    const singleEventCoordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "single-event@example.com",
      assignment: { eventIds: [targetEvent._id] },
    });
    // Covers another live event too → UNCHANGED.
    const multiEventVolunteer = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "multi-event@example.com",
      assignment: { eventIds: [targetEvent._id, otherEvent._id] },
    });
    // Fest-wide (empty eventIds) → UNCHANGED.
    const festWideCoordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "fest-wide@example.com",
      assignment: { eventIds: [] },
    });

    clearRecordedEmails();
    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${targetEvent.id}/cancel`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data.cascade.staffAssignmentsRevoked).toBe(1);

    expect(
      (await StaffAssignmentModel.findById(singleEventCoordinator.staffAssignment._id)).status
    ).toBe("revoked");
    expect(
      (await StaffAssignmentModel.findById(multiEventVolunteer.staffAssignment._id)).status
    ).toBe("active");
    expect(
      (await StaffAssignmentModel.findById(festWideCoordinator.staffAssignment._id)).status
    ).toBe("active");

    // The existing revocation path fired: audit row + email, once.
    expect(await AuditLogModel.countDocuments({ action: "staff.revoked" })).toBe(1);
    const revocationEmails = findRecordedEmailsOfKind("assignmentRevocation");
    expect(revocationEmails).toHaveLength(1);
    expect(revocationEmails[0].reason).toBe("Event cancelled");
  });

  it("cancelFest revokes EVERY assignment and does not send participant mail to non-participant staff", async () => {
    const event = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventSlug: "fest-staff-event", eventName: "Finance" })
    );
    const { StaffAssignmentModel } = await import("../../src/models/staff-assignment-model.js");

    // Staff only — never registered as a participant.
    const staffOnly = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "staff-only@example.com",
      assignment: { eventIds: [] },
    });
    // Staff AND a registered participant — must receive BOTH messages.
    const staffAndParticipant = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "both-roles@example.com",
      assignment: { eventIds: [event._id] },
    });
    await RegistrationModel.create({
      eventId: event._id,
      userId: staffAndParticipant.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: 0,
      paymentStatus: "notRequired",
      registeredAt: new Date(),
    });

    clearRecordedEmails();
    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/cancel`),
      admin.authenticationToken
    ).send({ reason: "Venue withdrawn; the fest cannot go ahead." });
    expect(response.status).toBe(200);
    expect(response.body.data.staffAssignmentsRevoked).toBe(2);

    expect((await StaffAssignmentModel.findById(staffOnly.staffAssignment._id)).status).toBe("revoked");
    expect(
      (await StaffAssignmentModel.findById(staffAndParticipant.staffAssignment._id)).status
    ).toBe("revoked");

    // Reason carried into the existing revocation path for both.
    const revocationEmails = findRecordedEmailsOfKind("assignmentRevocation");
    expect(revocationEmails).toHaveLength(2);
    expect(revocationEmails.every((email) => email.reason === "Fest cancelled - organiser-initiated")).toBe(true);

    /*
     * TWO populations. The participant-facing fest email goes ONLY to registered
     * participants: the staff-only volunteer must not receive it, while the person
     * who is both gets one of each. Not a duplicate — one about access, one about
     * attendance.
     */
    const participantNotices = findRecordedEmailsOfKind("generic").filter((email) =>
      email.subject.includes("has been cancelled")
    );
    expect(participantNotices.map((email) => email.emailAddress)).toEqual(["both-roles@example.com"]);
  });
});
