import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { resolveEventScopeIds } from "../../src/helpers/event-descendant-helpers.js";
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
  createTestParticipant,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * The cascading filter's backend half: ?eventId= scopes to one event,
 * ?includeDescendants=true widens it to that event's whole subtree.
 *
 * The fixture mirrors the real Alliance One shape the client described:
 *   parentEvent  (Chiduranga)  → childOne (Finance), childTwo (Marketing)
 *                                childOne → grandchild  (depth 3)
 *   siblingEvent (Samvita)     → no children
 */
let college;
let admin;
let fest;
let parentEvent;
let childOne;
let childTwo;
let grandchildEvent;
let siblingEvent;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

async function registerParticipantFor(event, emailAddress, usn) {
  const participant = await createTestParticipant(college, { emailAddress, usn });
  await RegistrationModel.create({
    eventId: event._id,
    userId: participant.user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
    totalFeePaise: 0,
    registeredAt: new Date(),
  });
  return participant;
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });

  parentEvent = await createTestEvent(fest, admin.user, {
    eventSlug: "chiduranga",
    eventName: "Chiduranga",
  });
  childOne = await createTestEvent(fest, admin.user, {
    eventSlug: "finance",
    eventName: "Finance",
    parentEventId: parentEvent._id,
  });
  childTwo = await createTestEvent(fest, admin.user, {
    eventSlug: "marketing",
    eventName: "Marketing",
    parentEventId: parentEvent._id,
  });
  grandchildEvent = await createTestEvent(fest, admin.user, {
    eventSlug: "finance-quiz",
    eventName: "Finance Quiz",
    parentEventId: childOne._id,
  });
  siblingEvent = await createTestEvent(fest, admin.user, {
    eventSlug: "samvita",
    eventName: "Samvita",
  });
});

describe("resolveEventScopeIds", () => {
  it("returns the whole subtree at any depth, and only the event itself without the flag", async () => {
    const subtreeIds = await resolveEventScopeIds(fest._id, parentEvent._id, true);
    expect(subtreeIds.sort()).toEqual(
      [parentEvent._id, childOne._id, childTwo._id, grandchildEvent._id].map(String).sort()
    );

    const selfOnly = await resolveEventScopeIds(fest._id, parentEvent._id, false);
    expect(selfOnly).toEqual([String(parentEvent._id)]);

    // A leaf's subtree is just itself; no event id at all means no narrowing.
    expect(await resolveEventScopeIds(fest._id, siblingEvent._id, true)).toEqual([
      String(siblingEvent._id),
    ]);
    expect(await resolveEventScopeIds(fest._id, null, true)).toBeNull();
  });

  it("resolves a 3-deep tree of 20 events well inside the latency budget", async () => {
    // 15 more events so the fest holds 20, then time the walk.
    for (let index = 0; index < 15; index += 1) {
      await createTestEvent(fest, admin.user, {
        eventSlug: `perf-event-${index}`,
        eventName: `Perf Event ${index}`,
        parentEventId: index % 2 === 0 ? childOne._id : childTwo._id,
      });
    }
    const startedAt = Date.now();
    const subtreeIds = await resolveEventScopeIds(fest._id, parentEvent._id, true);
    const elapsedMilliseconds = Date.now() - startedAt;

    expect(subtreeIds).toHaveLength(19); // parent + 2 children + grandchild + 15
    expect(elapsedMilliseconds).toBeLessThan(50);
  });
});

describe("analytics summary honours includeDescendants", () => {
  beforeEach(async () => {
    await registerParticipantFor(parentEvent, "on-parent@example.com", "1AA00AA001");
    await registerParticipantFor(childOne, "on-child@example.com", "1AA00AA002");
    await registerParticipantFor(grandchildEvent, "on-grandchild@example.com", "1AA00AA003");
    await registerParticipantFor(siblingEvent, "on-sibling@example.com", "1AA00AA004");
  });

  async function readConfirmedTotal(query) {
    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/analytics/summary${query}`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    return response.body.data.funnel.perEvent.reduce(
      (total, row) => total + row.registrationsConfirmed,
      0
    );
  }

  it("counts the whole subtree with the flag and only the event without it", async () => {
    expect(await readConfirmedTotal("")).toBe(4); // whole fest
    expect(await readConfirmedTotal(`?eventId=${parentEvent.id}`)).toBe(1); // parent only
    // parent + child + grandchild, but NOT the unrelated sibling
    expect(
      await readConfirmedTotal(`?eventId=${parentEvent.id}&includeDescendants=true`)
    ).toBe(3);
    // A leaf with the flag set is still just the leaf.
    expect(await readConfirmedTotal(`?eventId=${siblingEvent.id}&includeDescendants=true`)).toBe(1);
  });
});

describe("registrations export honours includeDescendants", () => {
  beforeEach(async () => {
    await registerParticipantFor(parentEvent, "csv-parent@example.com", "1AA00AA011");
    await registerParticipantFor(childOne, "csv-child@example.com", "1AA00AA012");
    await registerParticipantFor(siblingEvent, "csv-sibling@example.com", "1AA00AA013");
  });

  async function readCsv(query) {
    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/exports/registrations.csv${query}`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    return response.text;
  }

  it("scopes the sheet to the subtree, the single event, or the whole fest", async () => {
    const subtreeCsv = await readCsv(`?eventId=${parentEvent.id}&includeDescendants=true`);
    expect(subtreeCsv).toContain("csv-parent@example.com");
    expect(subtreeCsv).toContain("csv-child@example.com");
    expect(subtreeCsv).not.toContain("csv-sibling@example.com");

    const parentOnlyCsv = await readCsv(`?eventId=${parentEvent.id}`);
    expect(parentOnlyCsv).toContain("csv-parent@example.com");
    expect(parentOnlyCsv).not.toContain("csv-child@example.com");

    const wholeFestCsv = await readCsv("");
    expect(wholeFestCsv).toContain("csv-sibling@example.com");
  });
});
