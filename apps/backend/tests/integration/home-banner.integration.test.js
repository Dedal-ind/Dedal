import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { PromotionModel } from "../../src/models/promotion-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * The home banner: a platform admin chooses automatic, or an ordered list of up
 * to five fests and promotions; participants read the resolved slides without
 * signing in, and anything unpublished or ended drops out.
 */

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
  return createAuthenticationToken({ id: user.id, emailAddress: user.emailAddress });
}

const DAY_MS = 24 * 60 * 60 * 1000;

let college;
let administrator;
let platformToken;

async function publishedFest(name, overrides = {}) {
  const fest = await createTestFest(college, administrator.user, {
    festName: name,
    festSlug: name.toLowerCase().replace(/\s+/g, "-"),
    startsOn: new Date(Date.now() + DAY_MS),
    endsOn: new Date(Date.now() + 3 * DAY_MS),
    ...overrides,
  });
  await FestModel.updateOne({ _id: fest._id }, { $set: { status: "published" } });
  return fest;
}

async function promotion(title, status = "published") {
  return PromotionModel.create({
    title,
    promotionType: "commercial",
    mediaType: "video",
    videoUrl: `https://cdn.example.com/${title}.mp4`,
    status,
    publishedAt: status === "published" ? new Date() : null,
    createdByUserId: administrator.user._id,
  });
}

function saveBanner(body, token = platformToken) {
  return request(application)
    .put("/api/v1/home-banner")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  administrator = await createTestAdministrator(college);
  platformToken = await createTestPlatformAdmin();
});

describe("home banner", () => {
  it("is automatic with no slides before anyone configures it", async () => {
    const response = await request(application).get("/api/v1/public/home-banner");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ mode: "automatic", slides: [] });
  });

  it("returns a curated mix of fests and promotions in the saved order, publicly", async () => {
    const fest = await publishedFest("Nexaris");
    const video = await promotion("Onam vibes");

    const saved = await saveBanner({
      mode: "curated",
      slides: [
        { kind: "promotion", id: video.id },
        { kind: "fest", id: fest.id },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.slides.map((slide) => slide.title)).toEqual(["Onam vibes", "Nexaris"]);

    const response = await request(application).get("/api/v1/public/home-banner");
    expect(response.status).toBe(200);
    expect(response.body.data.mode).toBe("curated");
    expect(response.body.data.slides[0].kind).toBe("promotion");
    expect(response.body.data.slides[0].promotion.videoUrl).toBe("https://cdn.example.com/Onam vibes.mp4");
    expect(response.body.data.slides[0].promotion.createdByUserId).toBeUndefined();
    expect(response.body.data.slides[1].kind).toBe("fest");
    expect(response.body.data.slides[1].fest.festSlug).toBe("nexaris");
  });

  it("refuses more than five slides", async () => {
    const promotions = await Promise.all(["a", "b", "c", "d", "e", "f"].map((title) => promotion(title)));
    const response = await saveBanner({
      mode: "curated",
      slides: promotions.map((row) => ({ kind: "promotion", id: row.id })),
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a draft promotion, an ended fest, a duplicate, and an empty curated banner", async () => {
    const draft = await promotion("Draft", "draft");
    const ended = await publishedFest("Old fest", {
      startsOn: new Date(Date.now() - 5 * DAY_MS),
      endsOn: new Date(Date.now() - 2 * DAY_MS),
    });
    const live = await promotion("Live");

    const refused = await saveBanner({
      mode: "curated",
      slides: [
        { kind: "promotion", id: draft.id },
        { kind: "fest", id: ended.id },
        { kind: "promotion", id: live.id },
        { kind: "promotion", id: live.id },
      ],
    });
    expect(refused.status).toBe(400);
    expect(Object.keys(refused.body.error.details)).toEqual(
      expect.arrayContaining(["slides.0", "slides.1", "slides.3"])
    );

    const empty = await saveBanner({ mode: "curated", slides: [] });
    expect(empty.status).toBe(400);
  });

  it("drops slides that were unpublished after saving, and falls back to automatic when none remain", async () => {
    const video = await promotion("Soon archived");
    await saveBanner({ mode: "curated", slides: [{ kind: "promotion", id: video.id }] });

    await PromotionModel.updateOne({ _id: video._id }, { $set: { status: "archived" } });

    const response = await request(application).get("/api/v1/public/home-banner");
    expect(response.body.data).toEqual({ mode: "automatic", slides: [] });

    const adminView = await request(application)
      .get("/api/v1/home-banner")
      .set("Authorization", `Bearer ${platformToken}`);
    expect(adminView.body.data.slides[0]).toMatchObject({ title: "Soon archived", isShowable: false });
  });

  it("keeps the saved slides when switched back to automatic", async () => {
    const video = await promotion("Kept");
    await saveBanner({ mode: "curated", slides: [{ kind: "promotion", id: video.id }] });
    const automatic = await saveBanner({ mode: "automatic", slides: [{ kind: "promotion", id: video.id }] });
    expect(automatic.status).toBe(200);
    expect(automatic.body.data.mode).toBe("automatic");

    const response = await request(application).get("/api/v1/public/home-banner");
    expect(response.body.data).toEqual({ mode: "automatic", slides: [] });
  });

  it("is platform-admin only to read or change", async () => {
    const asCollegeAdmin = await saveBanner({ mode: "automatic" }, administrator.authenticationToken);
    expect(asCollegeAdmin.status).toBe(403);

    const unauthenticated = await request(application).get("/api/v1/home-banner");
    expect(unauthenticated.status).toBe(401);
  });
});
