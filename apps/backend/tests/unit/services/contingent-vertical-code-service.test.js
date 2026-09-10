import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { EventModel } from "../../../src/models/event-model.js";
import { TeamModel } from "../../../src/models/team-model.js";
import { ContingentModel } from "../../../src/models/contingent-model.js";
import { ContingentClaimModel } from "../../../src/models/contingent-claim-model.js";
import { ContingentVerticalCodeModel } from "../../../src/models/contingent-vertical-code-model.js";
import verticalCodeService from "../../../src/services/contingent-vertical-code-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestParticipant,
  openRegistrationOverrides,
} from "../../setup/create-test-fixtures.js";

const PURCHASE_GROUP_ID = "contingent-purchase-group-1";

let college;
let admin;
let fest;
let parentEvent;
let financeEvent;
let operationsEvent;
let buyer;
let joiner;

beforeAll(async () => {
  await setupTestDatabase();
  await EventModel.createIndexes();
  await TeamModel.createIndexes();
  await ContingentVerticalCodeModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });

  parentEvent = await createTestEvent(fest, admin.user, {
    eventSlug: "management",
    eventName: "Management",
    ...openRegistrationOverrides(),
  });
  financeEvent = await createTestEvent(fest, admin.user, {
    eventSlug: "finance",
    eventName: "Finance",
    parentEventId: parentEvent._id,
    ...openRegistrationOverrides(),
  });
  operationsEvent = await createTestEvent(fest, admin.user, {
    eventSlug: "operations",
    eventName: "Operations",
    parentEventId: parentEvent._id,
    ...openRegistrationOverrides(),
  });

  buyer = await createTestParticipant(college, { emailAddress: "buyer@example.com" });
  joiner = await createTestParticipant(college, { emailAddress: "joiner@example.com" });
});

afterAll(async () => {
  await teardownTestDatabase();
});

/* A paid purchase: one contingent, one claim per vertical, payment captured. */
async function seedPaidPurchase({ seatsPerVertical = 1 } = {}) {
  const contingent = await ContingentModel.create({
    festId: fest._id,
    parentEventId: parentEvent._id,
    contingentName: "Chiduranga",
    includedEventIds: [financeEvent._id, operationsEvent._id],
    pricePaise: 50000,
    individualTotalPaise: 60000,
    status: "published",
    createdByUserId: admin.user._id,
  });

  for (const event of [financeEvent, operationsEvent]) {
    for (let seat = 0; seat < seatsPerVertical; seat += 1) {
      await ContingentClaimModel.create({
        contingentId: contingent._id,
        festId: fest._id,
        eventId: event._id,
        contingentPurchaseGroupId: PURCHASE_GROUP_ID,
        buyerUserId: buyer.user._id,
        attendeeUserId: buyer.user._id,
        attendeeEmailAddress: `placeholder${seat}@example.com`,
        attendeeFullName: `Placeholder ${seat}`,
        attendeePhoneNumber: "9999999999",
        claimStatus: "invited",
        paymentStatus: "completed",
      });
    }
  }
  return contingent;
}

describe("generateVerticalCodesForPurchase", () => {
  it("mints one code per vertical, sized to the seats bought", async () => {
    await seedPaidPurchase({ seatsPerVertical: 3 });

    const { generatedCount } = await verticalCodeService.generateVerticalCodesForPurchase(
      PURCHASE_GROUP_ID
    );

    expect(generatedCount).toBe(2);
    const codes = await verticalCodeService.listVerticalCodesForPurchase(PURCHASE_GROUP_ID);
    expect(codes.map((code) => code.eventName).sort()).toEqual(["Finance", "Operations"]);
    expect(codes.every((code) => code.maxClaims === 3)).toBe(true);
    expect(codes.every((code) => code.remainingSlots === 3)).toBe(true);
    // Distinct codes, not one code reused across verticals.
    expect(new Set(codes.map((code) => code.inviteCode)).size).toBe(2);
  });

  it("is idempotent — a replayed capture does not mint a second set", async () => {
    await seedPaidPurchase();
    const first = await verticalCodeService.generateVerticalCodesForPurchase(PURCHASE_GROUP_ID);
    const second = await verticalCodeService.generateVerticalCodesForPurchase(PURCHASE_GROUP_ID);

    expect(first.generatedCount).toBe(2);
    // The buyer may already have shared the first codes; they must survive.
    expect(second.generatedCount).toBe(0);
    expect((await verticalCodeService.listVerticalCodesForPurchase(PURCHASE_GROUP_ID)).length).toBe(2);
  });
});

describe("redeemVerticalCode", () => {
  async function codeFor(eventName) {
    const codes = await verticalCodeService.listVerticalCodesForPurchase(PURCHASE_GROUP_ID);
    return codes.find((code) => code.eventName === eventName);
  }

  it("joins the participant to that vertical only", async () => {
    await seedPaidPurchase();
    await verticalCodeService.generateVerticalCodesForPurchase(PURCHASE_GROUP_ID);
    const finance = await codeFor("Finance");

    const result = await verticalCodeService.redeemVerticalCode(joiner.user._id, finance.inviteCode);

    expect(result.eventId).toBe(String(financeEvent._id));
    // The redeemer takes over the seat and it is now accepted.
    const claim = await ContingentClaimModel.findOne({
      eventId: financeEvent._id,
      attendeeUserId: joiner.user._id,
    }).lean();
    expect(claim.claimStatus).toBe("accepted");
    // Operations is untouched — a code buys one vertical, not the bundle.
    const operationsClaim = await ContingentClaimModel.findOne({
      eventId: operationsEvent._id,
      attendeeUserId: joiner.user._id,
    }).lean();
    expect(operationsClaim).toBeNull();
  });

  it("rejects the same participant redeeming the same code twice", async () => {
    await seedPaidPurchase({ seatsPerVertical: 2 });
    await verticalCodeService.generateVerticalCodesForPurchase(PURCHASE_GROUP_ID);
    const finance = await codeFor("Finance");

    await verticalCodeService.redeemVerticalCode(joiner.user._id, finance.inviteCode);

    await expect(
      verticalCodeService.redeemVerticalCode(joiner.user._id, finance.inviteCode)
    ).rejects.toMatchObject({ errorCode: "CONTINGENT_CLAIM_EXISTS", statusCode: 409 });
  });

  it("rejects once the code is fully claimed, and does not leak a slot", async () => {
    await seedPaidPurchase({ seatsPerVertical: 1 });
    await verticalCodeService.generateVerticalCodesForPurchase(PURCHASE_GROUP_ID);
    const finance = await codeFor("Finance");

    await verticalCodeService.redeemVerticalCode(joiner.user._id, finance.inviteCode);

    const second = await createTestParticipant(college, { emailAddress: "second@example.com" });
    await expect(
      verticalCodeService.redeemVerticalCode(second.user._id, finance.inviteCode)
    ).rejects.toMatchObject({ errorCode: "INVITE_CODE_EXHAUSTED", statusCode: 409 });

    // The refused attempt must not have consumed the counter.
    const after = await codeFor("Finance");
    expect(after.claimedCount).toBe(1);
    expect(after.remainingSlots).toBe(0);
  });

  it("rejects an unknown code", async () => {
    await expect(
      verticalCodeService.redeemVerticalCode(joiner.user._id, "ZZZZZZZZ")
    ).rejects.toMatchObject({ errorCode: "INVITE_CODE_NOT_FOUND", statusCode: 404 });
  });
});

describe("inspectCode", () => {
  it("resolves a team code as a team, leaving the existing join flow alone", async () => {
    const team = await TeamModel.create({
      eventId: financeEvent._id,
      teamName: "Team One",
      leaderUserId: buyer.user._id,
      memberUserIds: [buyer.user._id],
      inviteCode: "TEAMCD99",
    });

    const result = await verticalCodeService.inspectCode(joiner.user._id, "teamcd99");

    expect(result.kind).toBe("team");
    expect(result.teamId).toBe(String(team._id));
  });

  it("reports availability, exhaustion and prior claims distinctly", async () => {
    await seedPaidPurchase({ seatsPerVertical: 1 });
    await verticalCodeService.generateVerticalCodesForPurchase(PURCHASE_GROUP_ID);
    const codes = await verticalCodeService.listVerticalCodesForPurchase(PURCHASE_GROUP_ID);
    const finance = codes.find((code) => code.eventName === "Finance");

    const available = await verticalCodeService.inspectCode(joiner.user._id, finance.inviteCode);
    expect(available).toMatchObject({ kind: "vertical", status: "available", remainingSlots: 1 });
    expect(available.parentEventName).toBe("Management");

    await verticalCodeService.redeemVerticalCode(joiner.user._id, finance.inviteCode);

    // The redeemer now holds it: "already joined", not "fully claimed".
    const forRedeemer = await verticalCodeService.inspectCode(joiner.user._id, finance.inviteCode);
    expect(forRedeemer.status).toBe("alreadyClaimed");

    // Somebody else sees the truthful "no slots left".
    const other = await createTestParticipant(college, { emailAddress: "other@example.com" });
    const forOther = await verticalCodeService.inspectCode(other.user._id, finance.inviteCode);
    expect(forOther.status).toBe("exhausted");
  });

  it("reports an unknown code as invalid rather than throwing", async () => {
    expect(await verticalCodeService.inspectCode(joiner.user._id, "ZZZZZZZZ")).toEqual({
      kind: "invalid",
    });
  });
});
