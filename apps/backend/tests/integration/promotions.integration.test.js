import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { PromotionModel } from "../../src/models/promotion-model.js";
import { MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE } from "../../src/services/promotion-service.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestParticipant,
} from "../setup/create-test-fixtures.js";

/*
 * The platform owner: a staff assignment scoped to NEITHER a college nor a
 * fest — it is not "of" anything, it is over everything. No fixture builds one,
 * so it is assembled here the same way the college-application suite does.
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
  return {
    user,
    authenticationToken: createAuthenticationToken({
      id: user.id,
      emailAddress: user.emailAddress,
    }),
  };
}

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * Home-screen promotions: platform-admin CRUD over BOTH types (commercial
 * banners and college-event promotions), and the unauthenticated read the
 * participant app makes before anyone signs in.
 */
let college;
let platformAdmin;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

async function createDraft(title, extra = {}) {
  const isCollegeEvent = extra.promotionType === "collegeEvent";
  const response = await withToken(
    request(application).post("/api/v1/promotions"),
    platformAdmin.authenticationToken
  ).send({
    title,
    promotionType: "commercial",
    imageUrl: `https://cdn.example.com/${title}.jpg`,
    // A college event needs a promoting college; give one unless the case
    // under test is supplying (or withholding) its own.
    ...(isCollegeEvent && extra.collegeName === undefined
      ? { collegeName: "Christ University" }
      : {}),
    ...extra,
  });
  return response.body.data;
}

async function publish(promotion) {
  return withToken(
    request(application).post(`/api/v1/promotions/${promotion.id}/publish`),
    platformAdmin.authenticationToken
  );
}

// The public read returns both types keyed by type — one request, two arrays.
async function readPublished() {
  const response = await request(application).get("/api/v1/public/promotions");
  expect(response.status).toBe(200);
  return response.body.data;
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  platformAdmin = await createTestPlatformAdmin();
});

describe("promotion types", () => {
  it("(a) a published commercial promotion appears under the commercial array", async () => {
    const promotion = await createDraft("sponsor-banner", { promotionType: "commercial" });
    expect(promotion.promotionType).toBe("commercial");
    // A commercial promotion carries no college, whatever the payload said.
    expect(promotion.collegeName).toBeNull();

    expect((await readPublished()).commercial).toHaveLength(0); // still a draft
    expect((await publish(promotion)).status).toBe(200);

    const published = await readPublished();
    expect(published.commercial.map((row) => row.title)).toEqual(["sponsor-banner"]);
    expect(published.collegeEvent).toEqual([]);
  });

  it("(b) a published college event appears under the collegeEvent array, with its college", async () => {
    const promotion = await createDraft("techfest-2026", {
      promotionType: "collegeEvent",
      collegeName: "Christ University",
      description: "Three days of robotics, music and code.",
    });
    expect((await publish(promotion)).status).toBe(200);

    const published = await readPublished();
    expect(published.commercial).toEqual([]);
    expect(published.collegeEvent).toHaveLength(1);
    expect(published.collegeEvent[0].collegeName).toBe("Christ University");
    expect(published.collegeEvent[0].description).toBe("Three days of robotics, music and code.");
  });

  it("a college event without a college name is refused", async () => {
    const refused = await withToken(
      request(application).post("/api/v1/promotions"),
      platformAdmin.authenticationToken
    ).send({
      title: "anonymous-fest",
      promotionType: "collegeEvent",
      imageUrl: "https://cdn.example.com/x.jpg",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("the public payload leaks no admin metadata and is cached", async () => {
    await publish(await createDraft("public-shape", { promotionType: "commercial" }));

    const response = await request(application).get("/api/v1/public/promotions");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");

    const [row] = response.body.data.commercial;
    // Exactly the participant-facing whitelist — nothing more.
    expect(Object.keys(row).sort()).toEqual(
      [
        "collegeName",
        "description",
        "displayOrder",
        "id",
        "imageUrl",
        "linkUrl",
        // Display data, like imageUrl: the carousel cannot render a video
        // promotion without knowing it is one and where the file is.
        "mediaType",
        "videoUrl",
        "promotionType",
        "title",
      ].sort()
    );
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain("createdByUserId");
    expect(serialised).not.toContain("publishedAt");
    expect(serialised).not.toContain("status");
  });
});

describe("promotion lifecycle", () => {
  it("drafts publish into display order within their own type", async () => {
    const second = await createDraft("second", { displayOrder: 1 });
    const first = await createDraft("first", { displayOrder: 0 });
    expect(first.status).toBe("draft");

    for (const promotion of [second, first]) {
      expect((await publish(promotion)).status).toBe(200);
    }
    expect((await readPublished()).commercial.map((row) => row.title)).toEqual(["first", "second"]);
  });

  it("archiving removes it from the public list", async () => {
    const promotion = await createDraft("to-archive");
    await publish(promotion);
    expect((await readPublished()).commercial).toHaveLength(1);

    const archived = await withToken(
      request(application).post(`/api/v1/promotions/${promotion.id}/archive`),
      platformAdmin.authenticationToken
    );
    expect(archived.status).toBe(200);
    expect((await readPublished()).commercial).toHaveLength(0);
  });

  it("(e) a published promotion cannot be deleted; a draft can", async () => {
    const published = await createDraft("published-one");
    await publish(published);
    const refused = await withToken(
      request(application).delete(`/api/v1/promotions/${published.id}`),
      platformAdmin.authenticationToken
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("INVALID_PROMOTION_STATE");
    expect(await PromotionModel.countDocuments({ _id: published.id })).toBe(1);

    const draft = await createDraft("draft-one");
    const deleted = await withToken(
      request(application).delete(`/api/v1/promotions/${draft.id}`),
      platformAdmin.authenticationToken
    );
    expect(deleted.status).toBe(200);
    expect(await PromotionModel.countDocuments({ _id: draft.id })).toBe(0);
  });

  it("the type cannot be changed after creation", async () => {
    const promotion = await createDraft("stays-commercial");
    const updated = await withToken(
      request(application).patch(`/api/v1/promotions/${promotion.id}`),
      platformAdmin.authenticationToken
    ).send({ promotionType: "collegeEvent", collegeName: "Somewhere" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.promotionType).toBe("commercial");
    // collegeName is dropped too: it is meaningless on a commercial row.
    expect(updated.body.data.collegeName).toBeNull();
  });
});

describe("the publish cap is per type, not shared", () => {
  it("(c) the 21st commercial publish is refused", async () => {
    for (let index = 0; index < MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE; index += 1) {
      await publish(await createDraft(`capped-${index}`));
    }
    const overflow = await createDraft("one-too-many");
    const refused = await publish(overflow);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PROMOTION_PUBLISH_LIMIT_REACHED");
    expect((await readPublished()).commercial).toHaveLength(
      MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE
    );
  });

  it("a full commercial section does not block a college event", async () => {
    for (let index = 0; index < MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE; index += 1) {
      await publish(await createDraft(`capped-${index}`));
    }
    // 20 commercial are already published. Under a 20-TOTAL cap this would be
    // refused; under the per-type cap it is the first of its own twenty.
    const collegeEvent = await createDraft("first-college-event", {
      promotionType: "collegeEvent",
    });
    expect((await publish(collegeEvent)).status).toBe(200);

    const published = await readPublished();
    expect(published.commercial).toHaveLength(MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE);
    expect(published.collegeEvent).toHaveLength(1);
  });
});

describe("reorder is scoped to one type", () => {
  it("rewrites displayOrder within the named type and the public list follows", async () => {
    const alpha = await createDraft("alpha");
    const beta = await createDraft("beta");
    const gamma = await createDraft("gamma");
    for (const promotion of [alpha, beta, gamma]) {
      await publish(promotion);
    }

    const reordered = await withToken(
      request(application).post("/api/v1/promotions/reorder"),
      platformAdmin.authenticationToken
    ).send({
      promotionType: "commercial",
      orderedPromotionIds: [gamma.id, alpha.id, beta.id],
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.orderedCount).toBe(3);

    expect((await readPublished()).commercial.map((row) => row.title)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("(d) naming a college event in a commercial reorder is PROMOTION_TYPE_MISMATCH", async () => {
    const commercial = await createDraft("a-banner");
    const collegeEvent = await createDraft("a-college-event", { promotionType: "collegeEvent" });
    await publish(commercial);
    await publish(collegeEvent);

    const refused = await withToken(
      request(application).post("/api/v1/promotions/reorder"),
      platformAdmin.authenticationToken
    ).send({
      promotionType: "commercial",
      orderedPromotionIds: [collegeEvent.id, commercial.id],
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PROMOTION_TYPE_MISMATCH");
    expect(refused.body.error.details.mismatchedPromotionIds).toEqual([collegeEvent.id]);

    // Nothing was written: the check runs before the first update.
    const untouched = await PromotionModel.findById(commercial.id).lean();
    expect(untouched.displayOrder).toBe(0);
  });
});

describe("authorization", () => {
  it("the public read needs no token, but every write is platform-admin only", async () => {
    const anonymous = await request(application).get("/api/v1/public/promotions");
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data).toEqual({ commercial: [], collegeEvent: [] });

    const participant = await createTestParticipant(college, {
      emailAddress: "not-a-platform-admin@example.com",
    });
    const refused = await withToken(
      request(application).post("/api/v1/promotions"),
      participant.authenticationToken
    ).send({ title: "sneaky", promotionType: "commercial", imageUrl: "https://cdn.example.com/x.jpg" });
    expect(refused.status).toBe(403);

    // A college administrator is NOT a platform admin: promotions are seen by
    // every participant on the platform, not just their college's.
    const collegeAdmin = await createTestAdministrator(college, {
      emailAddress: "college-admin@example.com",
    });
    const alsoRefused = await withToken(
      request(application).post("/api/v1/promotions"),
      collegeAdmin.authenticationToken
    ).send({
      title: "college banner",
      promotionType: "collegeEvent",
      collegeName: "Their College",
      imageUrl: "https://cdn.example.com/y.jpg",
    });
    expect(alsoRefused.status).toBe(403);
  });
});
