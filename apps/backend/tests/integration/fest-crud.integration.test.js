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

describe("POST /api/v1/fests", () => {
  it("creates a draft fest for an administrator", async () => {
    const response = await asAdmin(request(application).post(FESTS_PATH)).send(buildFestBody());

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe("draft");
    expect(response.body.data.festSlug).toBe("alliance-one-2027");
    expect(response.body.data._id).toBeUndefined();
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await request(application).post(FESTS_PATH).send(buildFestBody());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_TOKEN_MISSING");
  });

  it("refuses a caller who does not administer the college", async () => {
    const response = await request(application)
      .post(FESTS_PATH)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`)
      .send(buildFestBody());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  /*
   * require-administrator-middleware resolves the college from the body and runs
   * before the controller's validator, so an empty body is refused on
   * hostCollegeId alone. The remaining fields are only reached once it resolves.
   */
  it("rejects an empty payload on the host college it cannot resolve", async () => {
    const response = await asAdmin(request(application).post(FESTS_PATH)).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.hostCollegeId).toBe("must be a valid ObjectId");
  });

  it("rejects a payload whose other required fields are missing", async () => {
    const response = await asAdmin(request(application).post(FESTS_PATH)).send({
      hostCollegeId: college._id.toString(),
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.festName).toBe("is required");
    expect(response.body.error.details.visibility).toBe("is required");
  });

  /* The model's cross-field hook must surface as a 400, not a 500. */
  it("rejects a fest that ends before it starts", async () => {
    const response = await asAdmin(request(application).post(FESTS_PATH)).send(
      buildFestBody({ endsOn: "2027-02-01T00:00:00.000Z" })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.endsOn).toMatch(/on or after startsOn/);
  });

  it("ignores a client-supplied status and slug", async () => {
    const response = await asAdmin(request(application).post(FESTS_PATH)).send(
      buildFestBody({ status: "published", festSlug: "hacked" })
    );

    expect(response.body.data.status).toBe("draft");
    expect(response.body.data.festSlug).toBe("alliance-one-2027");
  });
});

describe("GET /api/v1/fests/mine", () => {
  /*
   * "Mine" means the administrator's SCOPE, not their authorship: the route
   * calls fetchFestsForAdministrator, which returns the caller's college's fests
   * as well as the ones they created. Both fixtures here are hosted at the same
   * college, so both come back — see the unit test on that service for why.
   */
  it("returns the fests in the caller's administrator scope", async () => {
    await createTestFest(college, admin.user);
    await createTestFest(college, outsider.user, { festSlug: "someone-else" });

    const response = await asAdmin(request(application).get(`${FESTS_PATH}/mine`));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await request(application).get(`${FESTS_PATH}/mine`);
    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/fests/:festId", () => {
  it("returns the fest for its administrator", async () => {
    const fest = await createTestFest(college, admin.user);
    const response = await asAdmin(request(application).get(`${FESTS_PATH}/${fest.id}`));

    expect(response.status).toBe(200);
    expect(response.body.data.festName).toBe("Alliance ONE 2027");
  });

  it("refuses an unauthenticated caller", async () => {
    const fest = await createTestFest(college, admin.user);
    const response = await request(application).get(`${FESTS_PATH}/${fest.id}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_TOKEN_MISSING");
  });

  it("refuses a caller who does not administer the college", async () => {
    const fest = await createTestFest(college, admin.user);
    const response = await request(application)
      .get(`${FESTS_PATH}/${fest.id}`)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("returns a 404 envelope for a missing fest", async () => {
    const response = await asAdmin(request(application).get(`${FESTS_PATH}/${MISSING_ID}`));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("FEST_NOT_FOUND");
  });
});

describe("PATCH /api/v1/fests/:festId", () => {
  it("updates only the fields sent", async () => {
    const fest = await createTestFest(college, admin.user);
    const response = await asAdmin(request(application).patch(`${FESTS_PATH}/${fest.id}`)).send({
      festName: "Renamed",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.festName).toBe("Renamed");
    expect(response.body.data.visibility).toBe("intraCollege");
  });

  it("refuses a caller who does not administer the fest", async () => {
    const fest = await createTestFest(college, admin.user);
    const response = await request(application)
      .patch(`${FESTS_PATH}/${fest.id}`)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`)
      .send({ festName: "Hacked" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects an invalid visibility", async () => {
    const fest = await createTestFest(college, admin.user);
    const response = await asAdmin(request(application).patch(`${FESTS_PATH}/${fest.id}`)).send({
      visibility: "secret",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });
});
