import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

import { application } from "../../src/application.js";
import { PromoterModel } from "../../src/models/promoter-model.js";
import { CreativeModel } from "../../src/models/creative-model.js";
import { CampaignModel } from "../../src/models/campaign-model.js";
import { CampaignCreativeModel } from "../../src/models/campaign-creative-model.js";
import { PlacementModel } from "../../src/models/placement-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import campaignService from "../../src/services/campaign-service.js";
import decisionEngine from "../../src/services/decision-engine-service.js";
import targetingService from "../../src/services/targeting-service.js";
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
  createTestUser,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();

const DAY = 24 * 60 * 60 * 1000;
const HOME = "homeCarousel";

let platformAdmin;
let collegeAdmin;

async function createTestPlatformAdmin() {
  const user = await UserModel.create({
    emailAddress: "platform-owner@example.com",
    fullName: "Platform Owner",
    isProfileComplete: true,
  });
  await StaffAssignmentModel.create({
    userId: user._id,
    collegeId: null,
    festId: null,
    role: "platformAdmin",
    status: "active",
    assignedByUserId: user._id,
  });
  return {
    user,
    authenticationToken: createAuthenticationToken({ id: user.id, emailAddress: user.emailAddress }),
  };
}

function as(token) {
  const bearer = (pending) => pending.set("Authorization", `Bearer ${token}`);
  return {
    get: (path) => bearer(request(application).get(path)),
    post: (path, body = {}) => bearer(request(application).post(path)).send(body),
  };
}
const owner = () => as(platformAdmin.authenticationToken);

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PromoterModel.createIndexes(),
    CreativeModel.createIndexes(),
    CampaignModel.createIndexes(),
    CampaignCreativeModel.createIndexes(),
    PlacementModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  await campaignService.ensurePlacements();
  platformAdmin = await createTestPlatformAdmin();
  const adminCollege = await createTestCollege({
    collegeName: "Admin College",
    commonName: "AdminC",
    city: "Hubli",
    isVerified: true,
  });
  collegeAdmin = await createTestAdministrator(adminCollege);
});

afterAll(teardownTestDatabase);

/*
 * A seeded population: two colleges in two cities, participants with a mix of
 * departments, years, fest registrations, ages, and one with no date of
 * birth. The reach estimate must agree with the engine over every one.
 */
async function seedPopulation() {
  const alliance = await createTestCollege({
    collegeName: "Alliance University",
    commonName: "Alliance",
    city: "Bengaluru",
    isVerified: true,
  });
  const christ = await createTestCollege({
    collegeName: "Christ University",
    commonName: "Christ",
    city: "Mysuru",
    isVerified: true,
  });
  const fest = await createTestFest(alliance, platformAdmin.user, { status: "published" });
  const event = await createTestEvent(fest, platformAdmin.user);

  const adultBirth = new Date(Date.UTC(1998, 0, 1));
  const minorBirth = new Date(Date.now() - 16 * 365 * DAY);
  const people = await Promise.all([
    createTestUser({ emailAddress: "a1@example.com", collegeId: alliance._id, department: "Computer Science", yearOfStudy: 2, dateOfBirth: adultBirth }),
    createTestUser({ emailAddress: "a2@example.com", collegeId: alliance._id, department: "Law", yearOfStudy: 4, dateOfBirth: adultBirth }),
    createTestUser({ emailAddress: "a3@example.com", collegeId: alliance._id, department: "computer science ", yearOfStudy: 1, dateOfBirth: minorBirth }),
    createTestUser({ emailAddress: "c1@example.com", collegeId: christ._id, department: "Computer Science", yearOfStudy: 2, dateOfBirth: adultBirth }),
    createTestUser({ emailAddress: "c2@example.com", collegeId: christ._id, department: "Design", yearOfStudy: 3 }), // unknown age
    createTestUser({ emailAddress: "none@example.com", dateOfBirth: adultBirth }), // no college
  ]);
  // a1 and c1 hold an active registration in the Alliance fest.
  await RegistrationModel.collection.insertMany([
    { userId: people[0]._id, eventId: event._id, status: "confirmed" },
    { userId: people[3]._id, eventId: event._id, status: "confirmed" },
  ]);
  return { alliance, christ, fest, people };
}

/* What the engine itself says: for each participant, is a campaign with this
   predicate eligible? Counted the engine's way, one participant at a time. */
async function engineReach(targeting, { people }) {
  const promoter = await PromoterModel.create({ displayName: `P-${Date.now()}-${Math.random()}`, kind: "sponsor" });
  const campaign = await campaignService.createCampaign(platformAdmin.user._id, {
    promoterId: promoter._id,
    name: "Probe",
    placementKeys: [HOME],
    flightStartsAt: new Date(Date.now() - DAY),
    flightEndsAt: new Date(Date.now() + DAY),
    targeting,
  });
  const creative = await CreativeModel.create({ promoterId: promoter._id, title: "Art", imageUrl: "https://example.com/a.png" });
  await campaignService.attachCreative(platformAdmin.user._id, campaign._id, { creativeId: creative._id });
  await campaignService.publishCampaign(platformAdmin.user._id, campaign._id);

  let eligible = 0;
  for (const person of people) {
    const subject = decisionEngine.resolveSubject(person, "probe-session");
    const matches = await decisionEngine.listEligibleCampaigns({ placementKey: HOME, user: person, subject });
    if (matches.some((entry) => String(entry.campaign._id) === String(campaign._id))) {
      eligible += 1;
    }
  }
  await CampaignModel.updateOne({ _id: campaign._id }, { $set: { status: "archived" } });
  return eligible;
}

describe("resume, after extracting the publish guards", () => {
  async function publishedCampaign() {
    const promoter = await PromoterModel.create({ displayName: "Acme", kind: "sponsor" });
    const campaign = await campaignService.createCampaign(platformAdmin.user._id, {
      promoterId: promoter._id,
      name: "Live",
      placementKeys: [HOME],
      flightStartsAt: new Date(Date.now() - DAY),
      flightEndsAt: new Date(Date.now() + 5 * DAY),
    });
    const creative = await CreativeModel.create({ promoterId: promoter._id, title: "Art", imageUrl: "https://example.com/a.png" });
    await campaignService.attachCreative(platformAdmin.user._id, campaign._id, { creativeId: creative._id });
    return { campaign, creative };
  }

  it("writes one audit entry and never passes the row through draft; publish behaves identically", async () => {
    const { campaign, creative } = await publishedCampaign();

    // Publish: the same guards, the same refusals, the same single entry.
    await CampaignCreativeModel.updateOne({ campaignId: campaign._id }, { $set: { isActive: false } });
    const refused = await owner().post(`/api/v1/campaigns/${campaign._id}/publish`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe("noActiveCreative");
    await CampaignCreativeModel.updateOne({ campaignId: campaign._id }, { $set: { isActive: true } });
    const published = await owner().post(`/api/v1/campaigns/${campaign._id}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("published");
    expect(await AuditLogModel.countDocuments({ entityId: campaign._id, action: "campaign.published" })).toBe(1);

    // Pause, then watch the status field through resume: it must never read "draft".
    await owner().post(`/api/v1/campaigns/${campaign._id}/pause`);
    const statusesSeen = new Set();
    const watcher = setInterval(async () => {
      const row = await CampaignModel.findById(campaign._id).select("status").lean();
      if (row) {
        statusesSeen.add(row.status);
      }
    }, 1);
    const resumed = await owner().post(`/api/v1/campaigns/${campaign._id}/resume`);
    clearInterval(watcher);
    expect(resumed.status).toBe(200);
    expect(resumed.body.data).toMatchObject({ status: "published", pausedAt: null });
    expect(statusesSeen.has("draft")).toBe(false);

    const entries = await AuditLogModel.find({ entityId: campaign._id }).sort({ createdAt: 1 }).lean();
    const actions = entries.map((entry) => entry.action);
    expect(actions.filter((action) => action === "campaign.resumed")).toHaveLength(1);
    // Exactly one publish entry: the original one. Resume did not add another.
    expect(actions.filter((action) => action === "campaign.published")).toHaveLength(1);
    const resumeEntry = entries.find((entry) => entry.action === "campaign.resumed");
    expect(resumeEntry.beforeState.status).toBe("paused");
    expect(resumeEntry.afterState.status).toBe("published");

    // Resume still runs the guards: pull the only creative while paused, resume is refused.
    await owner().post(`/api/v1/campaigns/${campaign._id}/pause`);
    await CampaignCreativeModel.deleteOne({ campaignId: campaign._id, creativeId: creative._id });
    const blocked = await owner().post(`/api/v1/campaigns/${campaign._id}/resume`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("CAMPAIGN_NOT_PUBLISHABLE");
    expect((await CampaignModel.findById(campaign._id)).status).toBe("paused");
  });
});

describe("targeting options", () => {
  it("returns closed and open dimensions correctly marked, with the values actually in use", async () => {
    const { alliance, christ, fest } = await seedPopulation();

    const response = await owner().get("/api/v1/targeting/options");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, private");
    const options = response.body.data;
    expect(options.collegeIds.closed).toBe(true);
    expect(options.collegeIds.values.map((college) => college.name)).toEqual(["AdminC", "Alliance", "Christ"]);
    expect(options.collegeIds.values.find((college) => college.id === String(alliance._id))).toMatchObject({
      fullName: "Alliance University",
      city: "Bengaluru",
    });
    expect(options.cities).toEqual({ closed: false, values: ["Bengaluru", "Hubli", "Mysuru"] });
    expect(options.departments.closed).toBe(false);
    // "computer science " and "Computer Science" are one value to the engine, so one suggestion.
    expect(options.departments.values).toEqual(["Computer Science", "Design", "Law"]);
    expect(options.yearsOfStudy).toEqual({ closed: true, values: [1, 2, 3, 4, 5, 6] });
    expect(options.festIds.closed).toBe(true);
    expect(options.festIds.values).toEqual([
      { id: String(fest._id), name: fest.festName, status: "published", college: { id: String(alliance._id), name: "Alliance" } },
    ]);
    expect(christ).toBeTruthy();
  });
});

describe("reach estimate", () => {
  it("agrees exactly with the engine's eligibility over a seeded population, for every dimension", async () => {
    const population = await seedPopulation();
    const { alliance, christ, fest } = population;
    const predicates = [
      { include: { collegeIds: [alliance._id] } },
      { include: { cities: ["mysuru"] } },
      { include: { departments: ["Computer Science"] } },
      { include: { yearsOfStudy: [2] } },
      { include: { festIds: [fest._id] } },
      { include: { collegeIds: [alliance._id, christ._id] }, exclude: { departments: ["Law"] } },
      { exclude: { cities: ["Bengaluru"] } },
      { include: { yearsOfStudy: [2] }, exclude: { collegeIds: [christ._id] } },
    ];
    for (const targeting of predicates) {
      const estimate = await targetingService.estimateReach(targeting);
      const engine = await engineReach(targeting, population);
      expect({ targeting, eligibleReach: estimate.eligibleReach }).toEqual({ targeting, eligibleReach: engine });
    }
  });

  it("returns a lower age-adjusted figure than the raw attribute match when minors are present", async () => {
    const { alliance } = await seedPopulation();

    const response = await owner().post("/api/v1/targeting/estimate", {
      targeting: { include: { collegeIds: [String(alliance._id)] } },
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      kind: "snapshot",
      totalParticipants: 8, // 6 seeded + the platform admin + the college admin user
      attributeMatches: 3, // a1, a2, a3
      eligibleReach: 2, // a3 is sixteen
      ageRestricted: 1,
      isUntargeted: false,
    });
    expect(response.body.data.explanation.note).toMatch(/snapshot/i);
    expect(response.body.data.eligibleReach).toBeLessThan(response.body.data.attributeMatches);

    // An untargeted campaign reaches everyone, minors included.
    const untargeted = await owner().post("/api/v1/targeting/estimate", { targeting: {} });
    expect(untargeted.body.data).toMatchObject({ isUntargeted: true, attributeMatches: 8, eligibleReach: 8, ageRestricted: 0 });
  });

  it("returns zero, not an error, for a predicate matching nobody", async () => {
    await seedPopulation();
    const response = await owner().post("/api/v1/targeting/estimate", {
      targeting: { include: { departments: ["Astrophysics"] } },
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ attributeMatches: 0, eligibleReach: 0, ageRestricted: 0 });
  });
});

describe("predicate validation", () => {
  it("flags a nonexistent id as an error, a value both included and excluded as a warning, and passes a clean predicate", async () => {
    const { alliance, fest } = await seedPopulation();

    const clean = await owner().post("/api/v1/targeting/validate", {
      targeting: { include: { collegeIds: [String(alliance._id)], festIds: [String(fest._id)] }, exclude: { cities: ["Mysuru"] } },
    });
    expect(clean.status).toBe(200);
    expect(clean.body.data).toEqual({ ok: true, errors: [], warnings: [] });

    const findings = await owner().post("/api/v1/targeting/validate", {
      targeting: {
        include: { collegeIds: ["000000000000000000000000"], cities: ["Bengaluru", "Mysuru"], yearsOfStudy: [9], festIds: [] },
        exclude: { cities: ["bengaluru"], festIds: [String(fest._id)] },
      },
    });
    expect(findings.status).toBe(200);
    expect(findings.body.data.ok).toBe(false);
    expect(findings.body.data.errors).toEqual([
      { path: "collegeIds", message: "no college with id 000000000000000000000000" },
      { path: "yearsOfStudy", message: "9 is not a year of study (1–6)" },
    ]);
    expect(findings.body.data.warnings).toEqual([
      { path: "cities", message: "included and excluded at once (bengaluru); the exclusion wins and these can never match" },
      { path: "festIds", message: "an empty include set means no constraint; only the exclusions apply" },
    ]);

    // A behavioural dimension has nowhere to go: a shape error, not a warning.
    const behavioural = await owner().post("/api/v1/targeting/validate", {
      targeting: { include: { interests: ["music"] } },
    });
    expect(behavioural.body.data.ok).toBe(false);
    expect(behavioural.body.data.errors[0].path).toBe("targeting.include.interests");
    // And the estimate refuses it outright rather than estimating nonsense.
    const estimate = await owner().post("/api/v1/targeting/estimate", { targeting: { include: { interests: ["music"] } } });
    expect(estimate.status).toBe(400);
  });
});

describe("authorization", () => {
  it("refuses every targeting endpoint for a college administrator", async () => {
    const college = as(collegeAdmin.authenticationToken);
    expect((await college.get("/api/v1/targeting/options")).status).toBe(403);
    expect((await college.post("/api/v1/targeting/estimate", { targeting: {} })).status).toBe(403);
    expect((await college.post("/api/v1/targeting/validate", { targeting: {} })).status).toBe(403);
    expect((await request(application).get("/api/v1/targeting/options")).status).toBe(401);
    expect((await owner().get("/api/v1/targeting/options")).status).toBe(200);
  });
});
