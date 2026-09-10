import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { MatchModel } from "../../src/models/match-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { CertificateModel } from "../../src/models/certificate-model.js";
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
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const VALID_REASON = "Chess judge disputed round 1; regenerating with new pairings.";

let college;
let admin;
let coordinator;
let fest;
let event;

function eventPath(suffix = "") {
  return `/api/v1/fests/${fest.id}/events/${event.id}${suffix}`;
}

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

async function createConfirmedParticipants(count) {
  const users = [];
  for (let index = 0; index < count; index += 1) {
    const user = await UserModel.create({
      emailAddress: `player${index}@example.com`,
      fullName: `Player ${index}`,
    });
    await RegistrationModel.create({
      eventId: event._id,
      userId: user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
    });
    users.push(user);
  }
  return users;
}

// Generation is admin-only; the setup helper defaults to the admin token.
function generate(token = admin.authenticationToken) {
  return withToken(request(application).post(eventPath("/generate-bracket")), token);
}

function forceRegenerate(body, token = admin.authenticationToken) {
  return withToken(
    request(application).post(eventPath("/bracket/force-regenerate")),
    token
  ).send(body);
}

function liveMatches() {
  return MatchModel.find({
    eventId: event._id,
    status: { $ne: "supersededByRegeneration" },
  }).sort({ roundNumber: 1, matchNumberInRound: 1 });
}

/* Marks one live match as touched, without going through the write endpoints. */
async function stampActivityOnFirstMatch(fields) {
  const [match] = await MatchModel.find({ eventId: event._id, roundNumber: 1, isBye: false }).sort({
    matchNumberInRound: 1,
  });
  Object.assign(match, fields);
  await match.save();
  return match;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    MatchModel.createIndexes(),
    EventModel.createIndexes(),
    UserModel.createIndexes(),
    FestModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    RegistrationModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, {
    scoringFormat: "bracketSingleElimination",
    status: "published",
  });
  coordinator = await createTestStaffMember(fest, "coordinator", {
    assignment: { eventIds: [event._id] },
  });
});

afterAll(teardownTestDatabase);

describe("generating over an untouched bracket", () => {
  it("generates on an empty event", async () => {
    await createConfirmedParticipants(4);
    const response = await generate();

    expect(response.status).toBe(201);
    expect(response.body.data).toHaveLength(3);
  });

  it("rebuilds a bracket nobody has played on and archives the old one", async () => {
    await createConfirmedParticipants(4);
    await generate();
    const originalIds = (await liveMatches()).map((match) => String(match._id));

    const response = await generate();
    expect(response.status).toBe(201);

    const live = await liveMatches();
    expect(live).toHaveLength(3);
    expect(live.map((match) => String(match._id))).not.toEqual(
      expect.arrayContaining(originalIds)
    );

    const archived = await MatchModel.find({
      eventId: event._id,
      status: "supersededByRegeneration",
    });
    expect(archived).toHaveLength(3);

    const auditEntry = await AuditLogModel.findOne({ action: "bracket.regenerated.clean" }).lean();
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.afterState.archivedMatchCount).toBe(3);
  });

  /*
   * The case the brief's version>0 rule would have broken. Six players means two
   * byes, and since 12.9 a bye stamps a version onto the match it advances into
   * — so a bracket nobody has opened already carries versions. None of that is a
   * recorded result, and regeneration must still be allowed.
   */
  it("does not treat byes or the versions they stamp as activity", async () => {
    await createConfirmedParticipants(6);
    await generate();

    const byes = await MatchModel.find({ eventId: event._id, isBye: true });
    expect(byes.length).toBeGreaterThan(0);
    const versioned = await MatchModel.find({ eventId: event._id, version: { $gt: 0 } });
    expect(versioned.length).toBeGreaterThan(byes.length);

    const response = await generate();
    expect(response.status).toBe(201);
  });
});

describe("the activity guard", () => {
  beforeEach(async () => {
    await createConfirmedParticipants(4);
    await generate();
  });

  it("refuses when a match is finalized, and counts it", async () => {
    await stampActivityOnFirstMatch({ isFinalized: true });

    const response = await generate();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BRACKET_HAS_ACTIVITY");
    expect(response.body.error.details.activityCount).toBe(1);
  });

  it("refuses on a half-entered score with no winner yet", async () => {
    await stampActivityOnFirstMatch({ participantAScore: 3 });

    const response = await generate();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BRACKET_HAS_ACTIVITY");
  });

  it("refuses on a scoresheet with no scores", async () => {
    await stampActivityOnFirstMatch({ scoresheetImageUrl: "https://images.example.com/s.jpg" });

    const response = await generate();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BRACKET_HAS_ACTIVITY");
  });

  it("refuses on a declared winner", async () => {
    const [match] = await liveMatches();
    await stampActivityOnFirstMatch({ winnerUserId: match.participantAUserId });

    const response = await generate();
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BRACKET_HAS_ACTIVITY");
  });

  it("refuses an administrator too — the override is a different endpoint", async () => {
    await stampActivityOnFirstMatch({ isFinalized: true });

    const response = await generate(admin.authenticationToken);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BRACKET_HAS_ACTIVITY");
  });

  it("leaves the recorded result untouched when it refuses", async () => {
    const touched = await stampActivityOnFirstMatch({ isFinalized: true, participantAScore: 7 });
    await generate();

    const stored = await MatchModel.findById(touched._id);
    expect(stored.participantAScore).toBe(7);
    expect(stored.status).toBe("active");
    expect(await liveMatches()).toHaveLength(3);
  });
});

describe("force regeneration", () => {
  beforeEach(async () => {
    await createConfirmedParticipants(4);
    await generate();
    await stampActivityOnFirstMatch({ isFinalized: true, participantAScore: 7 });
  });

  it("archives the played bracket and builds a fresh one", async () => {
    const versionsBefore = new Map(
      (await liveMatches()).map((match) => [String(match._id), match.version])
    );

    const response = await forceRegenerate({ regenerationReason: VALID_REASON });
    expect(response.status).toBe(200);

    const archived = await MatchModel.find({
      eventId: event._id,
      status: "supersededByRegeneration",
    });
    expect(archived).toHaveLength(3);
    for (const match of archived) {
      expect(match.supersededAt).toBeTruthy();
      expect(String(match.supersededByUserId)).toBe(String(admin.user._id));
      /*
       * Superseding is a mutation like any other, so it bumps the version and
       * names its author. 12.9's invariant — no match changes without a version
       * bump — has no exception, and this bulk write was the one place it did.
       */
      expect(match.version).toBe(versionsBefore.get(String(match._id)) + 1);
      expect(String(match.lastUpdatedByUserId)).toBe(String(admin.user._id));
    }

    /* The result itself survives inside the archive — that is the whole point. */
    const keptResult = archived.find((match) => match.participantAScore === 7);
    expect(keptResult).toBeTruthy();
    expect(keptResult.isFinalized).toBe(true);

    const live = await liveMatches();
    expect(live).toHaveLength(3);
    expect(live.every((match) => !match.isFinalized)).toBe(true);
  });

  it("logs the reason and what it buried", async () => {
    await forceRegenerate({ regenerationReason: VALID_REASON });

    const auditEntry = await AuditLogModel.findOne({ action: "bracket.forceRegenerated" }).lean();
    expect(auditEntry).toBeTruthy();
    expect(auditEntry.afterState.regenerationReason).toBe(VALID_REASON);
    expect(auditEntry.afterState.archivedMatchCount).toBe(3);
    expect(String(auditEntry.actorUserId)).toBe(String(admin.user._id));
  });

  it("refuses a missing reason", async () => {
    const response = await forceRegenerate({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("REGENERATION_REASON_REQUIRED");
  });

  it("refuses a reason under ten characters", async () => {
    const response = await forceRegenerate({ regenerationReason: "oops" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("REGENERATION_REASON_REQUIRED");
  });

  it("refuses whitespace padded into a reason", async () => {
    const response = await forceRegenerate({ regenerationReason: "          " });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("REGENERATION_REASON_REQUIRED");
  });

  it("archives nothing when it refuses the reason", async () => {
    await forceRegenerate({ regenerationReason: "no" });

    const archived = await MatchModel.countDocuments({
      eventId: event._id,
      status: "supersededByRegeneration",
    });
    expect(archived).toBe(0);
  });

  it("refuses a coordinator of the event", async () => {
    const response = await forceRegenerate(
      { regenerationReason: VALID_REASON },
      coordinator.authenticationToken
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("refuses an outsider", async () => {
    const outsider = await createTestOutsider();
    const response = await forceRegenerate(
      { regenerationReason: VALID_REASON },
      outsider.authenticationToken
    );
    expect(response.status).toBe(403);
  });
});

describe("reading a regenerated bracket", () => {
  beforeEach(async () => {
    await createConfirmedParticipants(4);
    await generate();
    await stampActivityOnFirstMatch({ isFinalized: true });
    await forceRegenerate({ regenerationReason: VALID_REASON });
  });

  it("shows only the live bracket by default", async () => {
    const response = await withToken(
      request(application).get(eventPath("/bracket")),
      coordinator.authenticationToken
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data.every((match) => match.status === "active")).toBe(true);
  });

  it("opens the archive to an administrator who asks", async () => {
    const response = await withToken(
      request(application).get(eventPath("/bracket?includeSuperseded=true")),
      admin.authenticationToken
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(6);
    expect(
      response.body.data.filter((match) => match.status === "supersededByRegeneration")
    ).toHaveLength(3);
  });

  /*
   * The flag is an admin surface. A coordinator setting it by hand gets the live
   * bracket rather than an error: they asked for something not theirs to see.
   */
  it("ignores the archive flag for a coordinator", async () => {
    const response = await withToken(
      request(application).get(eventPath("/bracket?includeSuperseded=true")),
      coordinator.authenticationToken
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(3);
  });

  it("will not accept a write to an archived match", async () => {
    const [archived] = await MatchModel.find({
      eventId: event._id,
      status: "supersededByRegeneration",
      isBye: false,
    });

    const response = await withToken(
      request(application).patch(eventPath(`/matches/${archived._id}`)),
      admin.authenticationToken
    ).send({ winnerUserId: String(archived.participantAUserId), expectedVersion: archived.version });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("MATCH_NOT_FOUND");
  });
});

describe("certificates outlive the bracket that earned them", () => {
  it("does not touch certificates when a bracket is force regenerated", async () => {
    const [firstPlayer] = await createConfirmedParticipants(4);
    await generate();
    await stampActivityOnFirstMatch({ isFinalized: true });

    await CertificateModel.create({
      userId: firstPlayer._id,
      eventId: event._id,
      festId: fest._id,
      certificateType: "participation",
      verificationCode: "ABC12345",
      metadata: { recipientFullName: firstPlayer.fullName, eventName: event.eventName },
    });
    const countBefore = await CertificateModel.countDocuments({ eventId: event._id });

    const response = await forceRegenerate({ regenerationReason: VALID_REASON });
    expect(response.status).toBe(200);

    expect(await CertificateModel.countDocuments({ eventId: event._id })).toBe(countBefore);
  });
});
