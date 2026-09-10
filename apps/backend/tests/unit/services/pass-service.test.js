import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import passService from "../../../src/services/pass-service.js";
import { PassModel } from "../../../src/models/pass-model.js";
import { EntitlementModel } from "../../../src/models/entitlement-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestParticipant,
} from "../../setup/create-test-fixtures.js";

const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let fest;
let event;
let participant;

async function expectError(promise, errorCode, statusCode) {
  await expect(promise).rejects.toMatchObject({ errorCode, statusCode });
}

function eventEntryFilter(passId, referenceId) {
  return { passId, entitlementType: "eventEntry", referenceId, status: "active" };
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
    FestModel.createIndexes(),
    EventModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user);
  participant = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

describe("getOrCreatePassForUserInFest", () => {
  it("creates a pass with a 32-char token and an auto gateAccess entitlement", async () => {
    const pass = await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);

    expect(pass.qrToken).toHaveLength(32);
    expect(pass.status).toBe("active");
    const gate = await EntitlementModel.findOne({ passId: pass._id, entitlementType: "gateAccess" });
    expect(gate.maximumUses).toBe(null);
    expect(gate.source).toBe("manualGrant");
    expect(gate.validFrom.toISOString()).toBe(fest.startsOn.toISOString());
  });

  it("returns the existing pass on a second call without creating another", async () => {
    const first = await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);
    const second = await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);

    expect(second.id).toBe(first.id);
    expect(await PassModel.countDocuments({ userId: participant.user._id })).toBe(1);
  });

  it("resolves both racers to one pass and one gateAccess on a concurrent get-or-create", async () => {
    // Two events in the same fest register at the same instant: both calls read
    // no pass, both insert, and the loser trips the userId+festId unique index.
    const [first, second] = await Promise.all([
      passService.getOrCreatePassForUserInFest(participant.user._id, fest.id),
      passService.getOrCreatePassForUserInFest(participant.user._id, fest.id),
    ]);

    expect(first.id).toBe(second.id);
    expect(await PassModel.countDocuments({ userId: participant.user._id, festId: fest.id })).toBe(1);
    // The losing racer must not double-insert the gateAccess entitlement.
    expect(await EntitlementModel.countDocuments({ passId: first._id, entitlementType: "gateAccess" })).toBe(1);
  });

  it("self-heals gate access when the entitlement insert failed on an earlier call", async () => {
    // The pass row lands, then the entitlement insert throws once (a transient DB
    // failure). Spy both insert paths so the test is agnostic to insertMany vs create.
    const insertManySpy = vi
      .spyOn(EntitlementModel, "insertMany")
      .mockRejectedValueOnce(new Error("transient DB failure"));
    const createSpy = vi
      .spyOn(EntitlementModel, "create")
      .mockRejectedValueOnce(new Error("transient DB failure"));

    await expect(
      passService.getOrCreatePassForUserInFest(participant.user._id, fest.id)
    ).rejects.toThrow();

    // The pass was created, but it is stranded with no gate access.
    const strandedPass = await PassModel.findOne({ userId: participant.user._id, festId: fest.id });
    expect(strandedPass).not.toBe(null);
    expect(
      await EntitlementModel.countDocuments({ passId: strandedPass._id, entitlementType: "gateAccess" })
    ).toBe(0);

    insertManySpy.mockRestore();
    createSpy.mockRestore();

    // The next call must repair the missing entitlement rather than fast-pathing past it.
    const healed = await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);
    expect(healed.id).toBe(strandedPass.id);
    expect(
      await EntitlementModel.countDocuments({
        passId: strandedPass._id,
        entitlementType: "gateAccess",
        status: "active",
      })
    ).toBe(1);
  });

  it("throws FEST_NOT_FOUND for a missing fest", async () => {
    await expectError(passService.getOrCreatePassForUserInFest(participant.user._id, MISSING_ID), "FEST_NOT_FOUND", 404);
  });
});

describe("ensurePassAndEventEntitlement", () => {
  it("creates the pass and an eventEntry entitlement with fields from the event", async () => {
    const entitlement = await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);

    expect(entitlement.entitlementType).toBe("eventEntry");
    expect(entitlement.maximumUses).toBe(1);
    expect(entitlement.source).toBe("registration");
    // Open-ended by design: an event-entry door admits people before the event
    // starts (see resolveEventEntitlementWindow), so validFrom is null.
    expect(entitlement.validFrom).toBe(null);
    expect(String(entitlement.referenceId)).toBe(event.id);
  });

  it("is idempotent: a second call reuses the pass and the entitlement", async () => {
    const first = await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);
    const second = await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);

    expect(second.id).toBe(first.id);
    expect(await PassModel.countDocuments()).toBe(1);
    expect(await EntitlementModel.countDocuments(eventEntryFilter(first.passId, event._id))).toBe(1);
  });

  it("creates a fresh active entitlement after the previous one was revoked", async () => {
    const first = await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);
    await passService.revokeEventEntitlementOnCancel(participant.user._id, fest.id, event.id);

    const third = await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);
    expect(third.id).not.toBe(first.id);
    expect(third.status).toBe("active");
    expect(await EntitlementModel.countDocuments(eventEntryFilter(first.passId, event._id))).toBe(1);
  });

  it("resolves both racers to a single active entitlement on a concurrent ensure", async () => {
    // Two registration writes for the same user/event race past the find-then-create
    // pre-check; the partial unique index must let only one active row survive.
    const [first, second] = await Promise.all([
      passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id),
      passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id),
    ]);

    expect(first.id).toBe(second.id);

    const pass = await PassModel.findOne({ userId: participant.user._id, festId: fest.id });
    const activeRegistrationCount = await EntitlementModel.countDocuments({
      passId: pass._id,
      entitlementType: "eventEntry",
      referenceId: event._id,
      source: "registration",
      status: "active",
    });
    expect(activeRegistrationCount).toBe(1);
  });

  it("creates a registration entitlement alongside a manual-grant one for the same event", async () => {
    // The partial filter is scoped to source=registration, so a manual grant (a
    // documented re-do) does not block the registration-driven row — both coexist.
    const pass = await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);
    const manual = await EntitlementModel.create({
      passId: pass._id,
      entitlementType: "eventEntry",
      referenceId: event._id,
      maximumUses: 1,
      ...passService.resolveEventEntitlementWindow(event),
      source: "manualGrant",
    });

    const registrationEntitlement = await passService.ensurePassAndEventEntitlement(
      participant.user._id,
      fest.id,
      event.id
    );

    expect(registrationEntitlement.id).not.toBe(manual.id);
    expect(registrationEntitlement.source).toBe("registration");
    const activeCount = await EntitlementModel.countDocuments({
      passId: pass._id,
      entitlementType: "eventEntry",
      referenceId: event._id,
      status: "active",
    });
    expect(activeCount).toBe(2);
  });

  it("throws EVENT_NOT_FOUND for a missing event", async () => {
    await expectError(passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, MISSING_ID), "EVENT_NOT_FOUND", 404);
  });
});

describe("revokeEventEntitlementOnCancel", () => {
  it("flips an active entitlement to revoked without deleting it", async () => {
    await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);
    const revoked = await passService.revokeEventEntitlementOnCancel(participant.user._id, fest.id, event.id);

    expect(revoked.status).toBe("revoked");
    expect(await EntitlementModel.countDocuments({ entitlementType: "eventEntry" })).toBe(1);
  });

  it("revokes only the registration-sourced row, leaving a coexisting manual grant active", async () => {
    const pass = await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);
    await EntitlementModel.create({
      passId: pass._id,
      entitlementType: "eventEntry",
      referenceId: event._id,
      maximumUses: 1,
      ...passService.resolveEventEntitlementWindow(event),
      source: "manualGrant",
    });
    const registration = await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);

    const returned = await passService.revokeEventEntitlementOnCancel(participant.user._id, fest.id, event.id);

    expect(returned.source).toBe("registration");
    // Assert by source field, not insertion order — pre-fix the match is non-deterministic.
    const registrationRow = await EntitlementModel.findById(registration._id);
    const manualRow = await EntitlementModel.findOne({
      passId: pass._id,
      entitlementType: "eventEntry",
      referenceId: event._id,
      source: "manualGrant",
    });
    expect(registrationRow.status).toBe("revoked");
    expect(manualRow.status).toBe("active");
  });

  it("returns null when the user has no pass yet", async () => {
    const result = await passService.revokeEventEntitlementOnCancel(participant.user._id, fest.id, event.id);
    expect(result).toBe(null);
  });

  it("re-cuts active gate-access windows to the fest's new dates on reschedule", async () => {
    const pass = await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);
    const newStart = new Date("2030-01-01T00:00:00.000Z");
    const newEnd = new Date("2030-01-05T00:00:00.000Z");
    fest.startsOn = newStart;
    fest.endsOn = newEnd;
    await fest.save();

    const modifiedCount = await passService.refreshGateAccessWindowsForFest(fest);
    expect(modifiedCount).toBe(1);

    const gate = await EntitlementModel.findOne({ passId: pass._id, entitlementType: "gateAccess" });
    expect(gate.validFrom.toISOString()).toBe(newStart.toISOString());
    expect(gate.validTo.toISOString()).toBe(newEnd.toISOString());
  });

  it("returns the already-revoked entitlement unchanged on a second call", async () => {
    await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);
    await passService.revokeEventEntitlementOnCancel(participant.user._id, fest.id, event.id);
    const again = await passService.revokeEventEntitlementOnCancel(participant.user._id, fest.id, event.id);

    expect(again.status).toBe("revoked");
  });
});

describe("getMyPass and getMyPasses", () => {
  it("returns a wrapped shape with only active entitlements", async () => {
    await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, event.id);
    const secondEvent = await createTestEvent(fest, admin.user, { eventSlug: "second" });
    await passService.ensurePassAndEventEntitlement(participant.user._id, fest.id, secondEvent.id);
    await passService.revokeEventEntitlementOnCancel(participant.user._id, fest.id, secondEvent.id);

    const result = await passService.getMyPass(participant.user._id, fest.id);
    expect(result.pass.qrToken).toHaveLength(32);
    expect(result.fest.festName).toBe("Alliance ONE 2027");
    expect(result.user.emailAddress).toBe(participant.user.emailAddress);
    // gateAccess + one active eventEntry; the revoked one is filtered out.
    expect(result.entitlements).toHaveLength(2);
  });

  it("throws PASS_NOT_FOUND when the user has no pass for the fest", async () => {
    await expectError(passService.getMyPass(participant.user._id, fest.id), "PASS_NOT_FOUND", 404);
  });

  it("throws PASS_NOT_FOUND when the user's only pass is revoked", async () => {
    const pass = await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);
    await PassModel.updateOne({ _id: pass._id }, { status: "revoked" });

    await expectError(passService.getMyPass(participant.user._id, fest.id), "PASS_NOT_FOUND", 404);
  });

  it("lists active passes sorted by fest start, excluding non-active passes", async () => {
    const laterFest = await createTestFest(college, admin.user, {
      festSlug: "later",
      festName: "Later Fest",
      status: "published",
      startsOn: new Date("2027-09-01T00:00:00.000Z"),
      endsOn: new Date("2027-09-05T00:00:00.000Z"),
    });
    await passService.getOrCreatePassForUserInFest(participant.user._id, laterFest.id);
    await passService.getOrCreatePassForUserInFest(participant.user._id, fest.id);

    const revokedFest = await createTestFest(college, admin.user, { festSlug: "gone", festName: "Gone", status: "published" });
    const revokedPass = await passService.getOrCreatePassForUserInFest(participant.user._id, revokedFest.id);
    await PassModel.findByIdAndUpdate(revokedPass._id, { status: "revoked" });

    const passes = await passService.getMyPasses(participant.user._id);
    // Sorted by fest.startsOn asc; the revoked pass is excluded.
    expect(passes.map((entry) => entry.fest.festName)).toEqual(["Alliance ONE 2027", "Later Fest"]);
  });
});
