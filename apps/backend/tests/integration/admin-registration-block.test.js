import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
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
  createTestStaffMember,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let soloEvent;
let teamEvent;
let participant;

function soloPath(eventId) {
  return `/api/v1/events/${eventId}/registrations/solo`;
}
function teamPath(eventId) {
  return `/api/v1/events/${eventId}/registrations/team`;
}

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

/*
 * The administrator fixture has no participant profile, and an incomplete profile
 * is refused before registration is even considered — which would mask the block
 * under PROFILE_INCOMPLETE. Giving the administrator a complete profile proves the
 * refusal is the admin rule itself and not a side effect of a half-filled account.
 */
async function completeProfileFor(user) {
  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        fullName: "Admin Person",
        collegeId: college._id,
        usn: "1AA00AA111",
        isProfileComplete: true,
      },
    }
  );
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  await completeProfileFor(admin.user);

  fest = await createTestFest(college, admin.user, { status: "published" });
  soloEvent = await createTestEvent(fest, admin.user, {
    ...openRegistrationOverrides(),
    eventType: "solo",
  });
  teamEvent = await createTestEvent(fest, admin.user, {
    ...openRegistrationOverrides(),
    eventSlug: "team-event-2027",
    eventName: "Team Event 2027",
    eventType: "team",
    minimumTeamSize: 2,
    maximumTeamSize: 4,
  });
  participant = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

describe("administrators cannot take a registration seat", () => {
  it("refuses a solo registration by an administrator", async () => {
    const response = await withToken(
      request(application).post(soloPath(soloEvent._id)),
      admin.authenticationToken
    ).send({});

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ADMIN_CANNOT_REGISTER");
    expect(await RegistrationModel.countDocuments({ userId: admin.user._id })).toBe(0);
  });

  it("refuses a team registration led by an administrator", async () => {
    const response = await withToken(
      request(application).post(teamPath(teamEvent._id)),
      admin.authenticationToken
    ).send({ teamName: "Admin Squad", memberEmails: [participant.user.emailAddress] });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ADMIN_CANNOT_REGISTER");
    expect(await RegistrationModel.countDocuments({})).toBe(0);
  });

  /*
   * The roster case: a participant, not the administrator, makes this call. Naming
   * an administrator in memberEmails is the only "join a team" path this codebase
   * has, so it is the one a block on the caller alone would miss entirely.
   */
  it("refuses a team whose roster names an administrator, and says which one", async () => {
    const response = await withToken(
      request(application).post(teamPath(teamEvent._id)),
      participant.authenticationToken
    ).send({ teamName: "Sneaky", memberEmails: [admin.user.emailAddress] });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ADMIN_CANNOT_REGISTER");
    expect(response.body.error.details.administratorEmail).toBe(admin.user.emailAddress);
    expect(await RegistrationModel.countDocuments({})).toBe(0);
  });
});

describe("everyone else registers normally", () => {
  it("lets a plain participant register solo", async () => {
    const response = await withToken(
      request(application).post(soloPath(soloEvent._id)),
      participant.authenticationToken
    ).send({});

    expect(response.status).toBe(201);
    expect(await RegistrationModel.countDocuments({ userId: participant.user._id })).toBe(1);
  });

  /* A coordinator is a student first; only the administrator role bars a seat. */
  it("lets a coordinator register solo", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "coord-student@example.com",
    });
    await UserModel.updateOne(
      { _id: coordinator.user._id },
      {
        $set: {
          fullName: "Coordinator Student",
          collegeId: college._id,
          usn: "1AA00AA222",
          isProfileComplete: true,
        },
      }
    );

    const response = await withToken(
      request(application).post(soloPath(soloEvent._id)),
      coordinator.authenticationToken
    ).send({});

    expect(response.status).toBe(201);
    expect(await RegistrationModel.countDocuments({ userId: coordinator.user._id })).toBe(1);
  });
});

/*
 * Cancel stays open to an administrator. After the data cleanup an administrator
 * holds no registrations, so this is defensive: if one somehow exists, the block
 * on creating must not also strand it as uncancellable.
 */
describe("the block does not extend to cancelling", () => {
  it("does not refuse an administrator's cancel with ADMIN_CANNOT_REGISTER", async () => {
    const response = await withToken(
      request(application).post(`/api/v1/events/${soloEvent._id}/registrations/mine/cancel`),
      admin.authenticationToken
    ).send({});

    expect(response.status).not.toBe(403);
    expect(response.body.error?.code).not.toBe("ADMIN_CANNOT_REGISTER");
  });
});
