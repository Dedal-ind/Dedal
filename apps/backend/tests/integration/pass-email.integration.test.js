import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { PassModel } from "../../src/models/pass-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { TeamModel } from "../../src/models/team-model.js";
import {
  installEmailServiceMock,
  findRecordedEmailsOfKind,
  clearRecordedEmails,
  setPassDeliveryResult,
} from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
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
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let soloEvent;
let teamEvent;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  soloEvent = await createTestEvent(fest, admin.user, {
    status: "published",
    eventType: "solo",
    feeType: "free",
    feeAmountPaise: 0,
    ...openRegistrationOverrides(),
  });
  teamEvent = await createTestEvent(fest, admin.user, {
    eventSlug: "team-event",
    eventName: "Team Event",
    status: "published",
    eventType: "team",
    feeType: "free",
    feeAmountPaise: 0,
    minimumTeamSize: 2,
    maximumTeamSize: 4,
    ...openRegistrationOverrides(),
  });
});

describe("pass email on registration", () => {
  it("solo registration emails the pass once, stamps passEmailSentAt, and does not resend for a second event", async () => {
    const participant = await createTestParticipant(college, {
      emailAddress: "pass-solo@example.com",
      fullName: "Pass Solo",
      phoneNumber: "+91 90000 00001",
    });

    const first = await withToken(
      request(application).post(`/api/v1/events/${soloEvent.id}/registrations/solo`),
      participant.authenticationToken
    ).send({});
    expect(first.status).toBe(201);

    const passEmails = findRecordedEmailsOfKind("pass");
    expect(passEmails).toHaveLength(1);
    expect(passEmails[0]).toMatchObject({
      emailAddress: "pass-solo@example.com",
      fullName: "Pass Solo",
      phoneNumber: "+91 90000 00001",
      festName: fest.festName,
    });
    // The event list comes from the ACTIVE eventEntry entitlements, which only
    // exist because the send happens after the entitlement is written.
    expect(passEmails[0].eventNames).toContain(soloEvent.eventName);
    expect(passEmails[0].qrToken).toBeTruthy();

    const passRow = await PassModel.findOne({ userId: participant.user._id }).lean();
    expect(passRow.passEmailSentAt).not.toBeNull();

    // A second registration in the SAME fest must not send a second pass email.
    const secondEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "second-solo-event",
      eventName: "Second Solo Event",
      status: "published",
      eventType: "solo",
      feeType: "free",
      feeAmountPaise: 0,
      ...openRegistrationOverrides(),
    });
    const second = await withToken(
      request(application).post(`/api/v1/events/${secondEvent.id}/registrations/solo`),
      participant.authenticationToken
    ).send({});
    expect(second.status).toBe(201);
    expect(findRecordedEmailsOfKind("pass")).toHaveLength(1);
  });

  it("team create and team code join each email their own holder", async () => {
    const leader = await createTestParticipant(college, {
      emailAddress: "team-leader@example.com",
      fullName: "Team Leader",
      usn: "1AA00AA900",
      phoneNumber: "+91 90000 00002",
    });
    const joiner = await createTestParticipant(college, {
      emailAddress: "team-joiner@example.com",
      fullName: "Team Joiner",
      usn: "1AA00AA901",
      phoneNumber: "+91 90000 00003",
    });

    const created = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(teamEvent._id), teamName: "The Pass Testers" });
    expect(created.status).toBe(201);
    expect(findRecordedEmailsOfKind("pass").map((row) => row.emailAddress)).toEqual([
      "team-leader@example.com",
    ]);

    // Read the code from the row rather than the DTO: the join is what is under
    // test here, not the shape of the create response.
    const teamRow = await TeamModel.findOne({ eventId: teamEvent._id }).lean();
    const inviteCode = teamRow.inviteCode;
    const joined = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode });
    expect(joined.status).toBe(200);

    // BOTH members hold a pass and BOTH were emailed — the client's complaint
    // was that only the team creator got one.
    const recipients = findRecordedEmailsOfKind("pass").map((row) => row.emailAddress).sort();
    expect(recipients).toEqual(["team-joiner@example.com", "team-leader@example.com"]);

    const joinerPass = await PassModel.findOne({ userId: joiner.user._id }).lean();
    expect(joinerPass).not.toBeNull();
    expect(joinerPass.passEmailSentAt).not.toBeNull();
  });

  it("a failed send releases the stamp so the next registration retries", async () => {
    const participant = await createTestParticipant(college, {
      emailAddress: "pass-retry@example.com",
      phoneNumber: "+91 90000 00004",
    });
    setPassDeliveryResult(false);

    await withToken(
      request(application).post(`/api/v1/events/${soloEvent.id}/registrations/solo`),
      participant.authenticationToken
    ).send({});
    const passAfterFailure = await PassModel.findOne({ userId: participant.user._id }).lean();
    expect(passAfterFailure.passEmailSentAt).toBeNull(); // claim released, will retry

    setPassDeliveryResult(true);
    const secondEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "retry-event",
      eventName: "Retry Event",
      status: "published",
      eventType: "solo",
      feeType: "free",
      feeAmountPaise: 0,
      ...openRegistrationOverrides(),
    });
    await withToken(
      request(application).post(`/api/v1/events/${secondEvent.id}/registrations/solo`),
      participant.authenticationToken
    ).send({});

    const passAfterRetry = await PassModel.findOne({ userId: participant.user._id }).lean();
    expect(passAfterRetry.passEmailSentAt).not.toBeNull();
  });

  it("the owner can resend their own pass email; another user's pass is a 404", async () => {
    const owner = await createTestParticipant(college, {
      emailAddress: "pass-owner@example.com",
      phoneNumber: "+91 90000 00005",
    });
    const stranger = await createTestParticipant(college, {
      emailAddress: "pass-stranger@example.com",
      usn: "1AA00AA902",
      phoneNumber: "+91 90000 00006",
    });
    await withToken(
      request(application).post(`/api/v1/events/${soloEvent.id}/registrations/solo`),
      owner.authenticationToken
    ).send({});
    clearRecordedEmails();

    const passRow = await PassModel.findOne({ userId: owner.user._id }).lean();

    const strangerAttempt = await withToken(
      request(application).post(`/api/v1/passes/${passRow._id}/resend-email`),
      stranger.authenticationToken
    );
    expect(strangerAttempt.status).toBe(404);
    expect(findRecordedEmailsOfKind("pass")).toHaveLength(0);

    const ownerResend = await withToken(
      request(application).post(`/api/v1/passes/${passRow._id}/resend-email`),
      owner.authenticationToken
    );
    expect(ownerResend.status).toBe(200);
    expect(findRecordedEmailsOfKind("pass")).toHaveLength(1);
  });
});

describe("contact-number guarantee across team entry points (Section A)", () => {
  it("the team ROSTER path is the one gap: a placeholder member is seated with no phone", async () => {
    const leader = await createTestParticipant(college, {
      emailAddress: "roster-leader@example.com",
      usn: "1AA00AA903",
      phoneNumber: "+91 90000 00007",
    });

    /*
     * Belongs to the host college (so the intraCollege guard passes) but never
     * finished their profile — no phone. This is the shape that slips through.
     */
    await UserModel.create({
      emailAddress: "no-phone-member@example.com",
      fullName: "No Phone Member",
      collegeId: college._id,
    });

    const response = await withToken(
      request(application).post(`/api/v1/events/${teamEvent.id}/registrations/team`),
      leader.authenticationToken
    ).send({
      teamName: "Placeholder Squad",
      memberEmails: ["no-phone-member@example.com"],
    });
    expect(response.status).toBe(201);

    /*
     * This test PINS the known gap rather than asserting desired behaviour, so
     * that closing it (see docs/contact-number-coverage.md) fails loudly here
     * and the decision is made deliberately rather than by accident.
     */
    const placeholder = await UserModel.findOne({ emailAddress: "no-phone-member@example.com" })
      .select("+phoneNumber isProfileComplete")
      .lean();
    expect(placeholder).not.toBeNull();
    expect(placeholder.isProfileComplete).toBe(false);
    expect(placeholder.phoneNumber ?? null).toBeNull();
    // …and they nonetheless hold a pass for the fest.
    expect(await PassModel.countDocuments({ userId: placeholder._id })).toBe(1);
  });

  it("the team CODE JOIN path refuses an incomplete profile", async () => {
    const leader = await createTestParticipant(college, {
      emailAddress: "join-leader@example.com",
      usn: "1AA00AA904",
      phoneNumber: "+91 90000 00008",
    });
    const created = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(teamEvent._id), teamName: "Gate Check" });
    expect(created.status).toBe(201);
    const teamRow = await TeamModel.findOne({ eventId: teamEvent._id }).lean();
    const inviteCode = teamRow.inviteCode;

    // A signed-in user with no completed profile holds a valid token.
    const incompleteUser = await UserModel.create({
      emailAddress: "incomplete-joiner@example.com",
      fullName: "Incomplete Joiner",
    });
    const { createAuthenticationToken } = await import("../../src/helpers/token-helpers.js");
    const incompleteToken = createAuthenticationToken({
      id: incompleteUser.id,
      emailAddress: incompleteUser.emailAddress,
    });

    const joined = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      incompleteToken
    ).send({ inviteCode });

    expect(joined.status).toBe(403);
    expect(joined.body.error.code).toBe("PROFILE_INCOMPLETE");
    expect(await PassModel.countDocuments({ userId: incompleteUser._id })).toBe(0);
  });
});
