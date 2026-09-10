import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import {
  resolveScanAuthorization,
  SCAN_AUTHORIZATION_OUTCOMES,
} from "../../../src/helpers/scan-authorization.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestStaffMember,
} from "../../setup/create-test-fixtures.js";

let fest;

function checkpoint(checkpointType) {
  return {
    _id: new mongoose.Types.ObjectId(),
    festId: fest._id,
    checkpointType,
    eventId: null,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    StaffAssignmentModel.createIndexes(),
    UserModel.createIndexes(),
    FestModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  const college = await createTestCollege();
  const admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("resolveScanAuthorization — volunteer checkpoint-type scoping", () => {
  it("authorizes a type-scoped volunteer at a matching checkpoint type", async () => {
    const volunteer = await createTestStaffMember(fest, "volunteer", {
      assignment: { allowedCheckpointTypes: ["foodCounter"] },
    });

    const outcome = await resolveScanAuthorization(
      volunteer.user._id,
      checkpoint("foodCounter"),
      new Date()
    );

    expect(outcome).toBe(SCAN_AUTHORIZATION_OUTCOMES.AUTHORIZED);
  });

  it("denies a type-scoped volunteer at a checkpoint type outside their scope with 403", async () => {
    const volunteer = await createTestStaffMember(fest, "volunteer", {
      assignment: { allowedCheckpointTypes: ["foodCounter"] },
    });

    await expect(
      resolveScanAuthorization(volunteer.user._id, checkpoint("gate"), new Date())
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "PERMISSION_DENIED" });
  });

  it("authorizes an unrestricted volunteer (empty allowedCheckpointTypes) at any type", async () => {
    const volunteer = await createTestStaffMember(fest, "volunteer", {
      assignment: { allowedCheckpointTypes: [] },
    });

    const atGate = await resolveScanAuthorization(volunteer.user._id, checkpoint("gate"), new Date());
    const atFood = await resolveScanAuthorization(
      volunteer.user._id,
      checkpoint("foodCounter"),
      new Date()
    );

    expect(atGate).toBe(SCAN_AUTHORIZATION_OUTCOMES.AUTHORIZED);
    expect(atFood).toBe(SCAN_AUTHORIZATION_OUTCOMES.AUTHORIZED);
  });
});
