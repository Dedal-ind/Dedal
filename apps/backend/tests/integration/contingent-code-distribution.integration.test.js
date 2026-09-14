/*
 * contingent-code-distribution.integration.test.js
 *
 * The code-distribution contingent flow, end to end over HTTP:
 *
 *   buyer pays → one code per included event → codes handed out → each holder
 *   redeems → registration, pass, entitlements, add-ons, team.
 *
 * A solo code admits one person; a team code admits the team's maximum size,
 * and everyone who redeems it joins the one team it stands for. The buyer is
 * never registered by buying. The legacy claim-based flow has its own suite
 * (contingent.integration.test.js); the last test here only proves a
 * pre-existing claim purchase is still readable beside the new one.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { PaymentOrderModel } from "../../src/models/payment-order-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { TeamModel } from "../../src/models/team-model.js";
import { ContingentModel } from "../../src/models/contingent-model.js";
import { ContingentClaimModel } from "../../src/models/contingent-claim-model.js";
import { ContingentPurchaseModel } from "../../src/models/contingent-purchase-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import { installRazorpayClientMock, clearRecordedOrders } from "../setup/test-razorpay-service.js";
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

const CODE_PATTERN = /^[23456789A-HJKMNP-Z]{8}$/;

/* A paid, people-counted fest add-on — the kind a redeemer buys on top of access. */
const FEST_OFFERS = [
  {
    offerName: "DJ Night",
    offerKey: "djnight",
    isActive: true,
    isPaid: true,
    ratePaise: 20000,
    collectsNumberOfPeople: true,
    numberOfPeopleMinimum: 1,
    numberOfPeopleMaximum: 4,
  },
];

let college;
let admin;
let fest;
let buyer;
let parentEvent;
let financeEvent;
let marketingEvent;
let participantCounter = 0;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

function signPayment(razorpayOrderId, razorpayPaymentId) {
  return crypto
    .createHmac("sha256", "rzp_test_secret")
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
}

async function nextParticipant() {
  participantCounter += 1;
  return createTestParticipant(college, {
    emailAddress: `redeemer${participantCounter}@example.com`,
    usn: `1CD00AA${String(participantCounter).padStart(3, "0")}`,
  });
}

async function createVertical(slug, overrides = {}) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: slug,
      eventName: slug.toUpperCase(),
      parentEventId: parentEvent._id,
      feeType: "perPerson",
      feeAmountPaise: 10000,
      ...overrides,
    })
  );
}

/* The whole admin flow: pick verticals, a price, a description, publish. No name. */
async function publishBundle(includedEvents, pricePaise = 0) {
  const createResponse = await withToken(
    request(application).post(`/api/v1/fests/${fest.id}/contingents`),
    admin.authenticationToken
  ).send({
    parentEventId: String(parentEvent._id),
    includedEventIds: includedEvents.map((event) => String(event._id)),
    pricePaise,
    description: "Everything Chaturanga runs, for one college squad.",
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

function buy(contingentId, participant = buyer) {
  return withToken(
    request(application).post(`/api/v1/contingents/${contingentId}/purchase`),
    participant.authenticationToken
  ).send({});
}

function redeem(code, participant, body = {}) {
  return withToken(
    request(application).post(`/api/v1/contingents/codes/${code}/redeem`),
    participant.authenticationToken
  ).send(body);
}

function inspect(code, participant) {
  return withToken(
    request(application).get(`/api/v1/contingents/codes/${code}/inspect`),
    participant.authenticationToken
  );
}

function listMyCodes(participant = buyer) {
  return withToken(
    request(application).get("/api/v1/contingents/codes/mine"),
    participant.authenticationToken
  );
}

async function capturePayment(razorpayOrderId, participant) {
  const razorpayPaymentId = `pay_${razorpayOrderId}`;
  const response = await withToken(
    request(application).post("/api/v1/payments/verify"),
    participant.authenticationToken
  ).send({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature: signPayment(razorpayOrderId, razorpayPaymentId),
  });
  expect(response.status).toBe(200);
}

/* A free bundle bought by the buyer; returns the one code per event, keyed by event id. */
async function buyFreeBundle(includedEvents) {
  const contingentId = await publishBundle(includedEvents, 0);
  const purchaseResponse = await buy(contingentId);
  expect(purchaseResponse.status).toBe(201);
  const { purchase } = purchaseResponse.body.data;
  const codeByEventId = new Map(purchase.codes.map((entry) => [entry.eventId, entry.code]));
  return { contingentId, purchase, codeByEventId };
}

/* A max-3 team event in a bundle, and its single team code. */
async function buyTeamCode({ minimumTeamSize = 2, maximumTeamSize = 3 } = {}) {
  const teamEvent = await createVertical("case-study", {
    eventType: "team",
    minimumTeamSize,
    maximumTeamSize,
    capacity: 30,
  });
  const { purchase, codeByEventId } = await buyFreeBundle([financeEvent, teamEvent]);
  return { teamEvent, purchase, teamCode: codeByEventId.get(String(teamEvent._id)) };
}

async function storedCodeEntry(code) {
  const purchase = await ContingentPurchaseModel.findOne({ "codes.code": code });
  return purchase.codes.find((entry) => entry.code === code);
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    TeamModel.createIndexes(),
    ContingentPurchaseModel.createIndexes(),
    EntitlementModel.createIndexes(),
  ]);
});

afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedOrders();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published", offers: FEST_OFFERS });
  buyer = await createTestParticipant(college, { emailAddress: "buyer@example.com", usn: "1CD00BB001" });
  parentEvent = await createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: "chaturanga",
      eventName: "Chaturanga",
      category: null,
      feeType: "free",
      feeAmountPaise: 0,
    })
  );
  financeEvent = await createVertical("finance", { capacity: 10 });
  marketingEvent = await createVertical("marketing", { capacity: 10 });
});

describe("contingent code distribution", () => {
  it("a purchase generates one code per included event, sized to the event", async () => {
    const teamEvent = await createVertical("case-study", {
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 3,
    });
    const { contingentId, purchase } = await buyFreeBundle([financeEvent, marketingEvent, teamEvent]);

    expect(purchase.status).toBe("completed");
    expect(purchase.codeCount).toBe(3);
    const entryFor = (event) => purchase.codes.find((entry) => entry.eventId === String(event._id));
    expect(entryFor(financeEvent)).toMatchObject({ eventType: "solo", maxUses: 1, claimCount: 0, isFull: false });
    expect(entryFor(marketingEvent)).toMatchObject({ eventType: "solo", maxUses: 1 });
    expect(entryFor(teamEvent)).toMatchObject({ eventType: "team", maxUses: 3, remainingUses: 3, isFull: false });
    expect(purchase.codes.every((entry) => entry.isRedeemable)).toBe(true);

    // Buying is not registering: the buyer holds codes, not seats.
    expect(await RegistrationModel.countDocuments({ userId: buyer.user._id })).toBe(0);
    expect((await EventModel.findById(financeEvent._id)).registeredCount).toBe(0);
    expect((await ContingentModel.findById(contingentId)).flowType).toBe("codeDistribution");
    expect(
      await AuditLogModel.countDocuments({ action: { $in: ["contingentPurchase.created", "contingentPurchase.codesIssued"] } })
    ).toBe(2);
  });

  it("each code is unique across every purchase and the index refuses a duplicate", async () => {
    const contingentId = await publishBundle([financeEvent, marketingEvent], 0);
    const secondBuyer = await nextParticipant();
    const first = await buy(contingentId);
    const second = await buy(contingentId, secondBuyer);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const allCodes = [...first.body.data.purchase.codes, ...second.body.data.purchase.codes].map(
      (entry) => entry.code
    );
    expect(allCodes).toHaveLength(4);
    expect(new Set(allCodes).size).toBe(4);
    expect(allCodes.every((code) => CODE_PATTERN.test(code))).toBe(true);

    await expect(
      ContingentPurchaseModel.create({
        contingentId,
        festId: fest._id,
        buyerUserId: buyer.user._id,
        pricePaise: 0,
        status: "completed",
        codes: [{ eventId: financeEvent._id, code: allCodes[0], eventType: "solo", maxUses: 1 }],
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("redeeming a code creates a registration, a pass and an event entitlement", async () => {
    const { purchase, codeByEventId } = await buyFreeBundle([financeEvent, marketingEvent]);
    const financeCode = codeByEventId.get(String(financeEvent._id));
    const redeemer = await nextParticipant();

    const preview = await inspect(financeCode, redeemer);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      redeemable: true,
      usage: { eventType: "solo", maxUses: 1, claimCount: 0, isFull: false },
      event: { eventName: "FINANCE", eventType: "solo" },
      contingent: { parentEventName: "Chaturanga" },
      team: null,
    });
    expect(preview.body.data.addOns.map((offer) => offer.offerKey)).toEqual(["djnight"]);

    const response = await redeem(financeCode, redeemer);
    expect(response.status).toBe(201);
    expect(response.body.data.usage).toMatchObject({ claimCount: 1, isFull: true, isRedeemedByYou: true });

    const registration = await RegistrationModel.findOne({ userId: redeemer.user._id }).lean();
    expect(registration).toMatchObject({
      status: "confirmed",
      paymentStatus: "notRequired",
      totalFeePaise: 0,
      teamId: null,
    });
    expect(String(registration.eventId)).toBe(String(financeEvent._id));
    expect(String(registration.contingentPurchaseId)).toBe(purchase.id);
    expect((await EventModel.findById(financeEvent._id)).registeredCount).toBe(1);

    const pass = await PassModel.findOne({ userId: redeemer.user._id, festId: fest._id }).lean();
    expect(pass).not.toBeNull();
    expect(
      await EntitlementModel.countDocuments({
        passId: pass._id,
        entitlementType: "eventEntry",
        referenceId: financeEvent._id,
        status: "active",
      })
    ).toBe(1);

    const entry = await storedCodeEntry(financeCode);
    expect(entry.claims).toHaveLength(1);
    expect(String(entry.claims[0].userId)).toBe(String(redeemer.user._id));
    expect(String(entry.claims[0].registrationId)).toBe(String(registration._id));
    expect(entry.isFull).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: "contingentPurchase.codeRedeemed" })).toBe(1);
  });

  it("redeeming the same solo code twice is refused", async () => {
    const { codeByEventId } = await buyFreeBundle([financeEvent, marketingEvent]);
    const financeCode = codeByEventId.get(String(financeEvent._id));
    const firstRedeemer = await nextParticipant();
    const secondRedeemer = await nextParticipant();

    expect((await redeem(financeCode, firstRedeemer)).status).toBe(201);

    const again = await redeem(financeCode, firstRedeemer);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CONTINGENT_CODE_ALREADY_REDEEMED");

    const someoneElse = await redeem(financeCode, secondRedeemer);
    expect(someoneElse.status).toBe(409);
    expect(someoneElse.body.error.code).toBe("CONTINGENT_CODE_FULLY_CLAIMED");
    expect(await RegistrationModel.countDocuments({ eventId: financeEvent._id })).toBe(1);
    expect((await EventModel.findById(financeEvent._id)).registeredCount).toBe(1);
  });

  it("a cancelled purchase's unredeemed codes refuse redemption", async () => {
    const contingentId = await publishBundle([financeEvent, marketingEvent], 25000);
    const purchaseResponse = await buy(contingentId);
    expect(purchaseResponse.status).toBe(201);
    const { purchase, payment } = purchaseResponse.body.data;
    // Unpaid: no codes exist yet to leak.
    expect(purchase.status).toBe("pending");
    expect(purchase.codes).toHaveLength(0);

    await capturePayment(payment.razorpayOrderId, buyer);
    const mine = await listMyCodes();
    const paidPurchase = mine.body.data.purchases[0];
    expect(paidPurchase.status).toBe("completed");
    const financeCode = paidPurchase.codes.find((entry) => entry.eventId === String(financeEvent._id)).code;
    const marketingCode = paidPurchase.codes.find((entry) => entry.eventId === String(marketingEvent._id)).code;

    const earlyRedeemer = await nextParticipant();
    expect((await redeem(financeCode, earlyRedeemer)).status).toBe(201);

    const cancelResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents/${contingentId}/cancel`),
      admin.authenticationToken
    );
    expect(cancelResponse.status).toBe(200);
    expect((await ContingentPurchaseModel.findById(purchase.id)).status).toBe("cancelled");
    expect((await PaymentOrderModel.findOne({ paymentGroupId: payment.paymentGroupId })).status).toBe(
      "refundPending"
    );

    const lateRedeemer = await nextParticipant();
    const refused = await redeem(marketingCode, lateRedeemer);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("CONTINGENT_CODE_INVALIDATED");
    const preview = await inspect(marketingCode, lateRedeemer);
    expect(preview.body.data.redeemable).toBe(false);
    expect(preview.body.data.refusal.code).toBe("CONTINGENT_CODE_INVALIDATED");

    // The code redeemed before the cancel was that person's own registration, and stands.
    expect((await RegistrationModel.findOne({ userId: earlyRedeemer.user._id })).status).toBe("confirmed");
    expect(await AuditLogModel.countDocuments({ action: "contingentPurchase.cancelled" })).toBe(1);
  });

  it("a team event code redeemed by three people forms one team", async () => {
    const { teamEvent, teamCode } = await buyTeamCode({ minimumTeamSize: 2, maximumTeamSize: 3 });
    const [first, second, third] = [await nextParticipant(), await nextParticipant(), await nextParticipant()];

    // First: both choices offered, both optional — skipped.
    const firstPreview = await inspect(teamCode, first);
    expect(firstPreview.body.data.team).toMatchObject({
      memberCount: 0,
      canClaimCaptain: true,
      canSetTeamName: true,
      captainRequired: false,
      teamNameRequired: false,
    });
    const firstResponse = await redeem(teamCode, first);
    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body.data.team).toMatchObject({
      teamName: "Unnamed team",
      isTeamNameChosen: false,
      captainUserId: null,
      memberCount: 1,
    });

    // Second-to-last: still optional while nobody has taken the captaincy — skipped again.
    const secondPreview = await inspect(teamCode, second);
    expect(secondPreview.body.data.team).toMatchObject({ captainRequired: false, teamNameRequired: false });
    const secondResponse = await redeem(teamCode, second);
    expect(secondResponse.status).toBe(201);
    expect(secondResponse.body.data.usage).toMatchObject({ claimCount: 2, remainingUses: 1, isFull: false });

    // Last: fills the team and supplies what is still missing.
    const thirdResponse = await redeem(teamCode, third, { claimCaptain: true, teamName: "Closers" });
    expect(thirdResponse.status).toBe(201);
    expect(thirdResponse.body.data.usage).toMatchObject({ claimCount: 3, remainingUses: 0, isFull: true });

    // ONE team, three members, every registration pointing at it.
    const teams = await TeamModel.find({ eventId: teamEvent._id }).lean();
    expect(teams).toHaveLength(1);
    expect(teams[0].memberUserIds.map(String)).toEqual(
      [first, second, third].map((participant) => String(participant.user._id))
    );
    expect(teams[0]).toMatchObject({ teamName: "Closers" });
    expect(String(teams[0].captainUserId)).toBe(String(third.user._id));
    const registrations = await RegistrationModel.find({ eventId: teamEvent._id }).lean();
    expect(registrations).toHaveLength(3);
    expect(registrations.every((row) => String(row.teamId) === String(teams[0]._id))).toBe(true);

    const entry = await storedCodeEntry(teamCode);
    expect(entry.claims.map((claim) => String(claim.userId))).toEqual(
      [first, second, third].map((participant) => String(participant.user._id))
    );
    expect(entry.isFull).toBe(true);
  });

  it("the third person on a max-3 team is forced to be captain", async () => {
    const { teamEvent, teamCode } = await buyTeamCode({ minimumTeamSize: 2, maximumTeamSize: 3 });
    const [first, second, third] = [await nextParticipant(), await nextParticipant(), await nextParticipant()];
    expect((await redeem(teamCode, first)).status).toBe(201);
    expect((await redeem(teamCode, second)).status).toBe(201);

    const preview = await inspect(teamCode, third);
    expect(preview.body.data.team).toMatchObject({
      memberCount: 2,
      fillsTeam: true,
      captainRequired: true,
      teamNameRequired: true,
    });

    const skipped = await redeem(teamCode, third);
    expect(skipped.status).toBe(400);
    expect(skipped.body.error.code).toBe("CONTINGENT_TEAM_CAPTAIN_REQUIRED");
    expect(Object.keys(skipped.body.error.details).sort()).toEqual(["claimCaptain", "teamName"]);

    // Nothing was consumed by the refusal.
    expect((await storedCodeEntry(teamCode)).claims).toHaveLength(2);
    expect(await RegistrationModel.countDocuments({ userId: third.user._id })).toBe(0);
    expect((await EventModel.findById(teamEvent._id)).registeredCount).toBe(2);
    expect((await TeamModel.findOne({ eventId: teamEvent._id })).memberUserIds).toHaveLength(2);

    const forced = await redeem(teamCode, third, { claimCaptain: true, teamName: "Closers" });
    expect(forced.status).toBe(201);
    expect(forced.body.data.team).toMatchObject({ teamName: "Closers", isCaptain: true, memberCount: 3 });
    expect(await AuditLogModel.countDocuments({ action: "team.captainClaimed" })).toBe(1);

    // The team's own invite code is not a side door: the contingent code is the only way in.
    const team = await TeamModel.findOne({ eventId: teamEvent._id }).lean();
    const outsider = await nextParticipant();
    const sideDoor = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      outsider.authenticationToken
    ).send({ inviteCode: team.inviteCode });
    expect(sideDoor.status).toBe(409);
  });

  it("a fourth redemption on a max-3 team code is refused", async () => {
    const { teamEvent, teamCode } = await buyTeamCode({ minimumTeamSize: 2, maximumTeamSize: 3 });
    const [first, second, third, fourth] = [
      await nextParticipant(),
      await nextParticipant(),
      await nextParticipant(),
      await nextParticipant(),
    ];
    expect((await redeem(teamCode, first)).status).toBe(201);
    expect((await redeem(teamCode, second)).status).toBe(201);
    expect((await redeem(teamCode, third, { claimCaptain: true, teamName: "Closers" })).status).toBe(201);

    const preview = await inspect(teamCode, fourth);
    expect(preview.body.data.redeemable).toBe(false);
    expect(preview.body.data.refusal.code).toBe("CONTINGENT_CODE_FULLY_CLAIMED");
    expect(preview.body.data.usage).toMatchObject({ claimCount: 3, maxUses: 3, isFull: true });

    const refused = await redeem(teamCode, fourth, { claimCaptain: true, teamName: "Latecomers" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("CONTINGENT_CODE_FULLY_CLAIMED");

    expect((await storedCodeEntry(teamCode)).claims).toHaveLength(3);
    expect(await RegistrationModel.countDocuments({ userId: fourth.user._id })).toBe(0);
    const team = await TeamModel.findOne({ eventId: teamEvent._id }).lean();
    expect(team.memberUserIds).toHaveLength(3);
    expect(team.teamName).toBe("Closers");
  });

  it("the buyer redeeming their own team code joins the same team", async () => {
    const { teamEvent, teamCode } = await buyTeamCode({ minimumTeamSize: 2, maximumTeamSize: 3 });
    const [teammate, lastTeammate] = [await nextParticipant(), await nextParticipant()];

    const buyerResponse = await redeem(teamCode, buyer, { claimCaptain: true, teamName: "Organisers" });
    expect(buyerResponse.status).toBe(201);
    expect(buyerResponse.body.data.team).toMatchObject({ isCaptain: true, teamName: "Organisers" });

    expect((await redeem(teamCode, teammate)).status).toBe(201);
    // Captain and name are already settled, so the last member is not forced into anything.
    const lastPreview = await inspect(teamCode, lastTeammate);
    expect(lastPreview.body.data.team).toMatchObject({
      fillsTeam: true,
      captainRequired: false,
      teamNameRequired: false,
    });
    const lastResponse = await redeem(teamCode, lastTeammate);
    expect(lastResponse.status).toBe(201);
    expect(lastResponse.body.data.team).toMatchObject({ isCaptain: false, memberCount: 3 });

    const teams = await TeamModel.find({ eventId: teamEvent._id }).lean();
    expect(teams).toHaveLength(1);
    expect(teams[0].memberUserIds.map(String)).toEqual([
      String(buyer.user._id),
      String(teammate.user._id),
      String(lastTeammate.user._id),
    ]);
    expect(String(teams[0].captainUserId)).toBe(String(buyer.user._id));

    const mine = await listMyCodes();
    const teamEntry = mine.body.data.purchases[0].codes.find((entry) => entry.code === teamCode);
    expect(teamEntry).toMatchObject({ claimCount: 3, isFull: true, isRedeemable: false });
    expect(teamEntry.claims[0].userId).toBe(String(buyer.user._id));
  });

  it("paid add-ons chosen on redemption create offer entitlements once paid", async () => {
    const { codeByEventId } = await buyFreeBundle([financeEvent, marketingEvent]);
    const financeCode = codeByEventId.get(String(financeEvent._id));
    const redeemer = await nextParticipant();

    const response = await redeem(financeCode, redeemer, {
      offerSelections: [{ offerKey: "djnight", scope: "fest", numberOfPeople: 2 }],
    });
    expect(response.status).toBe(201);
    // Access is already paid by the buyer; only the extras go to checkout.
    expect(response.body.data.registration.status).toBe("confirmed");
    expect(response.body.data.addOns).toMatchObject({ paid: true, amountPaise: 40000 });

    const pass = await PassModel.findOne({ userId: redeemer.user._id }).lean();
    expect(await EntitlementModel.countDocuments({ passId: pass._id, entitlementType: "offerClaim" })).toBe(0);

    const orderResponse = await withToken(
      request(application).post("/api/v1/payments/create-order"),
      redeemer.authenticationToken
    ).send({ paymentGroupId: response.body.data.addOns.paymentGroupId });
    expect(orderResponse.status).toBe(201);
    await capturePayment(orderResponse.body.data.razorpayOrderId, redeemer);

    const offerClaim = await EntitlementModel.findOne({
      passId: pass._id,
      entitlementType: "offerClaim",
      status: "active",
    }).lean();
    expect(offerClaim).not.toBeNull();
    expect(offerClaim.maximumUses).toBe(2);
    const registration = await RegistrationModel.findOne({ userId: redeemer.user._id }).lean();
    expect(registration.offerSelections.map((selection) => selection.offerKey)).toEqual(["djnight"]);
  });

  it("the buyer can redeem one of their own solo codes", async () => {
    const { codeByEventId } = await buyFreeBundle([financeEvent, marketingEvent]);
    const marketingCode = codeByEventId.get(String(marketingEvent._id));

    const response = await redeem(marketingCode, buyer);
    expect(response.status).toBe(201);
    expect(String(response.body.data.registration.userId)).toBe(String(buyer.user._id));

    const mine = await listMyCodes();
    expect(mine.status).toBe(200);
    const [purchase] = mine.body.data.purchases;
    expect(purchase.usedCodeCount).toBe(1);
    const entry = purchase.codes.find((row) => row.code === marketingCode);
    expect(entry).toMatchObject({ claimCount: 1, isFull: true, isRedeemable: false });
    expect(entry.claims[0].userId).toBe(String(buyer.user._id));
    // Still the distributor for the rest.
    expect(purchase.codes.filter((row) => row.isRedeemable)).toHaveLength(1);
  });

  it("a code for a full-capacity event is refused, stays valid, and works once a slot opens", async () => {
    const fullEvent = await createVertical("boxing", {
      capacity: 1,
      feeType: "free",
      feeAmountPaise: 0,
      // The walk-up cancels to free the seat, so this event opts in.
      allowCancellation: true,
    });
    const { codeByEventId } = await buyFreeBundle([financeEvent, fullEvent]);
    const boxingCode = codeByEventId.get(String(fullEvent._id));

    const walkUp = await nextParticipant();
    const soloResponse = await withToken(
      request(application).post(`/api/v1/events/${fullEvent.id}/registrations/solo`),
      walkUp.authenticationToken
    ).send({});
    expect(soloResponse.status).toBe(201);

    const redeemer = await nextParticipant();
    const response = await redeem(boxingCode, redeemer);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EVENT_FULL");
    expect(response.body.error.message).toBe("This event is full.");

    expect((await storedCodeEntry(boxingCode)).claims).toHaveLength(0);
    expect(await RegistrationModel.countDocuments({ userId: redeemer.user._id })).toBe(0);
    expect((await EventModel.findById(fullEvent._id)).registeredCount).toBe(1);

    // The refusal did not spend or invalidate the code.
    const stillValid = await inspect(boxingCode, redeemer);
    expect(stillValid.body.data.refusal).toMatchObject({ code: "EVENT_FULL", message: "This event is full." });
    expect(stillValid.body.data.usage).toMatchObject({ claimCount: 0, isFull: false, isExpired: false });

    // A seat opens up...
    const cancelResponse = await withToken(
      request(application).post(`/api/v1/events/${fullEvent.id}/registrations/mine/cancel`),
      walkUp.authenticationToken
    ).send({ cancellationReason: "Cannot make it to the fest after all." });
    expect(cancelResponse.status).toBe(200);
    expect((await EventModel.findById(fullEvent._id)).registeredCount).toBe(0);

    // ...and the same code now works.
    const later = await redeem(boxingCode, redeemer);
    expect(later.status).toBe(201);
    expect((await storedCodeEntry(boxingCode)).claims).toHaveLength(1);
    expect((await EventModel.findById(fullEvent._id)).registeredCount).toBe(1);
  });

  it("an unredeemed code expires when the fest ends, and extending the fest extends it", async () => {
    const { contingentId, codeByEventId } = await buyFreeBundle([financeEvent, marketingEvent]);
    const financeCode = codeByEventId.get(String(financeEvent._id));
    const redeemer = await nextParticipant();

    // The fest ends. Nothing on the code itself is touched.
    await FestModel.updateOne(
      { _id: fest._id },
      { $set: { startsOn: new Date("2020-01-01T00:00:00.000Z"), endsOn: new Date("2020-01-05T00:00:00.000Z") } }
    );

    const preview = await inspect(financeCode, redeemer);
    expect(preview.body.data.redeemable).toBe(false);
    expect(preview.body.data.refusal.code).toBe("CONTINGENT_CODE_EXPIRED");
    expect(preview.body.data.usage).toMatchObject({ isExpired: true, expiresAt: "2020-01-05T00:00:00.000Z" });

    const refused = await redeem(financeCode, redeemer);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("CONTINGENT_CODE_EXPIRED");
    expect((await storedCodeEntry(financeCode)).claims).toHaveLength(0);

    const mine = await listMyCodes();
    const entry = mine.body.data.purchases[0].codes.find((row) => row.code === financeCode);
    expect(entry).toMatchObject({ isExpired: true, isRedeemable: false });

    // Nor can codes that would be born expired be sold.
    const lateBuy = await buy(contingentId, await nextParticipant());
    expect(lateBuy.status).toBe(409);
    expect(lateBuy.body.error.code).toBe("CONTINGENT_NOT_PURCHASABLE");

    // No stored expiry: moving the fest's end moves every code's with it.
    await FestModel.updateOne(
      { _id: fest._id },
      { $set: { startsOn: new Date("2034-01-01T00:00:00.000Z"), endsOn: new Date("2035-12-31T00:00:00.000Z") } }
    );
    const extended = await redeem(financeCode, redeemer);
    expect(extended.status).toBe(201);
    expect(extended.body.data.usage).toMatchObject({ isExpired: false, expiresAt: "2035-12-31T00:00:00.000Z" });
  });

  it("old claim-based contingent purchases stay readable and keep their own purchase path", async () => {
    /*
     * A contingent from before the flag existed: written raw, so no hook adds
     * flowType and it reads back exactly as legacy data does.
     */
    const { insertedId: legacyContingentId } = await ContingentModel.collection.insertOne({
      festId: fest._id,
      parentEventId: parentEvent._id,
      contingentName: "Legacy Contingent",
      includedEventIds: [financeEvent._id, marketingEvent._id],
      pricePaise: 20000,
      individualTotalPaise: 20000,
      status: "published",
      maximumBundleClaims: null,
      soldBundleCount: 0,
      createdByUserId: admin.user._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const attendee = await nextParticipant();
    await ContingentClaimModel.create({
      contingentId: legacyContingentId,
      festId: fest._id,
      eventId: financeEvent._id,
      contingentPurchaseGroupId: "legacy-group",
      buyerUserId: buyer.user._id,
      attendeeUserId: attendee.user._id,
      attendeeEmailAddress: attendee.user.emailAddress,
      attendeeFullName: "Legacy Attendee",
      attendeePhoneNumber: "+919999999999",
      claimStatus: "invited",
      paymentStatus: "completed",
    });

    const detail = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/contingents/${legacyContingentId}`),
      admin.authenticationToken
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.contingent.flowType).toBe("claimBased");
    expect(detail.body.data.claimCountsByStatus.invited).toBe(1);

    const buyerPurchases = await withToken(
      request(application).get("/api/v1/contingent-purchases/mine"),
      buyer.authenticationToken
    );
    expect(buyerPurchases.status).toBe(200);
    expect(buyerPurchases.body.data.purchases.map((row) => row.contingentPurchaseGroupId)).toEqual([
      "legacy-group",
    ]);
    const attendeeClaims = await withToken(
      request(application).get("/api/v1/contingent-claims/mine"),
      attendee.authenticationToken
    );
    expect(attendeeClaims.status).toBe(200);
    expect(attendeeClaims.body.data.claims).toHaveLength(1);

    // Each flow refuses the other's purchase endpoint.
    const codeBuyOfLegacy = await buy(String(legacyContingentId));
    expect(codeBuyOfLegacy.status).toBe(409);
    expect(codeBuyOfLegacy.body.error.code).toBe("CONTINGENT_FLOW_MISMATCH");

    // The legacy bundle already covers finance and marketing, and published bundles may not overlap.
    const otherA = await createVertical("operations");
    const otherB = await createVertical("strategy");
    const freshBundleId = await publishBundle([otherA, otherB], 0);
    const legacyBuyOfCodeBundle = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents/${freshBundleId}/purchase`),
      buyer.authenticationToken
    ).send({
      attendees: [
        { eventId: String(otherA._id), fullName: "Named Person", emailAddress: "named@example.com", phoneNumber: "+919999999999" },
        { eventId: String(otherB._id), fullName: "Named Person", emailAddress: "named@example.com", phoneNumber: "+919999999999" },
      ],
    });
    expect(legacyBuyOfCodeBundle.status).toBe(409);
    expect(legacyBuyOfCodeBundle.body.error.code).toBe("CONTINGENT_FLOW_MISMATCH");
  });
});
