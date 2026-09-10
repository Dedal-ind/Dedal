import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
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
  createTestParticipant,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let event;
let participant;

function asParticipant(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${participant.authenticationToken}`);
}
function soloPath(eventId) {
  return `/api/v1/events/${eventId}/registrations/solo`;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, openRegistrationOverrides({ eventType: "solo", capacity: 5 }));
  participant = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

describe("GET /api/v1/passes/mine", () => {
  it("returns PASS_NOT_FOUND before any registration", async () => {
    const response = await asParticipant(request(application).get("/api/v1/passes/mine").query({ festId: fest.id }));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PASS_NOT_FOUND");
  });

  it("returns 400 when festId is missing", async () => {
    const response = await asParticipant(request(application).get("/api/v1/passes/mine"));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns the pass with gate + event entitlements and populated shape after registering", async () => {
    await asParticipant(request(application).post(soloPath(event.id)));

    const response = await asParticipant(request(application).get("/api/v1/passes/mine").query({ festId: fest.id }));

    expect(response.status).toBe(200);
    expect(response.body.data.pass.qrToken).toHaveLength(32);
    expect(response.body.data.fest.festName).toBe("Alliance ONE 2027");
    expect(response.body.data.user.emailAddress).toBe(participant.user.emailAddress);
    const types = response.body.data.entitlements.map((entitlement) => entitlement.entitlementType).sort();
    expect(types).toEqual(["eventEntry", "gateAccess"]);
    const eventEntry = response.body.data.entitlements.find((entitlement) => entitlement.entitlementType === "eventEntry");
    expect(eventEntry.referenceId.eventName).toBe("Robowars 2027");
  });

  it("drops the eventEntry once the registration is cancelled, keeping gate access", async () => {
    await asParticipant(request(application).post(soloPath(event.id)));
    await asParticipant(request(application).post(`/api/v1/events/${event.id}/registrations/mine/cancel`));

    const response = await asParticipant(request(application).get("/api/v1/passes/mine").query({ festId: fest.id }));

    expect(response.status).toBe(200);
    expect(response.body.data.entitlements).toHaveLength(1);
    expect(response.body.data.entitlements[0].entitlementType).toBe("gateAccess");
  });
});

describe("GET /api/v1/passes/mine/all", () => {
  it("returns each active pass wrapped with its fest", async () => {
    await asParticipant(request(application).post(soloPath(event.id)));

    const response = await asParticipant(request(application).get("/api/v1/passes/mine/all"));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].fest.festName).toBe("Alliance ONE 2027");
    expect(response.body.data[0].pass.qrToken).toHaveLength(32);
  });

  it("refuses an unauthenticated caller", async () => {
    expect((await request(application).get("/api/v1/passes/mine/all")).status).toBe(401);
  });
});
