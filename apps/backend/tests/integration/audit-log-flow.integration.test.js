import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { FestModel } from "../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
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
  createTestOutsider,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const FESTS_PATH = "/api/v1/fests";
const AUDIT_LOGS_PATH = "/api/v1/admin/audit-logs";

let college;
let admin;
let outsider;

function buildFestBody() {
  return {
    festName: "Alliance ONE 2027",
    hostCollegeId: college._id.toString(),
    startsOn: "2027-03-01T00:00:00.000Z",
    endsOn: "2027-03-05T00:00:00.000Z",
    visibility: "intraCollege",
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    FestModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    UserModel.createIndexes(),
    AuditLogModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
});

afterAll(teardownTestDatabase);

describe("audit logging on fest creation", () => {
  it("writes a fest.created row when a fest is created", async () => {
    const response = await request(application)
      .post(FESTS_PATH)
      .set("Authorization", `Bearer ${admin.authenticationToken}`)
      .send(buildFestBody());
    expect(response.status).toBe(201);

    const logs = await AuditLogModel.find({ action: "fest.created" });
    expect(logs).toHaveLength(1);
    expect(logs[0].entityType).toBe("fest");
    expect(String(logs[0].actorUserId)).toBe(String(admin.user._id));
  });

  it("returns the log through the admin audit-log endpoint", async () => {
    const created = await request(application)
      .post(FESTS_PATH)
      .set("Authorization", `Bearer ${admin.authenticationToken}`)
      .send(buildFestBody());
    const festId = created.body.data.id;

    const response = await request(application)
      .get(AUDIT_LOGS_PATH)
      .query({ festId })
      .set("Authorization", `Bearer ${admin.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.logs[0].action).toBe("fest.created");
    expect(response.body.data.logs[0].actorUserId.emailAddress).toBe(admin.user.emailAddress);
  });

  it("refuses a non-administrator of the fest", async () => {
    const created = await request(application)
      .post(FESTS_PATH)
      .set("Authorization", `Bearer ${admin.authenticationToken}`)
      .send(buildFestBody());
    const festId = created.body.data.id;

    const response = await request(application)
      .get(AUDIT_LOGS_PATH)
      .query({ festId })
      .set("Authorization", `Bearer ${outsider.authenticationToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });
});
