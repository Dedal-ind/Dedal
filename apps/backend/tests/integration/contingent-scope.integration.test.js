/*
 * contingent-scope.integration.test.js
 *
 * GET /fests/:festId/contingents/scope — the admin form's one read for a scope.
 *
 * THE BUG THIS REPLACES. The structure screen's contingent form read the list
 * endpoint's { contingents } envelope as a bare array, so it never found an
 * existing bundle, opened blank every time, and POSTed a duplicate on every
 * save until a published copy turned the next save into a 409. It also guessed
 * eligibility in the browser, greying out team events but offering draft ones
 * the server then refused.
 *
 * The test that matters most is the consistency one: an event this read marks
 * ineligible must be exactly an event create refuses, with the same reasons.
 * That is the promise that lets the form trust the verdict instead of re-deriving
 * it, and it is the thing that would silently break if the rule were ever copied
 * back into the client.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { installEmailServiceMock } from "../setup/test-email-service.js";
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
  createTestOutsider,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let parentEvent;
let subEventA;
let subEventB;

function asAdmin(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${admin.authenticationToken}`);
}

function readScope(parentEventId) {
  const query = parentEventId ? `?parentEventId=${parentEventId}` : "";
  return asAdmin(request(application).get(`/api/v1/fests/${fest.id}/contingents/scope${query}`));
}

async function createChild(parent, slug, feeAmountPaise, overrides = {}) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: slug,
      eventName: slug.toUpperCase(),
      parentEventId: parent ? parent._id : null,
      eventType: "solo",
      feeType: feeAmountPaise > 0 ? "perPerson" : "free",
      feeAmountPaise,
      ...overrides,
    })
  );
}

async function createFreeContainer(slug) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: slug,
      eventName: slug.toUpperCase(),
      category: null,
      feeType: "free",
      feeAmountPaise: 0,
    })
  );
}

async function createDraft(name, includedEvents, parent = parentEvent) {
  const response = await asAdmin(
    request(application).post(`/api/v1/fests/${fest.id}/contingents`)
  ).send({
    parentEventId: parent ? String(parent._id) : null,
    contingentName: name,
    includedEventIds: includedEvents.map((event) => String(event._id)),
    pricePaise: 25000,
  });
  expect(response.status).toBe(201);
  return response.body.data.contingent.id;
}

async function publish(contingentId) {
  const response = await asAdmin(
    request(application).post(`/api/v1/fests/${fest.id}/contingents/${contingentId}/publish`)
  );
  expect(response.status).toBe(200);
}

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  parentEvent = await createFreeContainer("chidaranga");
  subEventA = await createChild(parentEvent, "finance", 10000);
  subEventB = await createChild(parentEvent, "marketing", 20000);
});

describe("contingent scope read", () => {
  it("lists a parent's sub-events with the reasons each one cannot be bundled", async () => {
    const teamChild = await createChild(parentEvent, "team-child", 5000, {
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
    });
    const draftChild = await createChild(parentEvent, "draft-child", 5000, { status: "draft" });

    const response = await readScope(parentEvent._id);

    expect(response.status).toBe(200);
    const byId = new Map(response.body.data.candidateEvents.map((event) => [event.id, event]));
    expect(byId.size).toBe(4);
    expect(byId.get(String(subEventA._id)).isEligible).toBe(true);
    expect(byId.get(String(subEventA._id)).ineligibleReasons).toEqual([]);
    expect(byId.get(String(teamChild._id)).isEligible).toBe(false);
    expect(byId.get(String(teamChild._id)).ineligibleReasons.join(" ")).toMatch(/team event/);
    expect(byId.get(String(draftChild._id)).ineligibleReasons.join(" ")).toMatch(/not published/);

    expect(response.body.data.scope.eligibleEventCount).toBe(2);
    expect(response.body.data.scope.blockedReason).toBeNull();
  });

  it("marks an event ineligible exactly when create refuses it, with the same reasons", async () => {
    const draftChild = await createChild(parentEvent, "draft-child", 5000, { status: "draft" });

    const scopeResponse = await readScope(parentEvent._id);
    const verdict = scopeResponse.body.data.candidateEvents.find(
      (event) => event.id === String(draftChild._id)
    );

    const createResponse = await asAdmin(
      request(application).post(`/api/v1/fests/${fest.id}/contingents`)
    ).send({
      parentEventId: String(parentEvent._id),
      contingentName: "Draft Bundle",
      includedEventIds: [String(subEventA._id), String(draftChild._id)],
      pricePaise: 1000,
    });

    expect(verdict.isEligible).toBe(false);
    expect(createResponse.status).toBe(400);
    /* One function produces both. If this ever diverges, the rule has been
       copied somewhere it should not have been. */
    expect(createResponse.body.error.details.includedEventIds[String(draftChild._id)]).toBe(
      verdict.ineligibleReasons.join("; ")
    );
  });

  it("flags a paid parent before any bundle is attempted", async () => {
    const paidParent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "paid-parent",
        eventName: "Paid Parent",
        category: null,
        feeType: "perPerson",
        feeAmountPaise: 5000,
      })
    );
    await createChild(paidParent, "paid-child-a", 1000);
    await createChild(paidParent, "paid-child-b", 1000);

    const response = await readScope(paidParent._id);

    expect(response.status).toBe(200);
    expect(response.body.data.scope.parentHasFee).toBe(true);
    expect(response.body.data.scope.blockedReason).toBe("parentHasFee");
  });

  it("blocks a scope with fewer than two eligible events", async () => {
    const lonelyParent = await createFreeContainer("lonely");
    await createChild(lonelyParent, "only-child", 1000);

    const response = await readScope(lonelyParent._id);

    expect(response.body.data.scope.eligibleEventCount).toBe(1);
    expect(response.body.data.scope.blockedReason).toBe("notEnoughEligibleEvents");
  });

  it("returns every bundle in the scope, not just one", async () => {
    /* The participant app sells several bundles per scope; the old form could
       only ever show one. Two drafts on the same events do not conflict —
       overlap is enforced at publish. */
    await createDraft("Solo Pass", [subEventA, subEventB]);
    await createDraft("Weekend Pass", [subEventA, subEventB]);

    const response = await readScope(parentEvent._id);

    expect(response.body.data.contingents.map((contingent) => contingent.contingentName)).toEqual([
      "Solo Pass",
      "Weekend Pass",
    ]);
  });

  it("reports an event as taken only once a bundle in this scope is published", async () => {
    const contingentId = await createDraft("Solo Pass", [subEventA, subEventB]);

    const beforePublish = await readScope(parentEvent._id);
    expect(
      beforePublish.body.data.candidateEvents.every((event) => event.inPublishedContingent === null)
    ).toBe(true);

    await publish(contingentId);

    const afterPublish = await readScope(parentEvent._id);
    const eventA = afterPublish.body.data.candidateEvents.find(
      (event) => event.id === String(subEventA._id)
    );
    expect(eventA.inPublishedContingent).toEqual({ id: contingentId, contingentName: "Solo Pass" });
  });

  it("locks a bundle's structure once it is published", async () => {
    const contingentId = await createDraft("Solo Pass", [subEventA, subEventB]);

    const draftScope = await readScope(parentEvent._id);
    expect(draftScope.body.data.contingents[0]).toMatchObject({
      claimCount: 0,
      isStructureLocked: false,
    });

    await publish(contingentId);

    const publishedScope = await readScope(parentEvent._id);
    expect(publishedScope.body.data.contingents[0].isStructureLocked).toBe(true);
  });

  it("offers the fest scope its childless top-level events, never a container or a nested event", async () => {
    const standaloneQuiz = await createChild(null, "quiz", 0);
    const standaloneDebate = await createChild(null, "debate", 0);

    const response = await readScope(null);

    expect(response.status).toBe(200);
    expect(response.body.data.scope.isFestLevel).toBe(true);
    const candidateIds = response.body.data.candidateEvents.map((event) => event.id).sort();
    expect(candidateIds).toEqual([String(standaloneQuiz._id), String(standaloneDebate._id)].sort());
    /* The container with children and its nested children are both absent. */
    expect(candidateIds).not.toContain(String(parentEvent._id));
    expect(candidateIds).not.toContain(String(subEventA._id));
  });

  it("treats an empty parentEventId as the fest scope", async () => {
    const response = await asAdmin(
      request(application).get(`/api/v1/fests/${fest.id}/contingents/scope?parentEventId=`)
    );

    expect(response.status).toBe(200);
    expect(response.body.data.scope.isFestLevel).toBe(true);
  });

  it("rejects a malformed parentEventId", async () => {
    const response = await asAdmin(
      request(application).get(`/api/v1/fests/${fest.id}/contingents/scope?parentEventId=not-an-id`)
    );

    expect(response.status).toBe(400);
  });

  it("refuses a user who is not an administrator", async () => {
    const outsider = await createTestOutsider();

    const response = await request(application)
      .get(`/api/v1/fests/${fest.id}/contingents/scope?parentEventId=${parentEvent._id}`)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`);

    expect(response.status).toBe(403);
  });
});
