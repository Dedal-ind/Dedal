import { CollegeModel } from "../../src/models/college-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { DailyGateCheckInModel } from "../../src/models/daily-gate-checkin-model.js";
import { resolveTodayFestDayKey } from "../../src/helpers/fest-day-helpers.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import { generateQrToken } from "../../src/helpers/generate-qr-token.js";
import { generateBackupCode } from "../../src/helpers/generate-backup-code.js";
import passService from "../../src/services/pass-service.js";

const { resolveEventEntitlementWindow } = passService;

/*
 * A window wide enough that the wall clock always falls inside it. Correct for
 * gate access, whose real window is the fest's own multi-day run and so always
 * contains "now" in a test. Deliberately no longer used for event entry — see
 * createTestEventEntitlement.
 */
const WINDOW_OPEN = new Date("2020-01-01T00:00:00.000Z");
const WINDOW_CLOSE = new Date("2035-01-01T00:00:00.000Z");

/*
 * Seeding a college, a user, an administrator grant and a JWT is the opening move
 * of nearly every suite below. Factored here so a schema change lands in one file
 * rather than in fifteen beforeEach blocks.
 *
 * Every field the caller does not name gets a valid default, so a test states only
 * what it is actually about.
 */
export async function createTestCollege(overrides = {}) {
  return CollegeModel.create({
    collegeName: "Alliance University",
    commonName: "Alliance",
    city: "Bengaluru",
    state: "Karnataka",
    ...overrides,
  });
}

export async function createTestUser(overrides = {}) {
  return UserModel.create({ emailAddress: "person@example.com", ...overrides });
}

/* A college administrator: an active, college-scoped assignment plus a signed token. */
export async function createTestAdministrator(college, overrides = {}) {
  const user = await createTestUser({
    emailAddress: overrides.emailAddress || "admin@example.com",
  });

  const staffAssignment = await StaffAssignmentModel.create({
    userId: user._id,
    collegeId: college._id,
    role: "administrator",
    assignedByUserId: user._id,
    ...overrides.assignment,
  });

  const authenticationToken = createAuthenticationToken({
    id: user.id,
    emailAddress: user.emailAddress,
  });

  return { user, staffAssignment, authenticationToken };
}

/* A user with no staff assignment anywhere. Used for every 403 path. */
export async function createTestOutsider() {
  const user = await createTestUser({ emailAddress: "outsider@example.com" });
  const authenticationToken = createAuthenticationToken({
    id: user.id,
    emailAddress: user.emailAddress,
  });
  return { user, authenticationToken };
}

export async function createTestFest(college, user, overrides = {}) {
  return FestModel.create({
    festName: "Alliance ONE 2027",
    festSlug: "alliance-one-2027",
    hostCollegeId: college._id,
    startsOn: new Date("2027-03-01T00:00:00.000Z"),
    endsOn: new Date("2027-03-05T00:00:00.000Z"),
    visibility: "intraCollege",
    createdByUserId: user._id,
    ...overrides,
  });
}

export function buildEventAttributes(overrides = {}) {
  return {
    eventName: "Robowars 2027",
    description: "Robotics combat, single elimination.",
    category: "technical",
    eventType: "solo",
    venue: "Robotics Lab",
    registrationOpensAt: new Date("2027-01-01T00:00:00.000Z"),
    registrationClosesAt: new Date("2027-02-01T00:00:00.000Z"),
    startsAt: new Date("2027-03-01T10:00:00.000Z"),
    endsAt: new Date("2027-03-01T18:00:00.000Z"),
    ...overrides,
  };
}

export async function createTestEvent(fest, user, overrides = {}) {
  return EventModel.create({
    ...buildEventAttributes(),
    eventSlug: "robowars-2027",
    festId: fest._id,
    createdByUserId: user._id,
    ...overrides,
  });
}

/* A participant with a complete profile in the given college, plus a signed token. */
export async function createTestParticipant(college, overrides = {}) {
  const user = await createTestUser({
    emailAddress: "participant@example.com",
    fullName: "Test Participant",
    collegeId: college._id,
    usn: "1AA00AA000",
    isProfileComplete: true,
    ...overrides,
  });
  const authenticationToken = createAuthenticationToken({
    id: user.id,
    emailAddress: user.emailAddress,
  });
  return { user, authenticationToken };
}

/*
 * A fest-scoped staff member (coordinator or volunteer) with a signed token. The
 * assignment defaults to a wide validity window and whole-fest scope; a test that
 * cares about the window or the covered events overrides assignment fields.
 */
export async function createTestStaffMember(fest, role, overrides = {}) {
  const user = await createTestUser({
    emailAddress: overrides.emailAddress || `${role}@example.com`,
  });
  const staffAssignment = await StaffAssignmentModel.create({
    userId: user._id,
    festId: fest._id,
    role,
    assignedByUserId: fest.createdByUserId,
    validFrom: WINDOW_OPEN,
    validTo: WINDOW_CLOSE,
    ...overrides.assignment,
  });
  const authenticationToken = createAuthenticationToken({
    id: user.id,
    emailAddress: user.emailAddress,
  });
  return { user, staffAssignment, authenticationToken };
}

export async function createTestPass(fest, user, overrides = {}) {
  return PassModel.create({
    userId: user._id,
    festId: fest._id,
    qrToken: generateQrToken(),
    backupCode: generateBackupCode(),
    ...overrides,
  });
}

/*
 * Marks a pass as having crossed the Main Gate TODAY.
 *
 * Every event door and offer counter now refuses a pass whose holder has not
 * entered the campus today (scan-decision.requiresMainGateCheckIn), so any test
 * that scans INSIDE the campus has to put the participant inside it first. This
 * is the fixture that does it, rather than each test hand-rolling a check-in row
 * and getting the timezone-keyed date wrong.
 *
 * The day key comes from production's own helper, not from a literal: the whole
 * point of that helper is that "today" is the fest's calendar day, and a test
 * that hardcoded an ISO date would pass in one timezone and fail in another.
 */
export async function createTestGateCheckIn(pass, overrides = {}) {
  return DailyGateCheckInModel.create({
    passId: pass._id,
    festId: pass.festId,
    checkInDate: resolveTodayFestDayKey(),
    checkedInAt: new Date(),
    ...overrides,
  });
}

export async function createTestGateEntitlement(pass, overrides = {}) {
  return EntitlementModel.create({
    passId: pass._id,
    entitlementType: "gateAccess",
    referenceId: null,
    maximumUses: null,
    validFrom: WINDOW_OPEN,
    validTo: WINDOW_CLOSE,
    source: "manualGrant",
    ...overrides,
  });
}

/*
 * The window is asked of production rather than restated here. The previous
 * hardcoded 2020–2035 pair was a window registration could never mint, so the
 * event-door tests were scanning against a fiction and could not fail — the bug
 * they existed to catch lived in the gap between this fixture and the real rule.
 * Deriving it from the event keeps the two in step by construction.
 *
 * The event is looked up rather than passed in so the signature stays
 * (pass, eventId, overrides) for the suites already calling it. A caller that
 * genuinely wants a different window still overrides validFrom/validTo
 * explicitly, and a caller passing an id with no event row gets the open-ended
 * window, which is what an entitlement with nothing to expire against means.
 */
export async function createTestEventEntitlement(pass, eventId, overrides = {}) {
  const event = await EventModel.findById(eventId);
  const window = event ? resolveEventEntitlementWindow(event) : { validFrom: null, validTo: null };

  return EntitlementModel.create({
    passId: pass._id,
    entitlementType: "eventEntry",
    referenceId: eventId,
    maximumUses: 1,
    usedCount: 0,
    ...window,
    source: "registration",
    ...overrides,
  });
}

export async function createTestGateCheckpoint(fest, overrides = {}) {
  return CheckpointModel.create({
    festId: fest._id,
    eventId: null,
    checkpointName: "Main Gate",
    checkpointType: "gate",
    directionMode: "inAndOut",
    isActive: true,
    ...overrides,
  });
}

export async function createTestEventCheckpoint(fest, eventId, overrides = {}) {
  return CheckpointModel.create({
    festId: fest._id,
    eventId,
    checkpointName: "Robowars 2027 Entry",
    checkpointType: "eventEntry",
    directionMode: "inOnly",
    isActive: true,
    ...overrides,
  });
}

/*
 * Event overrides whose registration window is open right now and stays open for
 * years, so a registration test is never at the mercy of the wall clock.
 */
export function openRegistrationOverrides(overrides = {}) {
  return {
    status: "published",
    registrationOpensAt: new Date("2020-01-01T00:00:00.000Z"),
    registrationClosesAt: new Date("2035-01-01T00:00:00.000Z"),
    startsAt: new Date("2035-06-01T10:00:00.000Z"),
    endsAt: new Date("2035-06-01T18:00:00.000Z"),
    ...overrides,
  };
}
