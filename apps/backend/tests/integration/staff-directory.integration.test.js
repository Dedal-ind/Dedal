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
       * Contact details are shown to a registered participant - reaching the
       * person running your event is the whole purpose. The gate is what
       * limits who sees them; there is no second tier inside the response.
       */
      expect(entry).toHaveProperty("phoneNumber");
      expect(entry).toHaveProperty("emailAddress");
      expect(entry.fullName).toBe("Coordinator One");
    }
  });

  /*
   * THE GATE, REINSTATED. This assertion has been both ways round and the
   * service header records why; what matters here is that the directory is a
   * list of named students annotated with where they will be, and an account
   * costs an email address. A signed-in stranger is still a stranger.
   */
  it("refuses a signed-in user with no registration and no assignment", async () => {
    const outsider = await createTestOutsider();

    const response = await withToken(
      request(application).get(directoryPath()),
      outsider.authenticationToken
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("refuses a participant whose only registration is not confirmed", async () => {
    /*
     * A pendingPayment row is an intent to attend, not attendance, and anyone
     * can self-issue one by starting a checkout and walking away. If it opened
     * the directory the gate would be decorative.
     */
    const participant = await createTestParticipant(college, {
      emailAddress: "paused@example.com",
      usn: "1AN00DD001",
    });
    await RegistrationModel.create({
      eventId: codeSangram._id,
      userId: participant.user._id,
      status: "pendingPayment",
      feeAmountSnapshotPaise: 0,
    });

    const response = await withToken(
      request(application).get(directoryPath()),
      participant.authenticationToken
    );

    expect(response.status).toBe(403);
  });

  it("returns a directory entry and nothing that identifies the crew member further", async () => {
    /*
     * The payload is deliberately four fields. An id that is never serialised
     * cannot be used to enumerate anything, and this is a list of people to
     * contact rather than a set of links into their profiles.
     */
    const participant = await createTestParticipant(college, {
      emailAddress: "reader@example.com",
      usn: "1AN00EE001",
    });
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
    const entry = response.body.data.flatMap((group) => group.staff)[0];
    expect(Object.keys(entry).sort()).toEqual([
      "emailAddress",
      "fullName",
      "phoneNumber",
      "role",
    ]);
  });

  it("puts coordinators before volunteers and sorts each role by name", async () => {
    const participant = await createTestParticipant(college, {
      emailAddress: "sorter@example.com",
      usn: "1AN00FF001",
    });
    await RegistrationModel.create({
      eventId: shastra._id,
      userId: participant.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
    });

    /* Added out of order on purpose - Zara before Alice, volunteer before the
       second coordinator - so a passing result cannot be insertion order. */
    const zara = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "zara@example.com",
      assignment: { eventIds: [shastra._id] },
    });
    await UserModel.updateOne({ _id: zara.user._id }, { fullName: "Zara Volunteer" });
    const alice = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "alice@example.com",
      assignment: { eventIds: [shastra._id] },
    });
    await UserModel.updateOne({ _id: alice.user._id }, { fullName: "Alice Volunteer" });
    const aaron = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "aaron@example.com",
      assignment: { eventIds: [shastra._id] },
    });
    await UserModel.updateOne({ _id: aaron.user._id }, { fullName: "Aaron Coordinator" });

    const response = await withToken(
      request(application).get(directoryPath(`?eventId=${shastra._id}`)),
      participant.authenticationToken
    );

    expect(response.status).toBe(200);
    const staff = response.body.data[0].staff;
    expect(staff.map((member) => member.role)).toEqual([
      "coordinator",
      "coordinator",
      "volunteer",
      "volunteer",
    ]);
    expect(staff.map((member) => member.fullName)).toEqual([
      "Aaron Coordinator",
      "Coordinator One",
      "Alice Volunteer",
      "Zara Volunteer",
    ]);
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
