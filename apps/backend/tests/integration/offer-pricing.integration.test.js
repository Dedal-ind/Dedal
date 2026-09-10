import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
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

const PRICED_OFFERS = [
  {
    offerName: "Food",
    offerKey: "food",
    isActive: true,
    isPaid: true,
    ratePaise: 20000,
    collectsNumberOfPeople: true,
  },
  {
    offerName: "DJ Pass",
    offerKey: "dj-pass",
    isActive: true,
    isPaid: true,
    ratePaise: 10000,
    collectsNumberOfPeople: true,
    numberOfPeopleMaximum: 2,
  },
];

let college;
let admin;
let fest;
let participant;
let participantCounter = 0;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

async function nextParticipant() {
  participantCounter += 1;
  return createTestParticipant(college, {
    emailAddress: `pricing${participantCounter}@example.com`,
    usn: `1PR00AA${participantCounter.toString().padStart(3, "0")}`,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([RegistrationModel.createIndexes(), StaffAssignmentModel.createIndexes()]);
});

beforeEach(async () => {
  await clearAllCollections();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published", offers: PRICED_OFFERS });
  participant = await nextParticipant();
});

afterAll(teardownTestDatabase);

describe("priced offers on registration", () => {
  it("(1) a FREE event with a paid offer selection is PENDING_PAYMENT, never auto-confirmed", async () => {
    const freeEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "free-paid-offer", feeType: "free", feeAmountPaise: 0 })
    );

    const response = await withToken(
      request(application).post(`/api/v1/events/${freeEvent.id}/registrations/solo`),
      participant.authenticationToken
    ).send({ foodPreference: "veg", foodOrderCount: 2 }); // solo derives quantity 1; the 2 is ignored by design

    expect(response.status).toBe(201);
    const registration = response.body.data.registration;
    expect(registration.status).toBe("pendingPayment");
    expect(registration.paymentStatus).toBe("pending");
    expect(registration.totalFeePaise).toBe(20000); // 1 meal at Rs 200 (solo food quantity is derived, never asked)
    expect(response.body.data.payment.paymentGroupId).toEqual(expect.any(String));
  });

  it("(2)+(3) a team leader booking food x4 is charged 4x mealPrice, breakdown sums exactly", async () => {
    const teamEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({
        eventType: "team",
        eventSlug: "priced-team",
        minimumTeamSize: 2,
        maximumTeamSize: 4,
        category: "technical",
        feeType: "perPerson",
        feeAmountPaise: 5000,
      })
    );

    const response = await withToken(
      request(application).post("/api/v1/teams"),
      participant.authenticationToken
    ).send({
      eventId: String(teamEvent._id),
      teamName: "Priced Team",
      foodPreference: "veg",
      foodOrderCount: 4,
      offerSelections: [{ offerKey: "dj-pass", numberOfPeople: 2 }],
    });

    expect(response.status).toBe(201);
    const registration = response.body.data.registration;
    // Leader's share: event 5000 + food 4x20000 + dj 2x10000.
    expect(registration.totalFeePaise).toBe(105000);
    const breakdownSum = registration.feeBreakdown.reduce((sum, line) => sum + line.subtotalPaise, 0);
    expect(breakdownSum).toBe(registration.totalFeePaise); // never off by 1 paise
    expect(registration.feeBreakdown.map((line) => line.label)).toEqual(["Registration", "Food", "DJ Pass"]);
  });

  it("(4) a joiner pays the event share only, food inherited, zero offer fee", async () => {
    const teamEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({
        eventType: "team",
        eventSlug: "join-share",
        minimumTeamSize: 2,
        maximumTeamSize: 3,
        category: "technical",
        feeType: "free",
        feeAmountPaise: 0,
      })
    );
    const createResponse = await withToken(
      request(application).post("/api/v1/teams"),
      participant.authenticationToken
    ).send({
      eventId: String(teamEvent._id),
      teamName: "Join Share",
      foodPreference: "veg",
      foodOrderCount: 3,
    });
    expect(createResponse.status).toBe(201);
    const { inviteCode } = createResponse.body.data.team;

    const joiner = await nextParticipant();
    const joinResponse = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode });
    expect(joinResponse.status).toBe(200);
    const joinerRegistration = joinResponse.body.data.registration;
    expect(joinerRegistration.totalFeePaise).toBe(0); // free event share, no offer fee
    expect(joinerRegistration.foodPreference).toBe("veg"); // inherited
    expect(joinerRegistration.status).toBe("confirmed");
  });

  it("(5) an offer selection above numberOfPeopleMaximum is rejected with the bounds", async () => {
    const soloEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "over-cap", feeType: "free", feeAmountPaise: 0 })
    );
    const response = await withToken(
      request(application).post(`/api/v1/events/${soloEvent.id}/registrations/solo`),
      participant.authenticationToken
    ).send({ foodPreference: "noMealNeeded", offerSelections: [{ offerKey: "dj-pass", numberOfPeople: 3 }] }); // max 2

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("OFFER_SELECTION_INVALID");
    expect(response.body.error.details).toMatchObject({
      offerKey: "dj-pass",
      axis: "number of people",
      minimum: 1,
      maximum: 2,
    });
  });
});

describe("multi-checkpoint offers", () => {
  it("checkpoints coexist, a custom rename survives, deactivation preserves rows, identity is frozen", async () => {
    const draftFest = await createTestFest(college, admin.user, {
      festName: "Checkpoint Fest",
      festSlug: "checkpoint-fest",
      status: "draft",
      offers: [{ offerName: "Food", offerKey: "food", isActive: true, isPaid: false, ratePaise: 0 }],
    });
    await withToken(request(application).post(`/api/v1/fests/${draftFest.id}/publish`), admin.authenticationToken);
    const reloaded = await FestModel.findById(draftFest._id);
    const offerId = String(reloaded.offers[0]._id);

    const createResponse = await withToken(
      request(application).post(`/api/v1/fests/${draftFest.id}/checkpoints`),
      admin.authenticationToken
    ).send({ offerId, checkpointName: "Food Counter B" });
    expect(createResponse.status).toBe(201);
    expect(await CheckpointModel.countDocuments({ festId: draftFest._id, checkpointType: "offer" })).toBe(2);

    // Customise the default's name, then rename the offer: the customised
    // checkpoint must NOT be renamed out from under the admin.
    const defaultCheckpoint = await CheckpointModel.findOne({
      festId: draftFest._id,
      checkpointType: "offer",
      checkpointName: "Food",
    });
    await withToken(
      request(application).patch(`/api/v1/fests/${draftFest.id}/checkpoints/${defaultCheckpoint.id}`),
      admin.authenticationToken
    ).send({ checkpointName: "Main Food Court" });

    await withToken(request(application).patch(`/api/v1/fests/${draftFest.id}`), admin.authenticationToken).send({
      offers: [{ offerName: "FOOD", isActive: true, isPaid: false }],
    });
    const afterRename = await CheckpointModel.findById(defaultCheckpoint._id);
    expect(afterRename.checkpointName).toBe("Main Food Court");

    const deactivate = await withToken(
      request(application).patch(`/api/v1/fests/${draftFest.id}/checkpoints/${defaultCheckpoint.id}`),
      admin.authenticationToken
    ).send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect((await CheckpointModel.findById(defaultCheckpoint._id)).isActive).toBe(false);
    expect(await CheckpointModel.countDocuments({ festId: draftFest._id, checkpointType: "offer" })).toBe(2);

    const frozen = await withToken(
      request(application).patch(`/api/v1/fests/${draftFest.id}/checkpoints/${defaultCheckpoint.id}`),
      admin.authenticationToken
    ).send({ offerId });
    expect(frozen.status).toBe(400);
    expect(frozen.body.error.code).toBe("CHECKPOINT_IDENTITY_FROZEN");
  });

  it("rejects a checkpoint for an offer not on this fest", async () => {
    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/checkpoints`),
      admin.authenticationToken
    ).send({ offerId: "000000000000000000000000", checkpointName: "Ghost Counter" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CHECKPOINT_OFFER_MISMATCH");
  });
});

/*
 * The "offer-scoped staff assignments" suite that lived here is DELETED, not
 * skipped: StaffAssignment.offerIds and its coverage narrowing were reverted on
 * the client's instruction that only volunteers need scan access at offers, so
 * there is no longer any narrowing to assert. A volunteer's reach is decided by
 * the SHIFT they are scheduled on (one checkpoint), which
 * volunteer-shift/scanner suites already cover.
 */
