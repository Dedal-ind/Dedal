import { describe, it, expect } from "vitest";
import {
  buildMetadata,
  buildParticipantCandidates,
  buildStaffCandidates,
} from "../../../src/helpers/certificate-candidate-helpers.js";
import { CERTIFICATE_TYPES } from "../../../src/constants/certificate-constants.js";
import { REGISTRATION_STATUSES } from "../../../src/constants/registration-constants.js";
import { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } from "../../../src/constants/staff-constants.js";

const FEST = { festName: "Alliance ONE 2027" };
const FEST_DATES = "15 – 17 Jan 2027";
const FEST_ID = "fest-1";

function makeUser(overrides = {}) {
  return { fullName: "Asha Rao", collegeId: { commonName: "Alliance" }, usn: "1AA00", ...overrides };
}

describe("buildMetadata", () => {
  it("carries the shared fields for every certificate type", () => {
    const metadata = buildMetadata(makeUser(), {
      certificateType: CERTIFICATE_TYPES.PARTICIPATION,
      eventName: "Robowars",
      fest: FEST,
      festDates: FEST_DATES,
    });
    expect(metadata.fullName).toBe("Asha Rao");
    expect(metadata.collegeName).toBe("Alliance");
    expect(metadata.festName).toBe("Alliance ONE 2027");
    expect(metadata.festDates).toBe(FEST_DATES);
  });

  it("gives a participation certificate its event and no position or role", () => {
    const metadata = buildMetadata(makeUser(), {
      certificateType: CERTIFICATE_TYPES.PARTICIPATION,
      eventName: "Robowars",
      fest: FEST,
      festDates: FEST_DATES,
    });
    expect(metadata.eventName).toBe("Robowars");
    expect(metadata.position).toBeNull();
    expect(metadata.role).toBeNull();
  });

  it("gives each winner type its event and ordinal position", () => {
    const cases = [
      [CERTIFICATE_TYPES.WINNER_1ST, "1st"],
      [CERTIFICATE_TYPES.WINNER_2ND, "2nd"],
      [CERTIFICATE_TYPES.WINNER_3RD, "3rd"],
    ];
    for (const [certificateType, position] of cases) {
      const metadata = buildMetadata(makeUser(), {
        certificateType,
        eventName: "Robowars",
        fest: FEST,
        festDates: FEST_DATES,
      });
      expect(metadata.eventName).toBe("Robowars");
      expect(metadata.position).toBe(position);
      expect(metadata.role).toBeNull();
    }
  });

  it("gives a staff certificate its role and no event or position", () => {
    const metadata = buildMetadata(makeUser(), {
      certificateType: CERTIFICATE_TYPES.COORDINATOR,
      role: STAFF_ROLES.COORDINATOR,
      fest: FEST,
      festDates: FEST_DATES,
    });
    expect(metadata.role).toBe(STAFF_ROLES.COORDINATOR);
    expect(metadata.eventName).toBeNull();
    expect(metadata.position).toBeNull();
  });
});

describe("buildParticipantCandidates", () => {
  const EVENT_ID = "event-1";
  const USER_ID = "user-1";
  const eventById = new Map([[EVENT_ID, { eventName: "Robowars" }]]);
  const usersById = new Map([[USER_ID, makeUser()]]);

  function registration(status) {
    return { userId: USER_ID, eventId: EVENT_ID, status };
  }

  function build(registrations, events = eventById, users = usersById) {
    return buildParticipantCandidates(registrations, events, users, FEST, FEST_ID, FEST_DATES);
  }

  it("returns one candidate per certifiable status, mapped to its type", () => {
    const candidates = build([
      registration(REGISTRATION_STATUSES.CONFIRMED),
      registration(REGISTRATION_STATUSES.ATTENDED),
      registration(REGISTRATION_STATUSES.WINNER_1ST),
      registration(REGISTRATION_STATUSES.WINNER_2ND),
      registration(REGISTRATION_STATUSES.WINNER_3RD),
    ]);
    expect(candidates.map((candidate) => candidate.certificateType)).toEqual([
      CERTIFICATE_TYPES.PARTICIPATION,
      CERTIFICATE_TYPES.PARTICIPATION,
      CERTIFICATE_TYPES.WINNER_1ST,
      CERTIFICATE_TYPES.WINNER_2ND,
      CERTIFICATE_TYPES.WINNER_3RD,
    ]);
    expect(candidates[0].metadata.eventName).toBe("Robowars");
    expect(candidates[0].festId).toBe(FEST_ID);
  });

  it("skips statuses that do not earn a certificate", () => {
    const candidates = build([
      registration(REGISTRATION_STATUSES.CANCELLED),
      registration(REGISTRATION_STATUSES.WAITLISTED),
      registration(REGISTRATION_STATUSES.NO_SHOW),
      registration(REGISTRATION_STATUSES.DISQUALIFIED),
      registration(REGISTRATION_STATUSES.ADVANCED_TO_R2),
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("returns an empty list when the event lookup is missing, without throwing", () => {
    const candidates = build([registration(REGISTRATION_STATUSES.CONFIRMED)], new Map());
    expect(candidates).toHaveLength(0);
  });

  it("skips a registration whose user was deleted, without blowing up the batch", () => {
    const candidates = build([registration(REGISTRATION_STATUSES.CONFIRMED)], eventById, new Map());
    expect(candidates).toHaveLength(0);
  });
});

describe("buildStaffCandidates", () => {
  const USER_ID = "staff-1";
  const usersById = new Map([[USER_ID, makeUser()]]);

  function assignment(role, overrides = {}) {
    return { userId: USER_ID, role, status: STAFF_ASSIGNMENT_STATUSES.ACTIVE, ...overrides };
  }

  function build(assignments, users = usersById) {
    return buildStaffCandidates(assignments, users, FEST, FEST_ID, FEST_DATES);
  }

  it("maps each active assignment to its staff certificate type", () => {
    const candidates = build([
      assignment(STAFF_ROLES.COORDINATOR),
      assignment(STAFF_ROLES.VOLUNTEER),
      assignment(STAFF_ROLES.ADMINISTRATOR),
    ]);
    expect(candidates.map((candidate) => candidate.certificateType)).toEqual([
      CERTIFICATE_TYPES.COORDINATOR,
      CERTIFICATE_TYPES.VOLUNTEER,
      CERTIFICATE_TYPES.ADMINISTRATOR,
    ]);
    expect(candidates[0].eventId).toBeNull();
    expect(candidates[0].metadata.role).toBe(STAFF_ROLES.COORDINATOR);
  });

  it("skips a revoked assignment", () => {
    const candidates = build([
      assignment(STAFF_ROLES.COORDINATOR, { status: STAFF_ASSIGNMENT_STATUSES.REVOKED }),
    ]);
    expect(candidates).toHaveLength(0);
  });

  it("skips an assignment whose user was not found", () => {
    const candidates = build([assignment(STAFF_ROLES.COORDINATOR)], new Map());
    expect(candidates).toHaveLength(0);
  });
});
