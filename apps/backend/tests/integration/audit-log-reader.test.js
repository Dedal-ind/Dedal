import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { FestModel } from "../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { CollegeModel } from "../../src/models/college-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
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
  createTestStaffMember,
  createTestOutsider,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const AUDIT_LOGS_PATH = "/api/v1/admin/audit-logs";

let college;
let admin;
let fest;

function readLogs(query, token = admin.authenticationToken) {
  return request(application)
    .get(AUDIT_LOGS_PATH)
    .query({ festId: String(fest._id), ...query })
    .set("Authorization", `Bearer ${token}`);
}

/*
 * Written straight to the collection rather than by driving the actions that
 * would produce them: this file is about the reader, and staging six real
 * force-regenerations to test a filter would test everything except the filter.
 * createdAt is set explicitly so the ordering and the cursor have something
 * definite to be right about.
 */
async function seedLog(action, entityType, minutesAgo, actorUserId = admin.user._id) {
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  const [log] = await AuditLogModel.insertMany([
    {
      actorUserId,
      festId: fest._id,
      action,
      entityType,
      entityId: fest._id,
      afterState: { note: `${action} at ${minutesAgo}m ago` },
      createdAt,
    },
  ]);
  return log;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    FestModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    UserModel.createIndexes(),
    CollegeModel.createIndexes(),
    AuditLogModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("who may read a fest's trail", () => {
  it("gives an administrator of the fest the newest entries first", async () => {
    await seedLog("fest.created", "fest", 30);
    await seedLog("bracket.forceRegenerated", "event", 10);

    const response = await readLogs({});

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.logs[0].action).toBe("bracket.forceRegenerated");
    expect(response.body.data.logs[1].action).toBe("fest.created");
  });

  it("resolves the actor to a name so the reader is not left holding an id", async () => {
    await seedLog("fest.created", "fest", 5);

    const response = await readLogs({});

    expect(response.body.data.logs[0].actorUserId.fullName).toBe(admin.user.fullName);
    expect(response.body.data.logs[0].actorUserId.emailAddress).toBe(admin.user.emailAddress);
  });

  /* The trail records what staff did; it is not a staff-facing surface. */
  it("refuses a coordinator of the same fest", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator");
    await seedLog("fest.created", "fest", 5);

    const response = await readLogs({}, coordinator.authenticationToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("refuses an administrator of a different college", async () => {
    const otherCollege = await createTestCollege({
      collegeName: "Other University",
      commonName: "Other",
      aisheCode: "C-99999",
    });
    const otherAdmin = await createTestAdministrator(otherCollege, {
      emailAddress: "other-admin@example.com",
    });

    const response = await readLogs({}, otherAdmin.authenticationToken);

    expect(response.status).toBe(403);
  });

  it("refuses an outsider", async () => {
    const outsider = await createTestOutsider();

    const response = await readLogs({}, outsider.authenticationToken);

    expect(response.status).toBe(403);
  });

  it("will not answer without a fest to scope to", async () => {
    const response = await request(application)
      .get(AUDIT_LOGS_PATH)
      .set("Authorization", `Bearer ${admin.authenticationToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error.details.festId).toBe("is required");
  });
});

describe("narrowing the trail", () => {
  beforeEach(async () => {
    await seedLog("fest.created", "fest", 60);
    await seedLog("bracket.forceRegenerated", "event", 40);
    await seedLog("registration.cancelled.byAdmin", "registration", 20);
    await seedLog("bracket.forceRegenerated", "event", 10);
  });

  it("filters to a single action", async () => {
    const response = await readLogs({ action: "bracket.forceRegenerated" });

    expect(response.body.data.logs).toHaveLength(2);
    expect(response.body.data.total).toBe(2);
    expect(
      response.body.data.logs.every((log) => log.action === "bracket.forceRegenerated")
    ).toBe(true);
  });

  it("filters to several actions at once", async () => {
    const response = await readLogs({ action: ["fest.created", "registration.cancelled.byAdmin"] });

    expect(response.body.data.logs).toHaveLength(2);
  });

  it("filters by entity type", async () => {
    const response = await readLogs({ entityType: "registration" });

    expect(response.body.data.logs).toHaveLength(1);
    expect(response.body.data.logs[0].entityType).toBe("registration");
  });

  it("filters by actor", async () => {
    const otherAdmin = await createTestAdministrator(college, {
      emailAddress: "second-admin@example.com",
    });
    await seedLog("fest.published", "fest", 5, otherAdmin.user._id);

    const response = await readLogs({ actorUserId: String(otherAdmin.user._id) });

    expect(response.body.data.logs).toHaveLength(1);
    expect(response.body.data.logs[0].action).toBe("fest.published");
  });

  it("returns everything when no filter is given rather than nothing", async () => {
    const response = await readLogs({ action: "", entityType: "" });

    expect(response.body.data.logs).toHaveLength(4);
  });
});

describe("paging back through the trail", () => {
  beforeEach(async () => {
    await seedLog("fest.created", "fest", 60);
    await seedLog("bracket.forceRegenerated", "event", 40);
    await seedLog("registration.cancelled.byAdmin", "registration", 20);
    await seedLog("bracket.forceRegenerated", "event", 10);
  });

  it("returns only entries older than the cursor", async () => {
    const firstPage = await readLogs({ limit: 2 });
    expect(firstPage.body.data.logs).toHaveLength(2);

    const cursor = firstPage.body.data.logs[1].createdAt;
    const secondPage = await readLogs({ limit: 2, before: cursor });

    expect(secondPage.body.data.logs).toHaveLength(2);
    /* No overlap: the cursor is exclusive, so nothing from page one repeats. */
    const firstPageIds = firstPage.body.data.logs.map((log) => log.id || log._id);
    const secondPageIds = secondPage.body.data.logs.map((log) => log.id || log._id);
    expect(secondPageIds.some((id) => firstPageIds.includes(id))).toBe(false);
    expect(new Date(secondPage.body.data.logs[0].createdAt).getTime()).toBeLessThan(
      new Date(cursor).getTime()
    );
  });

  it("keeps the cursor and the filter honest together", async () => {
    const all = await readLogs({ action: "bracket.forceRegenerated" });
    const cursor = all.body.data.logs[0].createdAt;

    const older = await readLogs({ action: "bracket.forceRegenerated", before: cursor });

    expect(older.body.data.logs).toHaveLength(1);
    /* total answers "how many match the filter", not "how many are left". */
    expect(older.body.data.total).toBe(2);
  });

  it("ignores an unparseable cursor rather than refusing the read", async () => {
    const response = await readLogs({ before: "not-a-date" });

    expect(response.status).toBe(200);
    expect(response.body.data.logs).toHaveLength(4);
  });
});
