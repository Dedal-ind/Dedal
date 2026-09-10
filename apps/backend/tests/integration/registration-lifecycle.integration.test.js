import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { TeamModel } from "../../src/models/team-model.js";
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

const MINE_PATH = "/api/v1/registrations/mine";

let college;
let admin;
let fest;
let participant;
let event;

function asParticipant(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${participant.authenticationToken}`);
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    TeamModel.createIndexes(),
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
  participant = await createTestParticipant(college);
  event = await createTestEvent(fest, admin.user, openRegistrationOverrides({ eventType: "solo", capacity: 5 }));
});

afterAll(teardownTestDatabase);

describe("registration lifecycle over HTTP", () => {
  it("registers, lists, reads, then cancels a solo registration", async () => {
    const created = await asParticipant(request(application).post(`/api/v1/events/${event.id}/registrations/solo`));
    expect(created.status).toBe(201);
    const registrationId = created.body.data.registration.id;

    const list = await asParticipant(request(application).get(MINE_PATH));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].eventId.eventName).toBe("Robowars 2027");

    const detail = await asParticipant(request(application).get(`/api/v1/registrations/${registrationId}`));
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(registrationId);

    const cancelled = await asParticipant(
      request(application).post(`/api/v1/events/${event.id}/registrations/mine/cancel`)
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.cancelledCount).toBe(1);
    expect(cancelled.body.data.event.registeredCount).toBe(0);

    const afterCancel = await EventModel.findById(event.id);
    expect(afterCancel.registeredCount).toBe(0);
  });

  it("hides another participant's registration behind PERMISSION_DENIED", async () => {
    const created = await asParticipant(request(application).post(`/api/v1/events/${event.id}/registrations/solo`));
    const registrationId = created.body.data.registration.id;
    const other = await createTestParticipant(college, { emailAddress: "other@example.com" });

    const response = await request(application)
      .get(`/api/v1/registrations/${registrationId}`)
      .set("Authorization", `Bearer ${other.authenticationToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("returns 200 and an empty array when a user has no registrations", async () => {
    const response = await asParticipant(request(application).get(MINE_PATH));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("404s a cancel when there is no active registration", async () => {
    const response = await asParticipant(
      request(application).post(`/api/v1/events/${event.id}/registrations/mine/cancel`)
    );
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("REGISTRATION_NOT_FOUND");
  });
});
