import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
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
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let fest;
let coordinator;
let codeSangram;
let astraCode;
let notUnderShastra;

function participantsPath(eventId) {
  return `/api/v1/fests/${fest.id}/events/${eventId}/participants`;
}

function asCoordinator(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${coordinator.authenticationToken}`);
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  const college = await createTestCollege();
  const admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });

  const shastra = await createTestEvent(fest, admin.user, {
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
  const ranShastra = await createTestEvent(fest, admin.user, {
    eventSlug: "ranshastra",
    eventName: "RanShastra",
    status: "published",
    parentEventId: shastra._id,
  });
  astraCode = await createTestEvent(fest, admin.user, {
    eventSlug: "astracode",
    eventName: "AstraCode",
    status: "published",
    parentEventId: ranShastra._id,
  });
  notUnderShastra = await createTestEvent(fest, admin.user, {
    eventSlug: "not-under",
    eventName: "Standalone",
    status: "published",
  });

  // Coordinator scoped to the Shastra vertical only.
  coordinator = await createTestStaffMember(fest, "coordinator", {
    assignment: { eventIds: [shastra._id] },
  });
});

afterAll(teardownTestDatabase);

describe("hierarchy-aware coordinator coverage", () => {
  it("admits a Shastra coordinator to a direct child event (CodeSangram)", async () => {
    const response = await asCoordinator(request(application).get(participantsPath(codeSangram._id)));
    expect(response.status).toBe(200);
  });

  it("refuses the same coordinator on an event outside Shastra", async () => {
    const response = await asCoordinator(
      request(application).get(participantsPath(notUnderShastra._id))
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("admits the coordinator to a grandchild event (AstraCode under RanShastra under Shastra)", async () => {
    const response = await asCoordinator(request(application).get(participantsPath(astraCode._id)));
    expect(response.status).toBe(200);
  });
});
