import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
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
let participant;

function soloPath(eventId) {
  return `/api/v1/events/${eventId}/registrations/solo`;
}

function registerSolo(event, body, token = participant.authenticationToken) {
  return request(application)
    .post(soloPath(event._id))
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

async function createEvent(overrides = {}) {
  return createTestEvent(fest, admin.user, { ...openRegistrationOverrides(), ...overrides });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
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
});

afterAll(teardownTestDatabase);

describe("an event that asks for no declaration", () => {
  it("registers without the flag and stamps no acceptance", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: false });
    const response = await registerSolo(event, {});

    expect(response.status).toBe(201);
    const stored = await RegistrationModel.findOne({ userId: participant.user._id });
    expect(stored.medicalDeclarationAcceptedAt).toBeNull();
  });

  /*
   * A client that over-reports acceptance is not refused — the participant could
   * do nothing about it — but the record must not claim a declaration was
   * accepted for an event that never asked for one.
   */
  it("ignores the flag rather than recording an acceptance nobody asked for", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: false });
    const response = await registerSolo(event, { hasAcceptedMedicalDeclaration: true });

    expect(response.status).toBe(201);
    const stored = await RegistrationModel.findOne({ userId: participant.user._id });
    expect(stored.medicalDeclarationAcceptedAt).toBeNull();
  });
});

describe("an event that requires the declaration", () => {
  it("refuses a registration that omits the flag", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: true });
    const response = await registerSolo(event, {});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MEDICAL_DECLARATION_REQUIRED");
    expect(await RegistrationModel.countDocuments({})).toBe(0);
  });

  it("refuses a registration that declines", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: true });
    const response = await registerSolo(event, { hasAcceptedMedicalDeclaration: false });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MEDICAL_DECLARATION_REQUIRED");
  });

  it("does not consume a seat when the declaration is refused", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: true, capacity: 1 });
    await registerSolo(event, {});

    const reloaded = await EventModel.findById(event._id);
    expect(reloaded.registeredCount).toBe(0);
  });

  it("accepts and stamps the moment of acceptance", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: true });
    const before = Date.now();
    const response = await registerSolo(event, { hasAcceptedMedicalDeclaration: true });

    expect(response.status).toBe(201);
    const stored = await RegistrationModel.findOne({ userId: participant.user._id });
    expect(stored.medicalDeclarationAcceptedAt).toBeInstanceOf(Date);
    expect(stored.medicalDeclarationAcceptedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  /* A truthy non-boolean must not read as consent for a liability declaration. */
  it("refuses a non-boolean flag rather than treating it as consent", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: true });
    const response = await registerSolo(event, { hasAcceptedMedicalDeclaration: "yes" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });
});

/*
 * The leader accepts once and every member's row carries that same timestamp: a
 * member without one could not hold a seat on an event that demands it.
 */
describe("a team on an event that requires the declaration", () => {
  it("gives every member the leader's acceptance, verbatim", async () => {
    const event = await createEvent({
      requiresMedicalDeclaration: true,
      eventSlug: "team-medical",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
    });
    const teammate = await createTestParticipant(college, {
      emailAddress: "teammate@example.com",
      usn: "1AA00AA999",
    });

    const response = await request(application)
      .post(`/api/v1/events/${event._id}/registrations/team`)
      .set("Authorization", `Bearer ${participant.authenticationToken}`)
      .send({
        teamName: "Runners",
        memberEmails: [teammate.user.emailAddress],
        hasAcceptedMedicalDeclaration: true,
      });

    expect(response.status).toBe(201);
    const registrations = await RegistrationModel.find({ eventId: event._id });
    expect(registrations).toHaveLength(2);

    const timestamps = registrations.map((row) => row.medicalDeclarationAcceptedAt);
    expect(timestamps.every((timestamp) => timestamp instanceof Date)).toBe(true);
    expect(new Set(timestamps.map((timestamp) => timestamp.getTime())).size).toBe(1);
  });

  /*
   * The teammate is a real, same-college participant so the refusal can only be
   * the declaration — an unknown email would fail the college check first and
   * this would pass without ever reaching the medical rule.
   */
  it("refuses the whole team when the leader does not accept", async () => {
    const event = await createEvent({
      requiresMedicalDeclaration: true,
      eventSlug: "team-medical-2",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
    });
    const teammate = await createTestParticipant(college, {
      emailAddress: "refuser-teammate@example.com",
      usn: "1AA00AA888",
    });

    const response = await request(application)
      .post(`/api/v1/events/${event._id}/registrations/team`)
      .set("Authorization", `Bearer ${participant.authenticationToken}`)
      .send({ teamName: "Refusers", memberEmails: [teammate.user.emailAddress] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MEDICAL_DECLARATION_REQUIRED");
    expect(await RegistrationModel.countDocuments({})).toBe(0);
  });

  /* The refusal happens before resolveMembers, so no placeholder user survives it. */
  it("creates no placeholder user for an unknown teammate when the leader does not accept", async () => {
    const event = await createEvent({
      requiresMedicalDeclaration: true,
      eventSlug: "team-medical-3",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
    });

    await request(application)
      .post(`/api/v1/events/${event._id}/registrations/team`)
      .set("Authorization", `Bearer ${participant.authenticationToken}`)
      .send({ teamName: "Refusers", memberEmails: ["never-created@example.com"] });

    expect(await UserModel.findOne({ emailAddress: "never-created@example.com" })).toBeNull();
  });
});

describe("toggling the flag on an existing event", () => {
  it("lets an administrator turn it on and off", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: false });
    const path = `/api/v1/fests/${fest._id}/events/${event._id}`;

    const turnedOn = await request(application)
      .patch(path)
      .set("Authorization", `Bearer ${admin.authenticationToken}`)
      .send({ requiresMedicalDeclaration: true });
    expect(turnedOn.status).toBe(200);
    expect(turnedOn.body.data.requiresMedicalDeclaration).toBe(true);

    const turnedOff = await request(application)
      .patch(path)
      .set("Authorization", `Bearer ${admin.authenticationToken}`)
      .send({ requiresMedicalDeclaration: false });
    expect(turnedOff.body.data.requiresMedicalDeclaration).toBe(false);
  });

  /*
   * Turning the flag on is not retroactive. A seat taken when no declaration was
   * asked for keeps its null: back-dating an acceptance nobody gave would be a
   * worse record than an honest gap.
   */
  it("leaves registrations made before the toggle untouched", async () => {
    const event = await createEvent({ requiresMedicalDeclaration: false });
    await registerSolo(event, {});

    await request(application)
      .patch(`/api/v1/fests/${fest._id}/events/${event._id}`)
      .set("Authorization", `Bearer ${admin.authenticationToken}`)
      .send({ requiresMedicalDeclaration: true });

    const stored = await RegistrationModel.findOne({ userId: participant.user._id });
    expect(stored.medicalDeclarationAcceptedAt).toBeNull();
    expect(stored.status).toBe("confirmed");
  });
});
