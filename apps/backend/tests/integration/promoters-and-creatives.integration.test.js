import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

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
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { createTestCollege, createTestAdministrator } from "../setup/create-test-fixtures.js";

installEmailServiceMock();

const DAY = 24 * 60 * 60 * 1000;

let platformAdmin;
let collegeAdmin;

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
  return {
    get: (path) => request(application).get(path).set("Authorization", `Bearer ${token}`),
    post: (path, body = {}) =>
      request(application).post(path).set("Authorization", `Bearer ${token}`).send(body),
    patch: (path, body = {}) =>
      request(application).patch(path).set("Authorization", `Bearer ${token}`).send(body),
  };
}

const owner = () => as(platformAdmin.authenticationToken);

async function createPromoter(displayName, extra = {}) {
  const response = await owner().post("/api/v1/promoters", { displayName, kind: "sponsor", ...extra });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function createCreative(promoterId, extra = {}) {
  const response = await owner().post("/api/v1/creatives", {
    promoterId,
    title: extra.title ?? "Banner",
    mediaType: "image",
    imageUrl: "https://example.com/banner.png",
    ...extra,
  });
  expect(response.status).toBe(201);
  return response.body.data;
}

/* A campaign through the phase-2 service, optionally published, running the creative. */
async function campaignRunning(promoterId, creativeId, { name = "Campaign", publish = false } = {}) {
  const campaign = await campaignService.createCampaign(platformAdmin.user._id, {
    promoterId,
    name,
    placementKeys: ["homeCarousel"],
    flightStartsAt: new Date(Date.now() - DAY),
    flightEndsAt: new Date(Date.now() + 5 * DAY),
  });
  await campaignService.attachCreative(platformAdmin.user._id, campaign._id, {
    creativeId,
    rotationWeight: 4,
  });
  if (publish) {
    await campaignService.publishCampaign(platformAdmin.user._id, campaign._id);
  }
  return campaign;
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
});

afterAll(teardownTestDatabase);

describe("promoters", () => {
  it("refuses a duplicate name, case- and whitespace-insensitively, naming the existing promoter", async () => {
    const existing = await createPromoter("Alliance University", { kind: "college" });

    const response = await owner().post("/api/v1/promoters", {
      displayName: "  alliance   UNIVERSITY ",
      kind: "sponsor",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PROMOTER_NAME_TAKEN");
    expect(response.body.error.message).toContain("Alliance University");
    expect(response.body.error.details).toMatchObject({
      existingPromoterId: existing.id,
      existingDisplayName: "Alliance University",
      existingKind: "college",
    });
    expect(await PromoterModel.countDocuments()).toBe(1);

    // Renaming onto another promoter's name is the same refusal.
    const other = await createPromoter("Acme");
    const rename = await owner().patch(`/api/v1/promoters/${other.id}`, { displayName: "alliance university" });
    expect(rename.status).toBe(409);
    expect(rename.body.error.details.existingPromoterId).toBe(existing.id);
  });

  it("refuses to archive a promoter with a published campaign, naming it", async () => {
    const promoter = await createPromoter("Acme");
    const creative = await createCreative(promoter.id);
    const live = await campaignRunning(promoter.id, creative.id, { name: "Fest week", publish: true });
    await campaignRunning(promoter.id, creative.id, { name: "Draft plan" });

    const response = await owner().post(`/api/v1/promoters/${promoter.id}/archive`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PROMOTER_HAS_PUBLISHED_CAMPAIGNS");
    expect(response.body.error.details.publishedCampaigns).toEqual([
      { id: String(live._id), name: "Fest week" },
    ]);
    expect((await PromoterModel.findById(promoter.id)).status).toBe("active");
  });

  it("archives a promoter whose campaigns are all drafts, and restores it", async () => {
    const promoter = await createPromoter("Acme");
    const creative = await createCreative(promoter.id);
    await campaignRunning(promoter.id, creative.id, { name: "Draft plan" });

    const archived = await owner().post(`/api/v1/promoters/${promoter.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("inactive");
    expect(archived.body.data.archivedAt).toBeTruthy();

    const audit = await AuditLogModel.findOne({ action: "promoter.archived" }).lean();
    expect(audit.beforeState.status).toBe("active");
    expect(audit.afterState.status).toBe("inactive");

    // An archived promoter cannot take new creatives.
    const refused = await owner().post("/api/v1/creatives", {
      promoterId: promoter.id,
      title: "Late",
      imageUrl: "https://example.com/late.png",
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("INVALID_PROMOTER_STATE");

    const restored = await owner().post(`/api/v1/promoters/${promoter.id}/restore`);
    expect(restored.body.data).toMatchObject({ status: "active", archivedAt: null });
  });

  it("lists with search, kind and status filters, paginated, and reads one with counts", async () => {
    const alliance = await createPromoter("Alliance University", { kind: "college" });
    await createPromoter("Christ University", { kind: "college" });
    const acme = await createPromoter("Acme Audio", { kind: "sponsor" });
    await createPromoter("Zeta Organisers", { kind: "festOrganiser" });
    await owner().post(`/api/v1/promoters/${acme.id}/archive`);
    const creative = await createCreative(alliance.id);
    await campaignRunning(alliance.id, creative.id, { publish: true });
    await campaignRunning(alliance.id, creative.id, { name: "Second" });

    const names = (response) => response.body.data.promoters.map((row) => row.displayName);

    const all = await owner().get("/api/v1/promoters");
    expect(all.body.data).toMatchObject({ total: 4, page: 1, limit: 50 });
    expect(names(all)).toEqual(["Acme Audio", "Alliance University", "Christ University", "Zeta Organisers"]);

    expect(names(await owner().get("/api/v1/promoters?search=univ"))).toEqual(["Alliance University", "Christ University"]);
    expect(names(await owner().get("/api/v1/promoters?kind=sponsor"))).toEqual(["Acme Audio"]);
    expect(names(await owner().get("/api/v1/promoters?status=inactive"))).toEqual(["Acme Audio"]);
    expect(names(await owner().get("/api/v1/promoters?status=active&kind=college&search=christ"))).toEqual(["Christ University"]);

    const paged = await owner().get("/api/v1/promoters?page=2&limit=3");
    expect(paged.body.data).toMatchObject({ total: 4, page: 2, limit: 3 });
    expect(names(paged)).toEqual(["Zeta Organisers"]);

    const one = await owner().get(`/api/v1/promoters/${alliance.id}`);
    expect(one.body.data).toMatchObject({
      displayName: "Alliance University",
      creativeCount: 1,
      campaignCount: 2,
      publishedCampaignCount: 1,
    });
    expect(one.body.data.displayNameKey).toBeUndefined();
  });
});

describe("creatives", () => {
  it("refuses to archive a creative a published campaign runs, naming the campaigns", async () => {
    const promoter = await createPromoter("Acme");
    const creative = await createCreative(promoter.id);
    const live = await campaignRunning(promoter.id, creative.id, { name: "Live one", publish: true });
    await campaignRunning(promoter.id, creative.id, { name: "Drafted" });

    const response = await owner().post(`/api/v1/creatives/${creative.id}/archive`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CREATIVE_IN_PUBLISHED_CAMPAIGN");
    expect(response.body.error.details.publishedCampaigns).toEqual([
      { id: String(live._id), name: "Live one" },
    ]);
    expect((await CreativeModel.findById(creative.id)).status).toBe("active");
  });

  it("archives a creative used only by drafts, refuses attaching it while archived, and restores it", async () => {
    const promoter = await createPromoter("Acme");
    const creative = await createCreative(promoter.id);
    const draft = await campaignRunning(promoter.id, creative.id, { name: "Drafted" });

    const archived = await owner().post(`/api/v1/creatives/${creative.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("archived");

    // The phase-2 attach path respects the new status.
    await expect(
      campaignService.attachCreative(platformAdmin.user._id, draft._id, { creativeId: creative.id })
    ).rejects.toMatchObject({ errorCode: "INVALID_CREATIVE_STATE" });

    const restored = await owner().post(`/api/v1/creatives/${creative.id}/restore`);
    expect(restored.body.data).toMatchObject({ status: "active", archivedAt: null });
  });

  it("requires a poster image on a NEW video creative", async () => {
    const promoter = await createPromoter("Acme");

    const response = await owner().post("/api/v1/creatives", {
      promoterId: promoter.id,
      title: "Clip",
      mediaType: "video",
      videoUrl: "https://example.com/clip.mp4",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.details.imageUrl).toMatch(/poster/);
  });

  it("still allows editing a video creative that predates the poster rule", async () => {
    /*
     * THE REGRESSION THIS PINS. creative-model guards its poster rule with
     * `this.isNew` precisely so the rule binds creation and leaves rows saved
     * before it existed editable. The validator alongside it was checking the
     * same rule unconditionally and is reached on the update path too, so a
     * legacy video creative without a poster could not be saved again at all -
     * an admin merely renaming it got a 400 about an image they never had.
     *
     * The row is written through the model with validation bypassed, because
     * that is the only way to produce the shape this is about: a row the
     * current rules would refuse to create but which exists in the database.
     */
    const promoter = await createPromoter("Acme");
    const legacy = await CreativeModel.collection.insertOne({
      promoterId: new mongoose.Types.ObjectId(String(promoter.id)),
      title: "Old clip",
      mediaType: "video",
      imageUrl: null,
      videoUrl: "https://example.com/old.mp4",
      linkUrl: null,
      description: null,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await owner().patch(`/api/v1/creatives/${legacy.insertedId}`, {
      title: "Old clip, renamed",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe("Old clip, renamed");
  });

  it("refuses a media kind that does not match the media supplied", async () => {
    const promoter = await createPromoter("Acme");

    const videoWithoutVideo = await owner().post("/api/v1/creatives", {
      promoterId: promoter.id,
      title: "Clip",
      mediaType: "video",
      imageUrl: "https://example.com/poster.png",
    });
    expect(videoWithoutVideo.status).toBe(400);
    expect(videoWithoutVideo.body.error.details.videoUrl).toMatch(/required/);

    const imageWithVideo = await owner().post("/api/v1/creatives", {
      promoterId: promoter.id,
      title: "Still",
      mediaType: "image",
      imageUrl: "https://example.com/still.png",
      videoUrl: "https://example.com/clip.mp4",
    });
    expect(imageWithVideo.status).toBe(400);
    expect(imageWithVideo.body.error.details.videoUrl).toMatch(/empty/);

    // The same rule on the MERGED row at update: flipping to video without a videoUrl.
    const creative = await createCreative(promoter.id);
    const flipped = await owner().patch(`/api/v1/creatives/${creative.id}`, { mediaType: "video" });
    expect(flipped.status).toBe(400);
    expect(flipped.body.error.details.videoUrl).toMatch(/required/);
    expect(await CreativeModel.countDocuments()).toBe(1);
  });

  it("records the previous media in the audit entry when a served creative is edited", async () => {
    const promoter = await createPromoter("Acme");
    const creative = await createCreative(promoter.id, { imageUrl: "https://example.com/v1.png" });
    const live = await campaignRunning(promoter.id, creative.id, { name: "Live one", publish: true });

    const response = await owner().patch(`/api/v1/creatives/${creative.id}`, {
      imageUrl: "https://example.com/v2.png",
      title: "Banner v2",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.imageUrl).toBe("https://example.com/v2.png");
    const audit = await AuditLogModel.findOne({ action: "creative.updated" }).lean();
    expect(audit.beforeState).toMatchObject({
      imageUrl: "https://example.com/v1.png",
      title: "Banner",
      mediaType: "image",
    });
    expect(audit.afterState).toMatchObject({ imageUrl: "https://example.com/v2.png", title: "Banner v2" });
    expect(audit.afterState.servingCampaigns).toEqual([{ id: String(live._id), name: "Live one" }]);
  });

  it("lists by promoter with media kind and in-use filters, and reads one with its campaigns", async () => {
    const promoter = await createPromoter("Acme");
    const other = await createPromoter("Other");
    const used = await createCreative(promoter.id, { title: "Used image" });
    const idle = await createCreative(promoter.id, { title: "Idle image" });
    const clip = await createCreative(promoter.id, {
      title: "Clip",
      mediaType: "video",
      videoUrl: "https://example.com/clip.mp4",
      imageUrl: "https://example.com/poster.png",
    });
    await createCreative(other.id, { title: "Theirs" });
    const campaign = await campaignRunning(promoter.id, used.id, { name: "Runs it", publish: true });

    const titles = (response) => response.body.data.creatives.map((row) => row.title).sort();

    const all = await owner().get(`/api/v1/creatives?promoterId=${promoter.id}`);
    expect(all.body.data.total).toBe(3);
    expect(titles(all)).toEqual(["Clip", "Idle image", "Used image"]);
    expect(titles(await owner().get(`/api/v1/creatives?promoterId=${promoter.id}&mediaType=video`))).toEqual(["Clip"]);
    expect(titles(await owner().get(`/api/v1/creatives?promoterId=${promoter.id}&inUse=true`))).toEqual(["Used image"]);
    expect(titles(await owner().get(`/api/v1/creatives?promoterId=${promoter.id}&inUse=false`))).toEqual(["Clip", "Idle image"]);
    expect(titles(await owner().get(`/api/v1/creatives?promoterId=${promoter.id}&inUse=false&mediaType=image`))).toEqual(["Idle image"]);
    expect((await owner().get("/api/v1/creatives")).status).toBe(400);
    expect(idle.title).toBe("Idle image");

    const one = await owner().get(`/api/v1/creatives/${used.id}`);
    expect(one.body.data.campaigns).toEqual([
      {
        campaignId: String(campaign._id),
        campaignName: "Runs it",
        campaignStatus: "published",
        rotationWeight: 4,
        isActive: true,
      },
    ]);
    expect(clip.mediaType).toBe("video");
  });
});

describe("authorization", () => {
  it("refuses every endpoint for a college administrator and allows it for the platform admin", async () => {
    const promoter = await createPromoter("Acme");
    const creative = await createCreative(promoter.id);
    const college = as(collegeAdmin.authenticationToken);

    const attempts = [
      college.get("/api/v1/promoters"),
      college.post("/api/v1/promoters", { displayName: "Sneaky", kind: "sponsor" }),
      college.get(`/api/v1/promoters/${promoter.id}`),
      college.patch(`/api/v1/promoters/${promoter.id}`, { displayName: "Renamed" }),
      college.post(`/api/v1/promoters/${promoter.id}/archive`),
      college.post(`/api/v1/promoters/${promoter.id}/restore`),
      college.get(`/api/v1/creatives?promoterId=${promoter.id}`),
      college.post("/api/v1/creatives", { promoterId: promoter.id, title: "X", imageUrl: "https://example.com/x.png" }),
      college.get(`/api/v1/creatives/${creative.id}`),
      college.patch(`/api/v1/creatives/${creative.id}`, { title: "Y" }),
      college.post(`/api/v1/creatives/${creative.id}/archive`),
      college.post(`/api/v1/creatives/${creative.id}/restore`),
    ];
    for (const attempt of attempts) {
      expect((await attempt).status).toBe(403);
    }
    expect(await PromoterModel.countDocuments()).toBe(1);
    expect((await PromoterModel.findById(promoter.id)).displayName).toBe("Acme");

    const unauthenticated = await request(application).get("/api/v1/promoters");
    expect(unauthenticated.status).toBe(401);

    expect((await owner().get("/api/v1/promoters")).status).toBe(200);
    expect((await owner().patch(`/api/v1/promoters/${promoter.id}`, { contactName: "Sam" })).status).toBe(200);
    expect((await owner().patch(`/api/v1/creatives/${creative.id}`, { title: "Y" })).status).toBe(200);
  });
});

describe("list counts", () => {
  it("match the read-one counts exactly, hold across a page boundary, and are zeroes for an empty promoter", async () => {
    // Five promoters; the first three get creatives and campaigns, the last two nothing.
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"];
    const rows = [];
    for (const name of names) {
      rows.push(await createPromoter(name));
    }
    const [alpha, bravo, charlie] = rows;
    const alphaArt = await createCreative(alpha.id, { title: "A1" });
    await createCreative(alpha.id, { title: "A2" });
    await campaignRunning(alpha.id, alphaArt.id, { name: "A live", publish: true });
    await campaignRunning(alpha.id, alphaArt.id, { name: "A draft" });
    const bravoArt = await createCreative(bravo.id, { title: "B1" });
    await campaignRunning(bravo.id, bravoArt.id, { name: "B draft" });
    await createCreative(charlie.id, { title: "C1" });

    // Page size 2: Alpha/Bravo, then Charlie/Delta, then Echo. Sorted by name.
    const pageOne = await owner().get("/api/v1/promoters?limit=2&page=1");
    const pageTwo = await owner().get("/api/v1/promoters?limit=2&page=2");
    const pageThree = await owner().get("/api/v1/promoters?limit=2&page=3");
    const listed = [...pageOne.body.data.promoters, ...pageTwo.body.data.promoters, ...pageThree.body.data.promoters];
    expect(listed.map((row) => row.displayName)).toEqual(names);

    for (const row of listed) {
      const detail = (await owner().get(`/api/v1/promoters/${row.id}`)).body.data;
      expect({
        creativeCount: row.creativeCount,
        campaignCount: row.campaignCount,
        publishedCampaignCount: row.publishedCampaignCount,
      }).toEqual({
        creativeCount: detail.creativeCount,
        campaignCount: detail.campaignCount,
        publishedCampaignCount: detail.publishedCampaignCount,
      });
    }
    expect(listed[0]).toMatchObject({ displayName: "Alpha", creativeCount: 2, campaignCount: 2, publishedCampaignCount: 1 });
    expect(listed[1]).toMatchObject({ displayName: "Bravo", creativeCount: 1, campaignCount: 1, publishedCampaignCount: 0 });
    expect(listed[2]).toMatchObject({ displayName: "Charlie", creativeCount: 1, campaignCount: 0, publishedCampaignCount: 0 });
    // Nothing at all: zeroes, present as keys.
    expect(listed[3]).toMatchObject({ displayName: "Delta", creativeCount: 0, campaignCount: 0, publishedCampaignCount: 0 });
    expect(Object.keys(listed[4])).toEqual(expect.arrayContaining(["creativeCount", "campaignCount", "publishedCampaignCount"]));
    expect(listed[4]).toMatchObject({ creativeCount: 0, campaignCount: 0, publishedCampaignCount: 0 });
  });
});
