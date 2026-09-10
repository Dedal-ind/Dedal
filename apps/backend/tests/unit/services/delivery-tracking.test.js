import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

import { application } from "../../../src/application.js";
import { PlacementModel } from "../../../src/models/placement-model.js";
import { CampaignModel } from "../../../src/models/campaign-model.js";
import { CampaignCreativeModel } from "../../../src/models/campaign-creative-model.js";
import { DecisionTokenModel } from "../../../src/models/decision-token-model.js";
import { DeliveryEventModel } from "../../../src/models/delivery-event-model.js";
import { DeliveryReceiptModel } from "../../../src/models/delivery-receipt-model.js";
import {
  DeliveryDailyRollupModel,
  DeliveryRollupStateModel,
  DeliveryRejectionModel,
} from "../../../src/models/delivery-rollup-model.js";
import {
  DailyCapLedgerModel,
  FlightCapLedgerModel,
} from "../../../src/models/frequency-cap-ledger-model.js";
import campaignService from "../../../src/services/campaign-service.js";
import decisionEngine from "../../../src/services/decision-engine-service.js";
import deliveryService from "../../../src/services/delivery-service.js";
import { runDeliveryRollup } from "../../../src/services/delivery-rollup-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestParticipant,
  createTestUser,
} from "../../setup/create-test-fixtures.js";

const DAY = 24 * 60 * 60 * 1000;
const HOME = "homeCarousel";

let admin;
let sponsor;
let college;
let adult;
let adultToken;

beforeAll(async () => {
  await setupTestDatabase();
  await deliveryService.ensureEventStore();
  await Promise.all([
    PlacementModel.createIndexes(),
    CampaignModel.createIndexes(),
    CampaignCreativeModel.createIndexes(),
    DecisionTokenModel.createIndexes(),
    DeliveryReceiptModel.createIndexes(),
    DeliveryDailyRollupModel.createIndexes(),
    DeliveryRejectionModel.createIndexes(),
    DailyCapLedgerModel.createIndexes(),
    FlightCapLedgerModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  await campaignService.ensurePlacements();
  admin = await createTestUser({ emailAddress: "owner@example.com" });
  sponsor = await campaignService.createPromoter(admin._id, { displayName: "Acme", kind: "sponsor" });
  college = await createTestCollege({ isVerified: true });
  const participant = await createTestParticipant(college, {
    dateOfBirth: new Date(Date.UTC(1995, 0, 1)),
  });
  adult = participant.user;
  adultToken = participant.authenticationToken;
});

afterAll(teardownTestDatabase);

async function liveCampaign(overrides = {}) {
  const campaign = await campaignService.createCampaign(admin._id, {
    promoterId: sponsor._id,
    name: overrides.name ?? "Campaign",
    placementKeys: [HOME],
    flightStartsAt: new Date(Date.now() - DAY),
    flightEndsAt: new Date(Date.now() + 5 * DAY),
    ...overrides,
  });
  const creative = await campaignService.createCreative(admin._id, {
    promoterId: sponsor._id,
    title: "Art",
    imageUrl: "https://example.com/art.png",
  });
  await campaignService.attachCreative(admin._id, campaign._id, { creativeId: creative._id });
  return campaignService.publishCampaign(admin._id, campaign._id);
}

/* A decision for the adult, minted `agoMs` in the past so viewables are plausible. */
async function decisionFor(user = adult, agoMs = 5000) {
  const now = new Date(Date.now() - agoMs);
  const result = await decisionEngine.decide({ placementKey: HOME, user, now });
  expect(result.fill).toBe(true);
  return result.decision;
}

function post(events, headers = {}) {
  let pending = request(application)
    .post("/api/v1/delivery/events")
    .set("Authorization", `Bearer ${adultToken}`);
  for (const [name, value] of Object.entries(headers)) {
    pending = pending.set(name, value);
  }
  return pending.send({ events });
}

async function eventsOfKind(kind) {
  return DeliveryEventModel.find({ "meta.kind": kind }).lean();
}

describe("the event store", () => {
  it("is a time-series collection with the grouping fields as metadata and a TTL", async () => {
    const [info] = await mongoose.connection.db
      .listCollections({ name: "deliveryEvents" })
      .toArray();
    expect(info.type).toBe("timeseries");
    expect(info.options.timeseries).toMatchObject({ timeField: "at", metaField: "meta", granularity: "hours" });
    expect(info.options.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });
});

describe("ingest takes everything from the stored token", () => {
  it("records against the token's campaign and subject even when the body names different ones", async () => {
    const shown = await liveCampaign({ name: "shown" });
    const other = await liveCampaign({ name: "other", placementKeys: ["passScreen"] });
    const decision = await decisionFor();
    const decoyCreative = new mongoose.Types.ObjectId();

    const response = await post([
      {
        token: decision.token,
        kind: "viewable",
        // Everything below is a lie the server must ignore.
        campaignId: String(other._id),
        creativeId: String(decoyCreative),
        placementKey: "passScreen",
        subjectKey: "session:somebody-else",
      },
    ]);

    expect(response.status).toBe(200);
    expect(response.body.data.outcomes).toEqual([
      { status: "recorded", campaignId: String(shown._id), creativeId: decision.creative.id, placementKey: HOME },
    ]);

    const [viewable] = await eventsOfKind("viewable");
    expect(String(viewable.meta.campaignId)).toBe(String(shown._id));
    expect(String(viewable.meta.creativeId)).toBe(decision.creative.id);
    expect(viewable.meta.placementKey).toBe(HOME);

    // The cap ledger is keyed to the TOKEN's subject: the adult's own id.
    const ledgerRows = await DailyCapLedgerModel.find().lean();
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].subjectKey).toBe(`user:${adult._id}`);
    expect(String(ledgerRows[0].campaignId)).toBe(String(shown._id));
    expect(await DailyCapLedgerModel.countDocuments({ subjectKey: "session:somebody-else" })).toBe(0);
  });

  it("rejects an unknown token and an expired one, and counts each rejection", async () => {
    await liveCampaign();
    const decision = await decisionFor();
    await DecisionTokenModel.updateOne(
      { token: decision.token },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );

    const response = await post([
      { token: "never-minted", kind: "viewable" },
      { token: decision.token, kind: "viewable" },
    ]);

    expect(response.body.data.outcomes).toEqual([
      { status: "rejected", reason: "tokenInvalid" },
      { status: "rejected", reason: "tokenInvalid" },
    ]);
    expect(await eventsOfKind("viewable")).toHaveLength(0);
    const rejection = await DeliveryRejectionModel.findOne({ reason: "tokenInvalid" }).lean();
    expect(rejection.count).toBe(2);
  });
});

describe("once per token per kind", () => {
  it("ignores a second viewable for one token without inflating anything", async () => {
    const campaign = await liveCampaign();
    const decision = await decisionFor();

    const first = await post([{ token: decision.token, kind: "viewable" }]);
    const second = await post([{ token: decision.token, kind: "viewable" }]);

    expect(first.body.data.outcomes[0].status).toBe("recorded");
    expect(second.body.data.outcomes[0]).toEqual({ status: "duplicate" });
    expect(await eventsOfKind("viewable")).toHaveLength(1);
    expect(await DeliveryReceiptModel.countDocuments({ token: decision.token, kind: "viewable" })).toBe(1);
    const daily = await DailyCapLedgerModel.findOne({ campaignId: campaign._id }).lean();
    expect(daily.count).toBe(1);
    const flight = await FlightCapLedgerModel.findOne({ campaignId: campaign._id }).lean();
    expect(flight.count).toBe(1);
    // A different kind on the same token is a different event, and is recorded.
    const click = await post([{ token: decision.token, kind: "click" }]);
    expect(click.body.data.outcomes[0].status).toBe("recorded");
  });

  it("produces exactly one row from concurrent duplicate viewables", async () => {
    const campaign = await liveCampaign();
    const decision = await decisionFor();

    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        deliveryService.ingestEvents([{ token: decision.token, kind: "viewable" }])
      )
    );

    const statuses = outcomes.map((batch) => batch[0].status);
    expect(statuses.filter((status) => status === "recorded")).toHaveLength(1);
    expect(statuses.filter((status) => status === "duplicate")).toHaveLength(11);
    expect(await eventsOfKind("viewable")).toHaveLength(1);
    expect((await DailyCapLedgerModel.findOne({ campaignId: campaign._id }).lean()).count).toBe(1);
  });
});

describe("batches", () => {
  it("records the good events of a batch that contains a bad one", async () => {
    await liveCampaign();
    const decision = await decisionFor();

    const response = await post([
      { token: decision.token, kind: "measurable" },
      { token: "bogus", kind: "viewable" },
      { token: decision.token, kind: "nonsense" },
      { token: decision.token, kind: "viewable" },
    ]);

    expect(response.status).toBe(200);
    expect(response.body.data.outcomes.map((outcome) => outcome.status)).toEqual([
      "recorded",
      "rejected",
      "rejected",
      "recorded",
    ]);
    expect(response.body.data.outcomes[2].reason).toBe("kindInvalid");
    expect(await eventsOfKind("measurable")).toHaveLength(1);
    expect(await eventsOfKind("viewable")).toHaveLength(1);
  });

  it("refuses a whole batch from a crawler, counting every event", async () => {
    await liveCampaign();
    const decision = await decisionFor();
    const response = await post(
      [{ token: decision.token, kind: "measurable" }, { token: decision.token, kind: "viewable" }],
      { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }
    );
    expect(response.body.data.outcomes.every((outcome) => outcome.reason === "crawlerUserAgent")).toBe(true);
    expect(await eventsOfKind("viewable")).toHaveLength(0);
    expect((await DeliveryRejectionModel.findOne({ reason: "crawlerUserAgent" }).lean()).count).toBe(2);
  });
});

describe("what touches the cap ledgers", () => {
  it("a viewable increments both ledgers; a decision, a measurable and a click increment neither", async () => {
    const campaign = await liveCampaign();
    const decision = await decisionFor();
    // The engine has already written the decision event.
    expect(await eventsOfKind("decision")).toHaveLength(1);
    expect(await DailyCapLedgerModel.countDocuments()).toBe(0);
    expect(await FlightCapLedgerModel.countDocuments()).toBe(0);

    await post([{ token: decision.token, kind: "measurable" }, { token: decision.token, kind: "click" }]);
    expect(await DailyCapLedgerModel.countDocuments()).toBe(0);
    expect(await FlightCapLedgerModel.countDocuments()).toBe(0);

    await post([{ token: decision.token, kind: "viewable" }]);
    expect((await DailyCapLedgerModel.findOne({ campaignId: campaign._id }).lean()).count).toBe(1);
    expect((await FlightCapLedgerModel.findOne({ campaignId: campaign._id }).lean()).count).toBe(1);
  });
});

describe("invalid traffic", () => {
  it("rejects a viewable that claims to precede its decision, and one implausibly soon after it", async () => {
    await liveCampaign();
    const decision = await decisionFor(adult, 0);
    const tokenRow = await DecisionTokenModel.findOne({ token: decision.token }).lean();

    const response = await post([
      { token: decision.token, kind: "viewable", occurredAt: new Date(tokenRow.decidedAt.getTime() - 1000).toISOString() },
      { token: decision.token, kind: "viewable", occurredAt: new Date(tokenRow.decidedAt.getTime() + 50).toISOString() },
    ]);

    expect(response.body.data.outcomes).toEqual([
      { status: "rejected", reason: "viewableBeforeDecision" },
      { status: "rejected", reason: "implausibleGap" },
    ]);
    expect(await eventsOfKind("viewable")).toHaveLength(0);
    expect((await DeliveryRejectionModel.findOne({ reason: "viewableBeforeDecision" }).lean()).count).toBe(1);
    expect((await DeliveryRejectionModel.findOne({ reason: "implausibleGap" }).lean()).count).toBe(1);
  });
});

describe("the rollup job", () => {
  it("is idempotent across re-runs, handles a day with no events, and alone moves the pacing counter", async () => {
    const campaign = await liveCampaign({ pacing: { totalImpressionTarget: 100 } });
    const first = await decisionFor();
    const second = await decisionFor();
    await post([
      { token: first.token, kind: "measurable" },
      { token: first.token, kind: "viewable" },
      { token: second.token, kind: "measurable" },
      { token: second.token, kind: "viewable" },
      { token: second.token, kind: "click" },
    ]);

    // Nothing on the request path moved the pacing counter.
    expect((await CampaignModel.findById(campaign._id).lean()).pacing.deliveredImpressions).toBe(0);

    const now = new Date();
    const run1 = await runDeliveryRollup({ now });
    expect(run1).toMatchObject({ daysRolled: 1, rowsWritten: 1, campaignsRefreshed: 1 });

    const rollup = await DeliveryDailyRollupModel.findOne({ campaignId: campaign._id }).lean();
    expect(String(rollup.creativeId)).toBe(first.creative.id);
    expect(rollup).toMatchObject({
      placementKey: HOME,
      decision: 2,
      measurable: 2,
      viewable: 2,
      click: 1,
    });
    expect((await CampaignModel.findById(campaign._id).lean()).pacing.deliveredImpressions).toBe(2);

    // Re-run over the same day: same numbers, same single row, counter unchanged.
    const run2 = await runDeliveryRollup({ now });
    expect(run2).toMatchObject({ daysRolled: 1, rowsWritten: 1 });
    expect(await DeliveryDailyRollupModel.countDocuments()).toBe(1);
    const again = await DeliveryDailyRollupModel.findOne({ campaignId: campaign._id }).lean();
    expect(again).toMatchObject({ decision: 2, measurable: 2, viewable: 2, click: 1 });
    expect((await CampaignModel.findById(campaign._id).lean()).pacing.deliveredImpressions).toBe(2);

    // Two days on: today was still OPEN at the last run, so it is recomputed
    // once more (same numbers), then the two empty days write nothing and
    // the cursor advances to yesterday-of-that-run.
    const twoDaysOn = new Date(now.getTime() + 2 * DAY);
    const run3 = await runDeliveryRollup({ now: twoDaysOn });
    expect(run3).toMatchObject({ daysRolled: 3, rowsWritten: 1 });
    expect(run3.completedThroughDay).toBe(new Date(twoDaysOn.getTime() - DAY).toISOString().slice(0, 10));
    expect(await DeliveryDailyRollupModel.countDocuments()).toBe(1);
    expect(await DeliveryDailyRollupModel.findOne({ campaignId: campaign._id }).lean()).toMatchObject({
      decision: 2, measurable: 2, viewable: 2, click: 1,
    });
    expect((await CampaignModel.findById(campaign._id).lean()).pacing.deliveredImpressions).toBe(2);
    const state = await DeliveryRollupStateModel.findById("deliveryRollup").lean();
    expect(state.completedThroughDay).toBe(run3.completedThroughDay);

    // Three days on: the previously open (empty) day plus the new one, both
    // empty — nothing written.
    const run4 = await runDeliveryRollup({ now: new Date(now.getTime() + 3 * DAY) });
    expect(run4).toMatchObject({ daysRolled: 2, rowsWritten: 0 });
    expect(await DeliveryDailyRollupModel.countDocuments()).toBe(1);

    // An empty store from a fresh state: also fine.
    await clearAllCollections();
    const empty = await runDeliveryRollup({ now });
    expect(empty).toMatchObject({ daysRolled: 1, rowsWritten: 0, campaignsRefreshed: 0 });
  });
});
