import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

import { application } from "../../src/application.js";
import { PromoterModel } from "../../src/models/promoter-model.js";
import { CreativeModel } from "../../src/models/creative-model.js";
import { CampaignModel } from "../../src/models/campaign-model.js";
import { PlacementModel } from "../../src/models/placement-model.js";
import {
  DeliveryDailyRollupModel,
  DeliveryRollupStateModel,
  DeliveryRejectionModel,
} from "../../src/models/delivery-rollup-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import campaignService from "../../src/services/campaign-service.js";
import reporting from "../../src/services/delivery-reporting-service.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { createTestCollege, createTestAdministrator } from "../setup/create-test-fixtures.js";

installEmailServiceMock();

const DAY = 24 * 60 * 60 * 1000;
const HOME = "homeCarousel";
const PASS = "passScreen";

let platformAdmin;
let collegeAdmin;
let promoter;

async function createTestPlatformAdmin() {
  const user = await UserModel.create({
    emailAddress: "platform-owner@example.com",
    fullName: "Platform Owner",
    isProfileComplete: true,
  });
  await StaffAssignmentModel.create({
    userId: user._id,
    collegeId: null,
    festId: null,
    role: "platformAdmin",
    status: "active",
    assignedByUserId: user._id,
  });
  return {
    user,
    authenticationToken: createAuthenticationToken({ id: user.id, emailAddress: user.emailAddress }),
  };
}

const get = (path, token = platformAdmin.authenticationToken) =>
  request(application).get(path).set("Authorization", `Bearer ${token}`);

const dayOf = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function campaign(overrides = {}) {
  return CampaignModel.create({
    promoterId: promoter._id,
    name: overrides.name ?? "Campaign",
    status: "published",
    placementKeys: [HOME],
    flightStartsAt: new Date(Date.now() - 10 * DAY),
    flightEndsAt: new Date(Date.now() + 10 * DAY),
    ...overrides,
  });
}

async function creative(title = "Art") {
  return CreativeModel.create({ promoterId: promoter._id, title, imageUrl: "https://example.com/a.png" });
}

/* A rollup row, written the way the job writes them. */
async function rollup({ campaignId, creativeId, placementKey = HOME, day, decision = 0, measurable = 0, viewable = 0, click = 0 }) {
  return DeliveryDailyRollupModel.create({
    campaignId,
    creativeId,
    placementKey,
    day,
    decision,
    measurable,
    viewable,
    click,
    rolledUpAt: new Date(),
  });
}

async function completedThrough(day) {
  await DeliveryRollupStateModel.updateOne(
    { _id: "deliveryRollup" },
    { $set: { completedThroughDay: day, lastRunAt: new Date() } },
    { upsert: true }
  );
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PromoterModel.createIndexes(),
    CampaignModel.createIndexes(),
    PlacementModel.createIndexes(),
    DeliveryDailyRollupModel.createIndexes(),
    DeliveryRejectionModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  await campaignService.ensurePlacements();
  platformAdmin = await createTestPlatformAdmin();
  const college = await createTestCollege({ isVerified: true });
  collegeAdmin = await createTestAdministrator(college);
  promoter = await PromoterModel.create({ displayName: "Acme", kind: "sponsor" });
});

afterAll(teardownTestDatabase);

describe("empty ranges", () => {
  it("every read returns zeroes, not absent keys, and a full per-day series", async () => {
    const row = await campaign();
    await completedThrough(dayOf(-1));
    const range = `from=${dayOf(-3)}&to=${dayOf(-1)}`;
    const zero = { decision: 0, measurable: 0, viewable: 0, click: 0 };

    const platform = await get(`/api/v1/reports/delivery/platform?${range}`);
    expect(platform.status).toBe(200);
    expect(platform.headers["cache-control"]).toBeUndefined();
    expect(platform.body.data.totals).toEqual(zero);
    expect(platform.body.data.perDay).toHaveLength(3);
    expect(platform.body.data.perDay.every((day) => day.decision === 0 && day.viewable === 0)).toBe(true);
    expect(platform.body.data.rates.viewableRate).toEqual({ numerator: 0, denominator: 0, rate: 0, of: "viewable / measurable" });
    expect(platform.body.data.rejections).toMatchObject({ total: 0, byReason: [] });
    expect(platform.body.data.perPlacement).toHaveLength(4);

    const campaignReport = await get(`/api/v1/reports/delivery/campaigns/${row._id}?${range}`);
    expect(campaignReport.body.data.totals).toEqual(zero);
    expect(campaignReport.body.data.pacing.status).toBe("noGoal");
    const creatives = await get(`/api/v1/reports/delivery/campaigns/${row._id}/creatives?${range}`);
    expect(creatives.body.data).toMatchObject({ totals: zero, perCreative: [] });
    const placement = await get(`/api/v1/reports/delivery/placements/${HOME}?${range}`);
    expect(placement.body.data).toMatchObject({ totals: zero, perCampaign: [] });
    const summary = await get(`/api/v1/reports/delivery/promoters/${promoter._id}?${range}`);
    expect(summary.body.data.totals).toEqual(zero);
    expect(summary.body.data.campaigns[0]).toMatchObject({ campaignId: String(row._id), ...zero });
  });
});

describe("rates", () => {
  it("computes the viewable rate over measurables, never over decisions", async () => {
    const row = await campaign();
    const art = await creative();
    await rollup({ campaignId: row._id, creativeId: art._id, day: dayOf(-1), decision: 100, measurable: 40, viewable: 20, click: 5 });
    await completedThrough(dayOf(-1));

    const response = await get(`/api/v1/reports/delivery/platform?from=${dayOf(-1)}&to=${dayOf(-1)}`);
    const { rates, totals } = response.body.data;
    expect(totals).toEqual({ decision: 100, measurable: 40, viewable: 20, click: 5 });
    expect(rates.viewableRate).toEqual({ numerator: 20, denominator: 40, rate: 0.5, of: "viewable / measurable" });
    expect(rates.measurableRate).toEqual({ numerator: 40, denominator: 100, rate: 0.4, of: "measurable / decision" });
    expect(rates.clickRate).toEqual({ numerator: 5, denominator: 20, rate: 0.25, of: "click / viewable" });
    // The four figures are never summed into an "impressions" total.
    expect(Object.keys(totals).sort()).toEqual(["click", "decision", "measurable", "viewable"]);
  });
});

describe("coverage honesty", () => {
  it("reports the last completed rollup point and flags a range that runs past it", async () => {
    await completedThrough(dayOf(-1));
    const past = await get(`/api/v1/reports/delivery/platform?from=${dayOf(-5)}&to=${dayOf(-1)}`);
    expect(past.body.data.coverage).toMatchObject({
      from: dayOf(-5),
      to: dayOf(-1),
      days: 5,
      lastCompletedRollupDay: dayOf(-1),
      isComplete: true,
      source: "dailyRollups",
    });
    const running = await get(`/api/v1/reports/delivery/platform?from=${dayOf(-5)}&to=${dayOf(0)}`);
    expect(running.body.data.coverage).toMatchObject({ lastCompletedRollupDay: dayOf(-1), isComplete: false });
    expect(running.body.data.coverage.note).toMatch(/not evidence of low delivery/);

    // No rollup has ever run: honestly incomplete, never a crash.
    await DeliveryRollupStateModel.deleteMany({});
    const never = await get(`/api/v1/reports/delivery/platform?from=${dayOf(-5)}&to=${dayOf(-1)}`);
    expect(never.body.data.coverage).toMatchObject({ lastCompletedRollupDay: null, isComplete: false });
  });

  it("still reports a range that predates raw event retention, from rollups alone", async () => {
    const row = await campaign({ flightStartsAt: new Date(Date.now() - 120 * DAY), flightEndsAt: new Date(Date.now() - 80 * DAY) });
    const art = await creative();
    // Ninety days back: far outside the thirty-day raw window. No raw events exist at all.
    await rollup({ campaignId: row._id, creativeId: art._id, day: dayOf(-90), decision: 10, measurable: 8, viewable: 6, click: 1 });
    await completedThrough(dayOf(-1));

    const response = await get(`/api/v1/reports/delivery/campaigns/${row._id}?from=${dayOf(-91)}&to=${dayOf(-89)}`);
    expect(response.status).toBe(200);
    expect(response.body.data.totals).toEqual({ decision: 10, measurable: 8, viewable: 6, click: 1 });
    expect(response.body.data.coverage.source).toBe("dailyRollups");
  });
});

describe("breakdowns add up", () => {
  it("per-creative figures sum to the campaign figure, and per-placement to the platform figure", async () => {
    const row = await campaign({ placementKeys: [HOME, PASS] });
    const other = await campaign({ name: "Other", placementKeys: [PASS] });
    const [artA, artB, artC] = await Promise.all([creative("A"), creative("B"), creative("C")]);
    await rollup({ campaignId: row._id, creativeId: artA._id, placementKey: HOME, day: dayOf(-2), decision: 30, measurable: 20, viewable: 10, click: 2 });
    await rollup({ campaignId: row._id, creativeId: artB._id, placementKey: HOME, day: dayOf(-2), decision: 15, measurable: 10, viewable: 5, click: 1 });
    await rollup({ campaignId: row._id, creativeId: artB._id, placementKey: PASS, day: dayOf(-1), decision: 5, measurable: 5, viewable: 4, click: 0 });
    await rollup({ campaignId: other._id, creativeId: artC._id, placementKey: PASS, day: dayOf(-1), decision: 7, measurable: 7, viewable: 7, click: 3 });
    await completedThrough(dayOf(-1));
    const range = `from=${dayOf(-2)}&to=${dayOf(-1)}`;

    const campaignReport = await get(`/api/v1/reports/delivery/campaigns/${row._id}?${range}`);
    const creatives = await get(`/api/v1/reports/delivery/campaigns/${row._id}/creatives?${range}`);
    const sum = (rows, kind) => rows.reduce((total, item) => total + item[kind], 0);
    for (const kind of ["decision", "measurable", "viewable", "click"]) {
      expect(sum(creatives.body.data.perCreative, kind)).toBe(campaignReport.body.data.totals[kind]);
    }
    expect(campaignReport.body.data.totals).toEqual({ decision: 50, measurable: 35, viewable: 19, click: 3 });
    expect(creatives.body.data.perCreative.map((item) => item.title)).toEqual(["A", "B"]);
    expect(creatives.body.data.perCreative[1]).toMatchObject({ title: "B", decision: 20, viewable: 9 });

    const platform = await get(`/api/v1/reports/delivery/platform?${range}`);
    const home = await get(`/api/v1/reports/delivery/placements/${HOME}?${range}`);
    const pass = await get(`/api/v1/reports/delivery/placements/${PASS}?${range}`);
    for (const kind of ["decision", "measurable", "viewable", "click"]) {
      expect(home.body.data.totals[kind] + pass.body.data.totals[kind]).toBe(platform.body.data.totals[kind]);
      expect(sum(platform.body.data.perPlacement, kind)).toBe(platform.body.data.totals[kind]);
    }
    expect(pass.body.data.perCampaign.map((item) => item.name)).toEqual(["Other", "Campaign"]);
    expect(platform.body.data.perDay.find((day) => day.day === dayOf(-2))).toMatchObject({ decision: 45, viewable: 15 });

    const summary = await get(`/api/v1/reports/delivery/promoters/${promoter._id}?${range}`);
    expect(summary.body.data.totals).toEqual(platform.body.data.totals);
    expect(summary.body.data.campaigns).toHaveLength(2);
  });
});

describe("pacing", () => {
  it("reports ahead and behind correctly at a known point in the flight", () => {
    const now = new Date("2026-09-11T00:00:00.000Z");
    const base = {
      flightStartsAt: new Date("2026-09-01T00:00:00.000Z"),
      flightEndsAt: new Date("2026-09-21T00:00:00.000Z"), // day 10 of 20: half elapsed
    };
    const ahead = reporting.pacingFor({ ...base, pacing: { totalImpressionTarget: 1000, deliveredImpressions: 700 } }, now);
    expect(ahead).toMatchObject({ hasGoal: true, target: 1000, delivered: 700, elapsedShare: 0.5, expectedDelivered: 500, difference: 200, status: "ahead" });
    const behind = reporting.pacingFor({ ...base, pacing: { totalImpressionTarget: 1000, deliveredImpressions: 300 } }, now);
    expect(behind).toMatchObject({ expectedDelivered: 500, difference: -200, status: "behind" });
    const onPace = reporting.pacingFor({ ...base, pacing: { totalImpressionTarget: 1000, deliveredImpressions: 500 } }, now);
    expect(onPace.status).toBe("onPace");
    const noGoal = reporting.pacingFor({ ...base, pacing: { deliveredImpressions: 5 } }, now);
    expect(noGoal).toMatchObject({ hasGoal: false, status: "noGoal", delivered: 5 });
  });

  it("carries pacing on the campaign report and the promoter summary", async () => {
    const row = await campaign({ pacing: { totalImpressionTarget: 100, deliveredImpressions: 80 } });
    await completedThrough(dayOf(-1));
    const report = await get(`/api/v1/reports/delivery/campaigns/${row._id}`);
    expect(report.body.data.pacing).toMatchObject({ hasGoal: true, target: 100, delivered: 80, status: "ahead" });
    const summary = await get(`/api/v1/reports/delivery/promoters/${promoter._id}`);
    expect(summary.body.data.campaigns[0].pacing.status).toBe("ahead");
  });
});

describe("range rules", () => {
  it("refuses an inverted range and an over-long one, defaults to thirty days", async () => {
    const inverted = await get(`/api/v1/reports/delivery/platform?from=${dayOf(-1)}&to=${dayOf(-5)}`);
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.details.from).toMatch(/after/);
    const long = await get(`/api/v1/reports/delivery/platform?from=${dayOf(-200)}&to=${dayOf(0)}`);
    expect(long.status).toBe(400);
    expect(long.body.error.details.to).toMatch(/92 days/);
    const bad = await get("/api/v1/reports/delivery/platform?from=yesterday");
    expect(bad.status).toBe(400);
    const defaulted = await get("/api/v1/reports/delivery/platform");
    expect(defaulted.body.data.coverage).toMatchObject({ from: dayOf(-29), to: dayOf(0), days: 30 });
    expect((await get(`/api/v1/reports/delivery/placements/nowhere`)).status).toBe(400);
    expect((await get(`/api/v1/reports/delivery/campaigns/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
  });
});

describe("rejections in the overview", () => {
  it("surfaces rejection counts per reason, at the granularity they are stored", async () => {
    await DeliveryRejectionModel.create({ day: dayOf(-1), reason: "tokenInvalid", count: 3 });
    await DeliveryRejectionModel.create({ day: dayOf(-1), reason: "crawlerUserAgent", count: 2 });
    await DeliveryRejectionModel.create({ day: dayOf(-9), reason: "tokenInvalid", count: 9 });
    const response = await get(`/api/v1/reports/delivery/platform?from=${dayOf(-2)}&to=${dayOf(-1)}`);
    expect(response.body.data.rejections).toMatchObject({
      total: 5,
      byReason: [{ reason: "crawlerUserAgent", count: 2 }, { reason: "tokenInvalid", count: 3 }],
    });
    expect(response.body.data.rejections.granularity).toMatch(/never per campaign/);
  });
});

describe("authorization", () => {
  it("refuses every report for a college administrator", async () => {
    const row = await campaign();
    const paths = [
      "/api/v1/reports/delivery/platform",
      `/api/v1/reports/delivery/campaigns/${row._id}`,
      `/api/v1/reports/delivery/campaigns/${row._id}/creatives`,
      `/api/v1/reports/delivery/placements/${HOME}`,
      `/api/v1/reports/delivery/promoters/${promoter._id}`,
    ];
    for (const path of paths) {
      expect((await get(path, collegeAdmin.authenticationToken)).status).toBe(403);
      expect((await request(application).get(path)).status).toBe(401);
      expect((await get(path)).status).toBe(200);
    }
  });
});
