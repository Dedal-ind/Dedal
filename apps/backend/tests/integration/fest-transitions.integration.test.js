import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { application } from "../../src/application.js";
import { FestModel } from "../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
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
} from "../setup/create-test-fixtures.js";

const FESTS_PATH = "/api/v1/fests";
const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let outsider;

function asAdmin(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${admin.authenticationToken}`);
}

function buildFestBody(overrides = {}) {
  return {
    festName: "Alliance ONE 2027",
    hostCollegeId: college._id.toString(),
    startsOn: "2027-03-01T00:00:00.000Z",
    endsOn: "2027-03-05T00:00:00.000Z",
    visibility: "intraCollege",
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await FestModel.createIndexes();
  await StaffAssignmentModel.createIndexes();
  await UserModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
});

afterAll(teardownTestDatabase);

/* Split from fest-crud.integration.test.js to stay within the per-file line budget. */
describe("fest status transitions", () => {
  it("walks draft to published to archived and back to draft", async () => {
    const fest = await createTestFest(college, admin.user);

    const published = await asAdmin(request(application).post(`${FESTS_PATH}/${fest.id}/publish`));
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("published");

    const archived = await asAdmin(request(application).post(`${FESTS_PATH}/${fest.id}/archive`));
    expect(archived.body.data.status).toBe("archived");
    expect(archived.body.data.archivedAt).not.toBe(null);

    const unarchived = await asAdmin(
      request(application).post(`${FESTS_PATH}/${fest.id}/unarchive`)
    );
    expect(unarchived.body.data.status).toBe("draft");
    expect(unarchived.body.data.archivedAt).toBe(null);
  });

  it("refuses an illegal transition with both ends named", async () => {
    const fest = await createTestFest(college, admin.user, { status: "published" });
    const response = await asAdmin(request(application).post(`${FESTS_PATH}/${fest.id}/publish`));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_FEST_STATE");
    expect(response.body.error.details).toEqual({
      currentStatus: "published",
      attemptedTransition: "published",
    });
  });

  it("refuses a transition from a caller who is not an administrator", async () => {
    const fest = await createTestFest(college, admin.user);
    const response = await request(application)
      .post(`${FESTS_PATH}/${fest.id}/archive`)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`);

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/v1/fests/:festId on a terminal fest", () => {
  it("refuses to edit an archived fest, naming the state and the action", async () => {
    const fest = await createTestFest(college, admin.user, { status: "archived" });

    const response = await asAdmin(request(application).patch(`${FESTS_PATH}/${fest.id}`)).send({
      festName: "Renamed",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_FEST_STATE");
    expect(response.body.error.details).toMatchObject({
      currentStatus: "archived",
      attemptedAction: "update",
    });
  });

  /* Published is not terminal, so it stays editable. */
  it("still allows editing a published fest", async () => {
    const fest = await createTestFest(college, admin.user, { status: "published" });

    const response = await asAdmin(request(application).patch(`${FESTS_PATH}/${fest.id}`)).send({
      festName: "Renamed",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.festName).toBe("Renamed");
  });
});
