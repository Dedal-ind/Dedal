import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

import { application } from "../../src/application.js";
import { PromoterModel } from "../../src/models/promoter-model.js";
import { CreativeModel } from "../../src/models/creative-model.js";
import { CampaignModel } from "../../src/models/campaign-model.js";
import { CampaignCreativeModel } from "../../src/models/campaign-creative-model.js";
import { PlacementModel } from "../../src/models/placement-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import campaignService from "../../src/services/campaign-service.js";
import decisionEngine from "../../src/services/decision-engine-service.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { createTestCollege, createTestAdministrator, createTestUser } from "../setup/create-test-fixtures.js";

installEmailServiceMock();

const DAY = 24 * 60 * 60 * 1000;
const HOME = "homeCarousel";

let platformAdmin;
let collegeAdmin;
let promoter;
let adult;

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

function as(token) {
  const bearer = (pending) => pending.set("Authorization", `Bearer ${token}`);
  return {
    get: (path) => bearer(request(application).get(path)),
    post: (path, body = {}) => bearer(request(application).post(path)).send(body),
    patch: (path, body = {}) => bearer(request(application).patch(path)).send(body),
    delete: (path) => bearer(request(application).delete(path)),
  };
}
const owner = () => as(platformAdmin.authenticationToken);

const flight = (startOffsetDays = -1, endOffsetDays = 5) => ({
  flightStartsAt: new Date(Date.now() + startOffsetDays * DAY).toISOString(),
  flightEndsAt: new Date(Date.now() + endOffsetDays * DAY).toISOString(),
});

async function createCreative(extra = {}) {
  return CreativeModel.create({
    promoterId: promoter._id,
    title: extra.title ?? "Art",
    mediaType: "image",
    imageUrl: "https://example.com/art.png",
    ...extra,
  });
}

async function createCampaign(overrides = {}) {
  const response = await owner().post("/api/v1/campaigns", {
    promoterId: String(promoter._id),
    name: "Campaign",
    placementKeys: [HOME],
    ...flight(),
    ...overrides,
  });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function attach(campaignId, creativeId, extra = {}) {
  return owner().post(`/api/v1/campaigns/${campaignId}/creatives`, { creativeId: String(creativeId), ...extra });
}

/* A published campaign with one attached creative, through the endpoints. */
async function publishedCampaign(overrides = {}) {
  const campaign = await createCampaign(overrides);
  const creative = await createCreative();
  expect((await attach(campaign.id, creative._id)).status).toBe(200);
  const published = await owner().post(`/api/v1/campaigns/${campaign.id}/publish`);
  expect(published.status).toBe(200);
  return { campaign: published.body.data, creative };
}

async function eligibleNames(now = new Date()) {
  const subject = decisionEngine.resolveSubject(adult, null);
  const eligible = await decisionEngine.listEligibleCampaigns({ placementKey: HOME, user: adult, subject, now });
  return eligible.map((entry) => entry.campaign.name).sort();
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PromoterModel.createIndexes(),
    CreativeModel.createIndexes(),
    CampaignModel.createIndexes(),
    CampaignCreativeModel.createIndexes(),
    PlacementModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  await campaignService.ensurePlacements();
  platformAdmin = await createTestPlatformAdmin();
  const college = await createTestCollege({ isVerified: true });
  collegeAdmin = await createTestAdministrator(college);
  promoter = await PromoterModel.create({ displayName: "Acme", kind: "sponsor" });
  adult = await createTestUser({ emailAddress: "adult@example.com", dateOfBirth: new Date(Date.UTC(1995, 0, 1)) });
});

afterAll(teardownTestDatabase);

describe("pause and resume", () => {
  it("stops eligibility immediately on pause and restores it on resume, keeping the flight", async () => {
    const { campaign } = await publishedCampaign({ name: "Live" });
    expect(await eligibleNames()).toEqual(["Live"]);

    const paused = await owner().post(`/api/v1/campaigns/${campaign.id}/pause`);
    expect(paused.status).toBe(200);
    expect(paused.body.data.status).toBe("paused");
    expect(paused.body.data.pausedAt).toBeTruthy();
    expect(paused.body.data.flightEndsAt).toBe(campaign.flightEndsAt);
    expect(await eligibleNames()).toEqual([]);
    expect(await AuditLogModel.countDocuments({ action: "campaign.paused" })).toBe(1);

    // Publish is not the way back; resume is.
    expect((await owner().post(`/api/v1/campaigns/${campaign.id}/publish`)).status).toBe(409);
    const resumed = await owner().post(`/api/v1/campaigns/${campaign.id}/resume`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.data).toMatchObject({ status: "published", pausedAt: null });
    expect(await eligibleNames()).toEqual(["Live"]);
    expect(await AuditLogModel.countDocuments({ action: "campaign.resumed" })).toBe(1);
  });

  it("re-runs the publish guards on resume", async () => {
    const { campaign, creative } = await publishedCampaign({ name: "Live" });
    await owner().post(`/api/v1/campaigns/${campaign.id}/pause`);
    // While paused, the only creative was pulled — allowed, the campaign is not serving.
    expect((await owner().delete(`/api/v1/campaigns/${campaign.id}/creatives/${creative._id}`)).status).toBe(200);

    const resumed = await owner().post(`/api/v1/campaigns/${campaign.id}/resume`);
    expect(resumed.status).toBe(409);
    expect(resumed.body.error.code).toBe("CAMPAIGN_NOT_PUBLISHABLE");
    expect((await CampaignModel.findById(campaign.id)).status).toBe("paused");
  });
});

describe("editing a published campaign", () => {
  it("refuses promoter, a passed flight start, and an earlier flight end; names each", async () => {
    const { campaign } = await publishedCampaign();
    const other = await PromoterModel.create({ displayName: "Other", kind: "sponsor" });

    const response = await owner().patch(`/api/v1/campaigns/${campaign.id}`, {
      promoterId: String(other._id),
      flightStartsAt: new Date(Date.now() - 2 * DAY).toISOString(),
      flightEndsAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CAMPAIGN_EDIT_REFUSED_WHILE_LIVE");
    expect(Object.keys(response.body.error.details).sort()).toEqual(["flightEndsAt", "flightStartsAt", "promoterId"]);
    const stored = await CampaignModel.findById(campaign.id).lean();
    expect(String(stored.promoterId)).toBe(String(promoter._id));
    expect(stored.flightStartsAt.toISOString()).toBe(campaign.flightStartsAt);
    expect(stored.flightEndsAt.toISOString()).toBe(campaign.flightEndsAt);
  });

  it("allows caps and name freely, a later flight end, and audits tuning fields loudly", async () => {
    const { campaign } = await publishedCampaign();
    const laterEnd = new Date(Date.now() + 20 * DAY).toISOString();

    const quiet = await owner().patch(`/api/v1/campaigns/${campaign.id}`, {
      name: "Renamed",
      frequencyCap: { maxPerDay: 2, maxPerFlight: 6 },
      flightEndsAt: laterEnd,
    });
    expect(quiet.status).toBe(200);
    expect(quiet.body.data).toMatchObject({ name: "Renamed", frequencyCap: { maxPerDay: 2, maxPerFlight: 6 }, flightEndsAt: laterEnd });
    expect(await AuditLogModel.countDocuments({ action: "campaign.updated" })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: "campaign.retunedLive" })).toBe(0);

    const loud = await owner().patch(`/api/v1/campaigns/${campaign.id}`, {
      priorityTier: 1,
      weight: 5,
      placementKeys: [HOME, "passScreen"],
      pacing: { totalImpressionTarget: 1000 },
      targeting: { include: { cities: ["Bengaluru"] } },
    });
    expect(loud.status).toBe(200);
    const audit = await AuditLogModel.findOne({ action: "campaign.retunedLive" }).lean();
    expect(audit.afterState.liveRetunedFields.sort()).toEqual(["pacing", "placementKeys", "priorityTier", "targeting", "weight"]);
    expect(audit.beforeState).toMatchObject({ priorityTier: 2, weight: 1, placementKeys: [HOME] });
    expect(audit.afterState).toMatchObject({ priorityTier: 1, weight: 5 });
    expect(audit.afterState.targeting.include.cities).toEqual(["Bengaluru"]);

    // A draft takes the same fields quietly, promoter included.
    const draft = await createCampaign({ name: "Draft" });
    const other = await PromoterModel.create({ displayName: "Other", kind: "sponsor" });
    const moved = await owner().patch(`/api/v1/campaigns/${draft.id}`, {
      promoterId: String(other._id),
      flightStartsAt: new Date(Date.now() + DAY).toISOString(),
      priorityTier: 3,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.data.promoterId).toBe(String(other._id));
    expect(await AuditLogModel.countDocuments({ action: "campaign.retunedLive" })).toBe(1);
  });
});

describe("creative associations", () => {
  it("refuses detaching or pausing the last active association on a published campaign, allows it on a draft", async () => {
    const { campaign, creative } = await publishedCampaign();

    const detach = await owner().delete(`/api/v1/campaigns/${campaign.id}/creatives/${creative._id}`);
    expect(detach.status).toBe(409);
    expect(detach.body.error.code).toBe("CAMPAIGN_LAST_ACTIVE_CREATIVE");
    const pause = await owner().patch(`/api/v1/campaigns/${campaign.id}/creatives/${creative._id}`, { isActive: false });
    expect(pause.status).toBe(409);
    expect(pause.body.error.code).toBe("CAMPAIGN_LAST_ACTIVE_CREATIVE");
    expect(await CampaignCreativeModel.countDocuments({ campaignId: campaign.id, isActive: true })).toBe(1);

    const draft = await createCampaign({ name: "Draft" });
    const draftCreative = await createCreative();
    await attach(draft.id, draftCreative._id);
    expect((await owner().delete(`/api/v1/campaigns/${draft.id}/creatives/${draftCreative._id}`)).status).toBe(200);
    expect(await CampaignCreativeModel.countDocuments({ campaignId: draft.id })).toBe(0);
    expect(await AuditLogModel.countDocuments({ action: "campaign.creativeDetached" })).toBe(1);
  });

  it("pauses one association while the others keep serving, and changes a weight", async () => {
    const { campaign, creative: first } = await publishedCampaign({ name: "Live" });
    const second = await createCreative({ title: "Second" });
    await attach(campaign.id, second._id, { rotationWeight: 3 });

    const paused = await owner().patch(`/api/v1/campaigns/${campaign.id}/creatives/${first._id}`, { isActive: false });
    expect(paused.status).toBe(200);
    expect(paused.body.data).toMatchObject({ isActive: false });
    expect(await eligibleNames()).toEqual(["Live"]);
    const subject = decisionEngine.resolveSubject(adult, null);
    const [entry] = await decisionEngine.listEligibleCampaigns({ placementKey: HOME, user: adult, subject });
    expect(entry.associations.map((row) => String(row.creativeId))).toEqual([String(second._id)]);

    const reweighted = await owner().patch(`/api/v1/campaigns/${campaign.id}/creatives/${second._id}`, { rotationWeight: 9 });
    expect(reweighted.body.data.rotationWeight).toBe(9);
    const audit = await AuditLogModel.findOne({ action: "campaign.creativeUpdated", "afterState.rotationWeight": 9 }).lean();
    expect(audit.beforeState.rotationWeight).toBe(3);

    // Now the second is the last active one: it cannot be pulled either.
    expect((await owner().patch(`/api/v1/campaigns/${campaign.id}/creatives/${second._id}`, { isActive: false })).status).toBe(409);
  });

  it("refuses a cross-promoter creative and an archived one", async () => {
    const campaign = await createCampaign();
    const other = await PromoterModel.create({ displayName: "Other", kind: "sponsor" });
    const foreign = await CreativeModel.create({ promoterId: other._id, title: "Theirs", imageUrl: "https://example.com/t.png" });
    const archived = await createCreative({ status: "archived" });

    const crossPromoter = await attach(campaign.id, foreign._id);
    expect(crossPromoter.status).toBe(409);
    expect(crossPromoter.body.error.code).toBe("CREATIVE_PROMOTER_MISMATCH");
    const archivedAttach = await attach(campaign.id, archived._id);
    expect(archivedAttach.status).toBe(409);
    expect(archivedAttach.body.error.code).toBe("INVALID_CREATIVE_STATE");
    expect(await CampaignCreativeModel.countDocuments({ campaignId: campaign.id })).toBe(0);
  });
});

describe("validation and lifecycle", () => {
  it("refuses a flight cap below a day cap, a flight ending before it starts, and a bad tier", async () => {
    const capped = await owner().post("/api/v1/campaigns", {
      promoterId: String(promoter._id),
      name: "Capped",
      ...flight(),
      frequencyCap: { maxPerDay: 5, maxPerFlight: 3 },
    });
    expect(capped.status).toBe(400);
    expect(capped.body.error.details["frequencyCap.maxPerFlight"]).toMatch(/not be lower/);

    const backwards = await owner().post("/api/v1/campaigns", {
      promoterId: String(promoter._id),
      name: "Backwards",
      ...flight(5, -1),
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.details.flightEndsAt).toMatch(/after/);

    const tier = await owner().post("/api/v1/campaigns", { promoterId: String(promoter._id), name: "T", ...flight(), priorityTier: 9 });
    expect(tier.status).toBe(400);
    expect(tier.body.error.details.priorityTier).toBeTruthy();

    const weight = await owner().post("/api/v1/campaigns", { promoterId: String(promoter._id), name: "W", ...flight(), weight: 0 });
    expect(weight.status).toBe(400);

    const targeting = await owner().post("/api/v1/campaigns", {
      promoterId: String(promoter._id),
      name: "X",
      ...flight(),
      targeting: { include: { interests: ["music"] } },
    });
    expect(targeting.status).toBe(400);
    expect(targeting.body.error.details["targeting.include"]).toMatch(/interests/);
    expect(await CampaignModel.countDocuments()).toBe(0);
  });

  it("deletes a draft and refuses to delete once published", async () => {
    const draft = await createCampaign({ name: "Draft" });
    expect((await owner().delete(`/api/v1/campaigns/${draft.id}`)).status).toBe(200);
    expect(await CampaignModel.findById(draft.id)).toBeNull();

    const { campaign } = await publishedCampaign();
    const refused = await owner().delete(`/api/v1/campaigns/${campaign.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("INVALID_CAMPAIGN_STATE");
    await owner().post(`/api/v1/campaigns/${campaign.id}/archive`);
    expect((await owner().delete(`/api/v1/campaigns/${campaign.id}`)).status).toBe(409);
  });

  it("filters live, upcoming and ended correctly across the boundary, and reads one fully expanded", async () => {
    const { campaign: live, creative } = await publishedCampaign({ name: "Live" });
    await createCampaign({ name: "Upcoming", ...flight(1, 5) });
    const endedRow = await createCampaign({ name: "Ended", ...flight(-10, -5) });
    // Exactly at the boundary: a flight that ends right now is ended, one that starts right now is live.
    const now = Date.now();
    await CampaignModel.updateOne({ _id: endedRow.id }, { $set: { flightEndsAt: new Date(now) } });
    await CampaignModel.updateOne({ _id: live.id }, { $set: { flightStartsAt: new Date(now) } });

    const names = (response) => response.body.data.campaigns.map((row) => row.name).sort();
    expect(names(await owner().get("/api/v1/campaigns?flight=live"))).toEqual(["Live"]);
    expect(names(await owner().get("/api/v1/campaigns?flight=upcoming"))).toEqual(["Upcoming"]);
    expect(names(await owner().get("/api/v1/campaigns?flight=ended"))).toEqual(["Ended"]);
    expect(names(await owner().get("/api/v1/campaigns?status=published"))).toEqual(["Live"]);
    expect(names(await owner().get(`/api/v1/campaigns?placementKey=${HOME}&status=draft`))).toEqual(["Ended", "Upcoming"]);
    expect(names(await owner().get(`/api/v1/campaigns?promoterId=${promoter._id}`))).toEqual(["Ended", "Live", "Upcoming"]);
    const paged = await owner().get("/api/v1/campaigns?limit=2&page=2");
    expect(paged.body.data).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(paged.body.data.campaigns).toHaveLength(1);
    expect(paged.body.data.campaigns[0].promoter).toMatchObject({ displayName: "Acme", kind: "sponsor" });

    const one = await owner().get(`/api/v1/campaigns/${live.id}`);
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({
      name: "Live",
      status: "published",
      flightState: "live",
      priorityTier: 2,
      weight: 1,
      promoter: { displayName: "Acme", kind: "sponsor" },
      placements: [{ key: HOME, isActive: true, maxPublishedCampaigns: 20 }],
      delivery: null,
    });
    expect(one.body.data.creatives).toEqual([
      expect.objectContaining({ creativeId: String(creative._id), rotationWeight: 1, isActive: true, title: "Art" }),
    ]);
    expect(one.body.data.targeting.include.cities).toEqual([]);
  });

  it("is platform-admin only", async () => {
    const { campaign, creative } = await publishedCampaign();
    const college = as(collegeAdmin.authenticationToken);
    const attempts = [
      college.get("/api/v1/campaigns"),
      college.post("/api/v1/campaigns", { promoterId: String(promoter._id), name: "X", ...flight() }),
      college.get(`/api/v1/campaigns/${campaign.id}`),
      college.patch(`/api/v1/campaigns/${campaign.id}`, { name: "Y" }),
      college.post(`/api/v1/campaigns/${campaign.id}/pause`),
      college.post(`/api/v1/campaigns/${campaign.id}/resume`),
      college.post(`/api/v1/campaigns/${campaign.id}/archive`),
      college.delete(`/api/v1/campaigns/${campaign.id}`),
      college.post(`/api/v1/campaigns/${campaign.id}/creatives`, { creativeId: String(creative._id) }),
      college.patch(`/api/v1/campaigns/${campaign.id}/creatives/${creative._id}`, { rotationWeight: 2 }),
      college.delete(`/api/v1/campaigns/${campaign.id}/creatives/${creative._id}`),
    ];
    for (const attempt of attempts) {
      expect((await attempt).status).toBe(403);
    }
    expect((await CampaignModel.findById(campaign.id)).status).toBe("published");
    expect((await request(application).get("/api/v1/campaigns")).status).toBe(401);
  });
});
