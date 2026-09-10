import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
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
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * Sponsors exist at THREE levels a participant can reach: the fest, a top-level
 * category event, and a leaf event under it. The frontend resolves all three
 * with one code path, which only works while the three payloads carry the same
 * sponsor shape — so these tests read every level through the PUBLIC endpoints
 * (no admin token) and assert the shape, the tier, and the caps.
 */
let college;
let admin;
let fest;

function asAdmin(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${admin.authenticationToken}`);
}

function buildSponsor(overrides = {}) {
  return {
    imageUrl: "https://cdn.example.com/logo.png",
    sponsorName: "Acme Corporation",
    tier: "partner",
    ...overrides,
  };
}

function buildSponsorList(count, tier = "partner") {
  return Array.from({ length: count }, (_unused, index) =>
    buildSponsor({
      sponsorName: `Sponsor ${index + 1}`,
      imageUrl: `https://cdn.example.com/logo-${index + 1}.png`,
      tier,
    })
  );
}

beforeAll(async () => {
  await setupTestDatabase();
  await FestModel.createIndexes();
  await EventModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, {
    festSlug: "sponsor-fest-2027",
    status: "published",
    visibility: "public",
  });
});

afterAll(teardownTestDatabase);

describe("sponsors are readable at all three levels of the public hierarchy", () => {
  it("returns fest sponsors, category-event sponsors and leaf-event sponsors from the public reads", async () => {
    const festPatch = await asAdmin(request(application).patch(`/api/v1/fests/${fest.id}`)).send({
      sponsors: [buildSponsor({ sponsorName: "Fest Title Sponsor", tier: "title" })],
    });
    expect(festPatch.status).toBe(200);

    const categoryEvent = await createTestEvent(fest, admin.user, {
      eventName: "Technical",
      eventSlug: "technical",
      status: "published",
      parentEventId: null,
      sponsors: [buildSponsor({ sponsorName: "Category Presenting Sponsor", tier: "presenting" })],
    });
    const leafEvent = await createTestEvent(fest, admin.user, {
      eventName: "Robowars",
      eventSlug: "robowars",
      status: "published",
      parentEventId: categoryEvent._id,
      sponsors: [buildSponsor({ sponsorName: "Leaf Associate Sponsor", tier: "associate" })],
    });

    const festResponse = await request(application).get(`/api/v1/public/fests/${fest.festSlug}`);
    expect(festResponse.status).toBe(200);
    expect(festResponse.body.data.sponsors).toHaveLength(1);
    expect(festResponse.body.data.sponsors[0].sponsorName).toBe("Fest Title Sponsor");
    expect(festResponse.body.data.sponsors[0].tier).toBe("title");

    const treeResponse = await request(application).get(
      `/api/v1/public/fests/${fest.id}/events?includeChildren=true`
    );
    expect(treeResponse.status).toBe(200);
    const listedCategory = treeResponse.body.data.find((row) => row.id === categoryEvent.id);
    const listedLeaf = treeResponse.body.data.find((row) => row.id === leafEvent.id);
    expect(listedCategory.sponsors[0].sponsorName).toBe("Category Presenting Sponsor");
    expect(listedCategory.sponsors[0].tier).toBe("presenting");
    expect(listedLeaf.sponsors[0].sponsorName).toBe("Leaf Associate Sponsor");
    expect(listedLeaf.sponsors[0].tier).toBe("associate");

    const leafResponse = await request(application).get(
      `/api/v1/public/fests/${fest.festSlug}/events/${leafEvent.eventSlug}`
    );
    expect(leafResponse.status).toBe(200);
    expect(leafResponse.body.data.sponsors).toHaveLength(1);
    expect(leafResponse.body.data.sponsors[0].tier).toBe("associate");
  });

  it("gives a fest sponsor and an event sponsor the same field shape, so one renderer serves both", async () => {
    await asAdmin(request(application).patch(`/api/v1/fests/${fest.id}`)).send({
      sponsors: [buildSponsor({ linkUrl: "https://acme.example.com" })],
    });
    const event = await createTestEvent(fest, admin.user, {
      status: "published",
      sponsors: [buildSponsor({ linkUrl: "https://acme.example.com" })],
    });

    const festResponse = await request(application).get(`/api/v1/public/fests/${fest.festSlug}`);
    const eventResponse = await request(application).get(
      `/api/v1/public/fests/${fest.festSlug}/events/${event.eventSlug}`
    );

    const festSponsorKeys = Object.keys(festResponse.body.data.sponsors[0]).sort();
    const eventSponsorKeys = Object.keys(eventResponse.body.data.sponsors[0]).sort();
    expect(eventSponsorKeys).toEqual(festSponsorKeys);
    expect(festSponsorKeys).toContain("imageUrl");
    expect(festSponsorKeys).toContain("sponsorName");
    expect(festSponsorKeys).toContain("tier");
    expect(festSponsorKeys).toContain("linkUrl");
  });
});

describe("tier fidelity through a write then a public read", () => {
  it("keeps each sponsor's tier attached to that sponsor when written out of priority order", async () => {
    const outOfOrderSponsors = [
      buildSponsor({ sponsorName: "Partner Row", tier: "partner" }),
      buildSponsor({ sponsorName: "Associate Row", tier: "associate" }),
      buildSponsor({ sponsorName: "Presenting Row", tier: "presenting" }),
      buildSponsor({ sponsorName: "Title Row", tier: "title" }),
    ];
    const patchResponse = await asAdmin(
      request(application).patch(`/api/v1/fests/${fest.id}`)
    ).send({ sponsors: outOfOrderSponsors });
    expect(patchResponse.status).toBe(200);

    const festResponse = await request(application).get(`/api/v1/public/fests/${fest.festSlug}`);
    // The backend stores what it was given and does NOT re-sort: sorting is the
    // frontend's display decision. What must survive is the pairing.
    expect(
      festResponse.body.data.sponsors.map((sponsor) => [sponsor.sponsorName, sponsor.tier])
    ).toEqual([
      ["Partner Row", "partner"],
      ["Associate Row", "associate"],
      ["Presenting Row", "presenting"],
      ["Title Row", "title"],
    ]);
  });

  it("defaults a stored sponsor that predates the tier field to partner rather than rejecting it", async () => {
    // A legacy subdocument, written straight to the model with no tier — exactly
    // what already sits in the database. The schema must accept it.
    const legacyFest = await createTestFest(college, admin.user, {
      festName: "Legacy Fest",
      festSlug: "legacy-fest",
      status: "published",
      visibility: "public",
      sponsors: [{ imageUrl: "https://cdn.example.com/legacy.png" }],
    });
    const festResponse = await request(application).get(
      `/api/v1/public/fests/${legacyFest.festSlug}`
    );
    expect(festResponse.status).toBe(200);
    expect(festResponse.body.data.sponsors[0].tier).toBe("partner");
    expect(festResponse.body.data.sponsors[0].sponsorName).toBeNull();
  });
});

describe("sponsor array size limits", () => {
  it("accepts ten sponsors on a fest and rejects eleven", async () => {
    const acceptedResponse = await asAdmin(
      request(application).patch(`/api/v1/fests/${fest.id}`)
    ).send({ sponsors: buildSponsorList(10) });
    expect(acceptedResponse.status).toBe(200);
    expect(acceptedResponse.body.data.sponsors).toHaveLength(10);

    const rejectedResponse = await asAdmin(
      request(application).patch(`/api/v1/fests/${fest.id}`)
    ).send({ sponsors: buildSponsorList(11) });
    expect(rejectedResponse.status).toBe(400);
  });

  it("accepts five sponsors on an event and rejects six", async () => {
    const event = await createTestEvent(fest, admin.user, { status: "published" });
    const eventPath = `/api/v1/fests/${fest.id}/events/${event.id}`;

    const acceptedResponse = await asAdmin(request(application).patch(eventPath)).send({
      sponsors: buildSponsorList(5),
    });
    expect(acceptedResponse.status).toBe(200);
    expect(acceptedResponse.body.data.sponsors).toHaveLength(5);

    const rejectedResponse = await asAdmin(request(application).patch(eventPath)).send({
      sponsors: buildSponsorList(6),
    });
    expect(rejectedResponse.status).toBe(400);
  });
});

describe("sponsor entry validation on write", () => {
  const invalidEntriesByDescription = {
    "a missing tier": { imageUrl: "https://cdn.example.com/a.png", sponsorName: "No Tier" },
    "an invalid tier": buildSponsor({ tier: "platinum" }),
    "a missing imageUrl": { sponsorName: "No Image", tier: "title" },
    "a missing sponsorName": { imageUrl: "https://cdn.example.com/a.png", tier: "title" },
  };

  for (const [description, invalidSponsor] of Object.entries(invalidEntriesByDescription)) {
    it(`rejects ${description} on a fest with a 400`, async () => {
      const response = await asAdmin(request(application).patch(`/api/v1/fests/${fest.id}`)).send({
        sponsors: [invalidSponsor],
      });
      expect(response.status).toBe(400);
    });

    it(`rejects ${description} on an event with a 400`, async () => {
      const event = await createTestEvent(fest, admin.user, { status: "published" });
      const response = await asAdmin(
        request(application).patch(`/api/v1/fests/${fest.id}/events/${event.id}`)
      ).send({ sponsors: [invalidSponsor] });
      expect(response.status).toBe(400);
    });
  }
});

describe("the event poster field on the public read", () => {
  it("returns posterImageUrl null for an event that has no poster, rather than omitting the key", async () => {
    const event = await createTestEvent(fest, admin.user, { status: "published" });
    const response = await request(application).get(
      `/api/v1/public/fests/${fest.festSlug}/events/${event.eventSlug}`
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty("posterImageUrl");
    expect(response.body.data.posterImageUrl).toBeNull();
  });

  it("returns the poster URL once one is set", async () => {
    const event = await createTestEvent(fest, admin.user, { status: "published" });
    const patchResponse = await asAdmin(
      request(application).patch(`/api/v1/fests/${fest.id}/events/${event.id}`)
    ).send({ posterImageUrl: "https://cdn.example.com/poster.png" });
    expect(patchResponse.status).toBe(200);

    const response = await request(application).get(
      `/api/v1/public/fests/${fest.festSlug}/events/${event.eventSlug}`
    );
    expect(response.body.data.posterImageUrl).toBe("https://cdn.example.com/poster.png");
  });
});
