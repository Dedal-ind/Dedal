import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
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
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * GET /api/v1/public/fests/:festId/contingents — every published bundle in one
 * fest, in one request, grouped by the container it hangs under.
 *
 * WHY THE ENDPOINT EXISTS. The fest detail screen used to ask
 * /public/events/:eventId/contingents once per top-level container: eight
 * requests on a real fest, on top of the fest itself and its event tree. The
 * public limiter allows 100 requests per 15 minutes, so a fest page cost ten
 * public requests and roughly nine loads exhausted a browsing session.
 *
 * The contract these tests pin is narrow and deliberate: SAME DATA, ONE ROUND
 * TRIP. The per-event endpoint stays exactly as it was, and the batched
 * response must be byte-for-byte the same per contingent — the "identical
 * shape" test below is the one that stops the two drifting, because both reads
 * now share one decoration helper and nothing else guarantees they keep sharing
 * it.
 *
 * The fest-level bucket is not a nicety. parentEventId is nullable, and null
 * means a bundle that hangs off the fest and covers its top-level events. The
 * per-event fan-out could never ask for those — there is no event id to ask
 * under — so they were unreachable by participants entirely.
 */

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

let college;
let admin;
let fest;
let culturalContainer;
let sportsContainer;

/* A free solo sub-event: the only shape a contingent is allowed to wrap. */
async function createSubEvent(container, slug, overrides = {}) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: slug,
      eventName: slug.toUpperCase(),
      parentEventId: container?._id ?? null,
      category: "cultural",
      eventType: "solo",
      feeType: "free",
      feeAmountPaise: 0,
      ...overrides,
    })
  );
}

async function createContainer(slug, name) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: slug,
      eventName: name,
      category: null,
      feeType: "free",
      feeAmountPaise: 0,
    })
  );
}

async function publishContingent({ parentEventId, contingentName, includedEventIds }) {
  const createResponse = await withToken(
    request(application).post(`/api/v1/fests/${fest.id}/contingents`),
    admin.authenticationToken
  ).send({
    ...(parentEventId ? { parentEventId: String(parentEventId) } : {}),
    contingentName,
    includedEventIds: includedEventIds.map(String),
    pricePaise: 5000,
    /* Every sub-event here is free, so any price is "more than the individual
       total". The flag says that is deliberate rather than an accident. */
    allowNegativeDiscount: true,
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

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  culturalContainer = await createContainer("sanskriti", "Sanskriti");
  sportsContainer = await createContainer("athlos", "Athlos");
});

describe("GET /public/fests/:festId/contingents", () => {
  it("returns bundles from several events grouped under their parent event", async () => {
    const singing = await createSubEvent(culturalContainer, "solo-singing");
    const sketching = await createSubEvent(culturalContainer, "sketching");
    const sprint = await createSubEvent(sportsContainer, "sprint", { category: "sports" });
    const longJump = await createSubEvent(sportsContainer, "long-jump", { category: "sports" });

    await publishContingent({
      parentEventId: culturalContainer._id,
      contingentName: "Sanskriti Solo Pass",
      includedEventIds: [singing._id, sketching._id],
    });
    await publishContingent({
      parentEventId: sportsContainer._id,
      contingentName: "Athlos Track Pass",
      includedEventIds: [sprint._id, longJump._id],
    });

    const response = await request(application).get(`/api/v1/public/fests/${fest.id}/contingents`);

    expect(response.status).toBe(200);
    const { contingentsByParentEventId, festLevelContingents } = response.body.data;

    // Two containers, one bundle each, each filed under its own parent.
    expect(Object.keys(contingentsByParentEventId).sort()).toEqual(
      [String(culturalContainer._id), String(sportsContainer._id)].sort()
    );
    expect(
      contingentsByParentEventId[String(culturalContainer._id)].map((c) => c.contingentName)
    ).toEqual(["Sanskriti Solo Pass"]);
    expect(
      contingentsByParentEventId[String(sportsContainer._id)].map((c) => c.contingentName)
    ).toEqual(["Athlos Track Pass"]);
    expect(festLevelContingents).toEqual([]);

    /* The grouping key is the bundle's own parentEventId, not a positional
       guess — a bundle filed under the wrong container would render on the
       wrong part of the fest page. */
    const cultural = contingentsByParentEventId[String(culturalContainer._id)][0];
    expect(cultural.parentEventId).toBe(String(culturalContainer._id));
    expect(cultural.includedEvents.map((event) => event.eventName).sort()).toEqual([
      "SKETCHING",
      "SOLO-SINGING",
    ]);
  });

  it("returns a fest-level bundle, which the per-event endpoint cannot reach", async () => {
    /* parentEventId null: the bundle hangs off the fest and wraps its
       TOP-LEVEL events, so these two have no container. */
    const quiz = await createSubEvent(null, "mindspark-quiz", { category: "literary" });
    const essay = await createSubEvent(null, "essay-sprint", { category: "literary" });

    await publishContingent({
      parentEventId: null,
      contingentName: "Full Access",
      includedEventIds: [quiz._id, essay._id],
    });

    const response = await request(application).get(`/api/v1/public/fests/${fest.id}/contingents`);

    expect(response.status).toBe(200);
    expect(response.body.data.contingentsByParentEventId).toEqual({});
    expect(response.body.data.festLevelContingents.map((c) => c.contingentName)).toEqual([
      "Full Access",
    ]);
    expect(response.body.data.festLevelContingents[0].parentEventId).toBeNull();
  });

  it("returns empty buckets for a fest with no contingents", async () => {
    const response = await request(application).get(`/api/v1/public/fests/${fest.id}/contingents`);

    expect(response.status).toBe(200);
    /* Both keys are always present, so the client never has to guard before
       iterating. Absent keys are how a consumer ends up doing `?? {}` at every
       call site and one of them forgetting. */
    expect(response.body.data).toEqual({
      contingentsByParentEventId: {},
      festLevelContingents: [],
    });
  });

  it("omits contingents that are not published", async () => {
    const singing = await createSubEvent(culturalContainer, "solo-singing");
    const sketching = await createSubEvent(culturalContainer, "sketching");

    /* Created but never published — a draft price must not reach participants
       through the batched read any more than through the per-event one. */
    const createResponse = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`),
      admin.authenticationToken
    ).send({
      parentEventId: String(culturalContainer._id),
      contingentName: "Draft Pass",
      includedEventIds: [String(singing._id), String(sketching._id)],
      pricePaise: 5000,
      allowNegativeDiscount: true,
    });
    expect(createResponse.status).toBe(201);

    const response = await request(application).get(`/api/v1/public/fests/${fest.id}/contingents`);

    expect(response.status).toBe(200);
    expect(response.body.data.contingentsByParentEventId).toEqual({});
    expect(response.body.data.festLevelContingents).toEqual([]);
  });

  it("refuses an unknown fest id and a malformed one", async () => {
    const unknown = await request(application).get(
      "/api/v1/public/fests/000000000000000000000000/contingents"
    );
    expect(unknown.status).toBe(404);

    /* Not a 24-hex id, so it never matches this route — it falls through to the
       slug route and 404s there. Either way a bad id is a miss, never a 500
       from a failed ObjectId cast. */
    const malformed = await request(application).get(
      "/api/v1/public/fests/not-a-real-id/contingents"
    );
    expect(malformed.status).toBe(404);
  });

  it("does not expose the contingents of an unpublished fest", async () => {
    const draftFest = await createTestFest(college, admin.user, {
      festSlug: "draft-fest",
      status: "draft",
    });
    const response = await request(application).get(
      `/api/v1/public/fests/${draftFest.id}/contingents`
    );
    expect(response.status).toBe(404);
  });

  it("returns each contingent in exactly the shape the per-event endpoint returns", async () => {
    const singing = await createSubEvent(culturalContainer, "solo-singing");
    const sketching = await createSubEvent(culturalContainer, "sketching");
    await publishContingent({
      parentEventId: culturalContainer._id,
      contingentName: "Sanskriti Solo Pass",
      includedEventIds: [singing._id, sketching._id],
    });

    const perEvent = await request(application).get(
      `/api/v1/public/events/${culturalContainer._id}/contingents`
    );
    const batched = await request(application).get(`/api/v1/public/fests/${fest.id}/contingents`);

    expect(perEvent.status).toBe(200);
    expect(batched.status).toBe(200);

    const fromPerEvent = perEvent.body.data.contingents;
    const fromBatched = batched.body.data.contingentsByParentEventId[String(culturalContainer._id)];

    /* Deep equality, not a field-by-field spot check: the whole point of the
       batched read is that the client can drop it into the place the per-event
       read used to fill, so ANY divergence — a missing includedEvents, a
       stringified date, an extra key — is a defect. */
    expect(fromBatched).toEqual(fromPerEvent);
    expect(Object.keys(fromBatched[0]).sort()).toEqual(Object.keys(fromPerEvent[0]).sort());
    expect(fromBatched[0].includedEvents).toEqual(fromPerEvent[0].includedEvents);
  });
});
