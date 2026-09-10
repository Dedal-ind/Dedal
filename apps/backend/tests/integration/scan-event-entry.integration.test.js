import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { ScanModel } from "../../src/models/scan-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
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
  createTestParticipant,
  createTestStaffMember,
  buildEventAttributes,
  createTestGateCheckIn,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();

/*
 * Production code, not fixtures. That is the entire point of this file: the two
 * halves of the event-door flow were each tested in isolation and each passed,
 * because the fixture that joined them in tests minted an entitlement window
 * production could never produce. Everything here goes through the real
 * registration service, the real checkpoint helper and the real scan service, so
 * whatever window production actually writes is the window under test.
 */
const registrationService = await import("../../src/services/registration-service.js");
const { ensureEventEntryCheckpoint, ensureGateCheckpoint } = await import(
  "../../src/helpers/checkpoint-helpers.js"
);
const { application } = await import("../../src/application.js");

const QR_SCAN_PATH = "/api/v1/scans/qr";
const HOUR_MS = 60 * 60 * 1000;

let college;
let admin;
let fest;
let event;
let otherEvent;
let participant;
let otherParticipant;
let volunteer;
let eventCheckpoint;
let gateCheckpoint;
let scanCounter = 0;

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * HOUR_MS);
}

function nextClientScanId() {
  scanCounter += 1;
  return `event-entry-scan-${String(scanCounter).padStart(4, "0")}`;
}

async function passFor(user) {
  return PassModel.findOne({ userId: user._id, festId: fest._id });
}

/*
 * scannedAt is what the device claims; the decision reads the server clock, so
 * these scans are always "now" as far as the entitlement window is concerned.
 */
async function scanAt(checkpoint, user) {
  const pass = await passFor(user);
  return request(application)
    .post(QR_SCAN_PATH)
    .set("Authorization", `Bearer ${volunteer.authenticationToken}`)
    .send({
      qrToken: pass.qrToken,
      checkpointId: String(checkpoint._id),
      clientScanId: nextClientScanId(),
      direction: "in",
      scannedAt: new Date().toISOString(),
    });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
    ScanModel.createIndexes(),
    CheckpointModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    RegistrationModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
  ]);
});

/*
 * The fest is live now and the event is six hours out: a participant arriving at
 * a door that has not opened yet is the ordinary case, not an edge case.
 */
beforeEach(async () => {
  await clearAllCollections();
  scanCounter = 0;

  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, {
    status: "published",
    startsOn: hoursFromNow(-24),
    endsOn: hoursFromNow(72),
  });

  const eventWindow = {
    status: "published",
    registrationOpensAt: hoursFromNow(-12),
    registrationClosesAt: hoursFromNow(5),
    startsAt: hoursFromNow(6),
    endsAt: hoursFromNow(9),
  };
  event = await EventModel.create({
    ...buildEventAttributes(),
    ...eventWindow,
    eventSlug: "robowars-2027",
    festId: fest._id,
    createdByUserId: admin.user._id,
  });
  otherEvent = await EventModel.create({
    ...buildEventAttributes(),
    ...eventWindow,
    eventName: "Chess Knockout",
    eventSlug: "chess-knockout",
    festId: fest._id,
    createdByUserId: admin.user._id,
  });

  eventCheckpoint = await ensureEventEntryCheckpoint(fest._id, event._id, event.eventName);
  gateCheckpoint = await ensureGateCheckpoint(fest._id);

  participant = await createTestParticipant(college);
  otherParticipant = await createTestParticipant(college, {
    emailAddress: "other-participant@example.com",
    usn: "1AA00AA001",
  });
  volunteer = await createTestStaffMember(fest, "volunteer");

  await registrationService.registerParticipantSolo(participant.user._id, String(event._id));
  await registrationService.registerParticipantSolo(
    otherParticipant.user._id,
    String(otherEvent._id)
  );

  /*
   * An event door now refuses anyone who has not crossed the Main Gate today —
   * you cannot be at a door inside the campus without having entered it. These
   * tests are about the DOOR's own rules (windows, single use, wrong event), so
   * both participants are put on campus first; the campus rule itself is
   * covered by its own test below.
   */
  for (const person of [participant, otherParticipant]) {
    const theirPass = await PassModel.findOne({ userId: person.user._id, festId: fest._id });
    if (theirPass) {
      await createTestGateCheckIn(theirPass);
    }
  }
});

afterAll(teardownTestDatabase);

describe("scanning at an event door", () => {
  /*
   * The regression test for the audit's C1. A door exists to admit people before
   * the thing starts; an entitlement that only opens at startsAt is useless at
   * exactly the moment it is needed. Against the pre-fix code this returns
   * rejectedExpired, because validFrom was event.startsAt and now is six hours
   * short of it.
   */
  it("admits a registered participant who arrives before the event starts", async () => {
    const response = await scanAt(eventCheckpoint, participant.user);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("accepted");
  });

  it("admits a registered participant once the event is under way", async () => {
    await EventModel.updateOne(
      { _id: event._id },
      { $set: { startsAt: hoursFromNow(-1), endsAt: hoursFromNow(2) } }
    );

    const response = await scanAt(eventCheckpoint, participant.user);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("accepted");
  });

  /*
   * The trailing bound still has to bite, or the entitlement never expires at
   * all. The registration is made while the event is still ahead — the real
   * ordering — and only then is the clock moved past the grace.
   */
  it("refuses a scan well after the event and its grace have passed", async () => {
    const entitlement = await EntitlementModel.findOne({ entitlementType: "eventEntry" });
    await EntitlementModel.updateOne(
      { _id: entitlement._id },
      { $set: { validTo: hoursFromNow(-1) } }
    );

    const response = await scanAt(eventCheckpoint, participant.user);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("rejectedExpired");
  });

  it("refuses a second scan of the same single-use entitlement", async () => {
    const first = await scanAt(eventCheckpoint, participant.user);
    expect(first.body.data.result).toBe("accepted");

    const second = await scanAt(eventCheckpoint, participant.user);

    expect(second.status).toBe(200);
    expect(second.body.data.result).toBe("rejectedAlreadyUsed");
  });

  /*
   * The entitlement is scoped to the event it was earned at, not to the fest.
   * Someone registered for Chess must not walk into Robowars on the strength of
   * it — this is the check that would fail if referenceId scoping ever broke.
   */
  it("refuses a participant registered for a different event", async () => {
    const response = await scanAt(eventCheckpoint, otherParticipant.user);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("rejectedNoEntitlement");
  });
});

describe("the gate is unaffected by the event-door rule", () => {
  it("admits the same participant at the gate before the event starts", async () => {
    const response = await scanAt(gateCheckpoint, participant.user);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("accepted");
  });

  it("admits a participant at the gate whatever event they hold", async () => {
    const response = await scanAt(gateCheckpoint, otherParticipant.user);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("accepted");
  });
});
