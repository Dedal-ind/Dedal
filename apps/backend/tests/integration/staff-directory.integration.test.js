import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
  createTestParticipant,
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let fest;
let shastra;
let codeSangram;
let coordinator;

function directoryPath(query = "") {
  return `/api/v1/fests/${fest.id}/staff-directory${query}`;
}

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    RegistrationModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  const admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });

  shastra = await createTestEvent(fest, admin.user, {
    eventSlug: "shastra",
    eventName: "Shastra",
    status: "published",
  });
  codeSangram = await createTestEvent(fest, admin.user, {
    eventSlug: "codesangram",
    eventName: "CodeSangram",
    status: "published",
    parentEventId: shastra._id,
  });

  // Coordinator scoped to the Shastra vertical, with a phone the directory can surface.
  coordinator = await createTestStaffMember(fest, "coordinator", {
    assignment: { eventIds: [shastra._id] },
  });
  await UserModel.updateOne(
    { _id: coordinator.user._id },
    { fullName: "Coordinator One", phoneNumber: "9876543210" }
  );
});

afterAll(teardownTestDatabase);

describe("GET /api/v1/fests/:festId/staff-directory", () => {
  it("gives a staff-tier coordinator every group with phone numbers", async () => {
    const response = await withToken(
      request(application).get(directoryPath()),
      coordinator.authenticationToken
    );

    expect(response.status).toBe(200);
    const groupNames = response.body.data.map((group) => group.eventName).sort();
    expect(groupNames).toEqual(["CodeSangram", "Shastra"]);

    const shastraGroup = response.body.data.find((group) => group.eventName === "Shastra");
    const entry = shastraGroup.staff.find((member) => member.role === "coordinator");
    expect(entry.fullName).toBe("Coordinator One");
    expect(entry.phoneNumber).toBe("9876543210");
  });

  it("gives a confirmed participant the crew's contact details", async () => {
    const participant = await createTestParticipant(college, { emailAddress: "viewer@example.com" });
    await RegistrationModel.create({
      eventId: codeSangram._id,
      userId: participant.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
    });

    const response = await withToken(
      request(application).get(directoryPath()),
      participant.authenticationToken
    );

    expect(response.status).toBe(200);
    const allEntries = response.body.data.flatMap((group) => group.staff);
    expect(allEntries.length).toBeGreaterThan(0);
    for (const entry of allEntries) {
      /*
       * Contact details ARE shown to a registered participant. The directory
       * exists so somebody can reach the person running their event; the
       * registration gate above is what limits who sees them, not a second
       * tier inside the response.
       */
      expect(entry).toHaveProperty("phoneNumber");
      expect(entry).toHaveProperty("emailAddress");
      expect(entry.fullName).toBe("Coordinator One");
    }
  });

  /*
   * WHO is running the fest is open to any signed-in visitor; HOW to reach them
   * is not. This replaces an assertion that the whole request was refused with
   * 403 — knowing who oversees an event is part of deciding whether to register
   * for it, so refusing the roster to somebody who has not registered yet was
   * backwards. The tiering moved into the response instead.
   */
  it("gives a user with no registration and no assignment the roster without contact details", async () => {
    const outsider = await createTestOutsider();

    const response = await withToken(
      request(application).get(directoryPath()),
      outsider.authenticationToken
    );

    expect(response.status).toBe(200);
    const allEntries = response.body.data.flatMap((group) => group.staff);
    expect(allEntries.length).toBeGreaterThan(0);
    for (const entry of allEntries) {
      // The names and roles are there — that is the point of the directory.
      expect(entry.fullName).toBeTruthy();
      expect(entry.role).toBeTruthy();
      expect(entry.canSeeContacts).toBe(false);
      /*
       * ABSENT, not null. A number that is never serialised cannot leak from a
       * response somebody inspects, and the client hides an action it has no
       * value for.
       */
      expect(entry).not.toHaveProperty("phoneNumber");
      expect(entry).not.toHaveProperty("emailAddress");
    }
  });

  it("filters to one event and includes a parent-scoped coordinator (hierarchy-aware)", async () => {
    const response = await withToken(
      request(application).get(directoryPath(`?eventId=${codeSangram._id}`)),
      coordinator.authenticationToken
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].eventId).toBe(String(codeSangram._id));
    expect(response.body.data[0].staff.some((member) => member.role === "coordinator")).toBe(true);
  });
});
