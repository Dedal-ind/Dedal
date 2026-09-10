import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { FestModel } from "../../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import { CheckpointModel } from "../../../src/models/checkpoint-model.js";
import festService from "../../../src/services/fest-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
} from "../../setup/create-test-fixtures.js";

const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let outsider;

function buildFestAttributes(overrides = {}) {
  return {
    festName: "Alliance ONE 2027",
    hostCollegeId: college._id,
    startsOn: new Date("2027-03-01T00:00:00.000Z"),
    endsOn: new Date("2027-03-05T00:00:00.000Z"),
    visibility: "intraCollege",
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await FestModel.createIndexes();
  await StaffAssignmentModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
});

afterAll(teardownTestDatabase);

describe("createFest", () => {
  it("creates a draft fest owned by the administrator", async () => {
    const fest = await festService.createFest(admin.user._id, buildFestAttributes());

    expect(fest.status).toBe("draft");
    expect(fest.festSlug).toBe("alliance-one-2027");
    expect(fest.createdByUserId.toString()).toBe(admin.user._id.toString());
  });

  it("appends a numeric suffix when the slug is taken", async () => {
    await festService.createFest(admin.user._id, buildFestAttributes());
    const second = await festService.createFest(admin.user._id, buildFestAttributes());

    expect(second.festSlug).toBe("alliance-one-2027-2");
  });

  it("refuses a non-administrator", async () => {
    await expect(
      festService.createFest(outsider.user._id, buildFestAttributes())
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED", statusCode: 403 });
  });

  it("refuses a name that produces an empty slug", async () => {
    await expect(
      festService.createFest(admin.user._id, buildFestAttributes({ festName: "!!!" }))
    ).rejects.toMatchObject({ errorCode: "VALIDATION_FAILED", statusCode: 400 });
  });
});

describe("fetchFestsForAdministrator", () => {
  /*
   * SCOPE IS COLLEGE OR AUTHORSHIP, not authorship alone.
   *
   * A college administrator now sees their college's fests however they were
   * created, PLUS anything they authored themselves — the service's own comment
   * explains the second half, which covers a fest created before the assignment
   * existed. So the outsider's fest counts: createTestFest is given `college`,
   * the same college this admin administers, so it is hosted there whoever
   * pressed create.
   *
   * The old assertion — every row authored by the caller — was asserting the
   * narrower behaviour this replaced, and it would now fail on the outsider's
   * row even with the length corrected.
   */
  it("returns every fest at the administrator's college, however it was created", async () => {
    await createTestFest(college, admin.user, { festSlug: "older" });
    await createTestFest(college, admin.user, { festSlug: "newer", festName: "Newer" });
    await createTestFest(college, outsider.user, { festSlug: "someone-else" });

    const fests = await festService.fetchFestsForAdministrator(admin.user._id);

    expect(fests).toHaveLength(3);
    expect(
      fests.every((fest) => fest.hostCollegeId.toString() === college._id.toString())
    ).toBe(true);
    /* And the authored-by-someone-else row really is in there, which is the
       whole point of the college half of the filter. */
    expect(
      fests.some((fest) => fest.createdByUserId.toString() === outsider.user._id.toString())
    ).toBe(true);
  });

  it("returns an empty list for a user who created nothing", async () => {
    expect(await festService.fetchFestsForAdministrator(outsider.user._id)).toEqual([]);
  });
});

describe("fetchFestById", () => {
  it("returns the fest for its administrator", async () => {
    const fest = await createTestFest(college, admin.user);
    const found = await festService.fetchFestById(admin.user._id, fest.id);

    expect(found.id).toBe(fest.id);
    expect(found.festName).toBe("Alliance ONE 2027");
  });

  it("refuses a caller who does not administer the college", async () => {
    const fest = await createTestFest(college, admin.user);
    await expect(festService.fetchFestById(outsider.user._id, fest.id)).rejects.toMatchObject({
      errorCode: "PERMISSION_DENIED",
      statusCode: 403,
    });
  });

  it("treats a missing fest and a malformed id alike as a 404", async () => {
    for (const badId of [MISSING_ID, "not-an-object-id"]) {
      await expect(festService.fetchFestById(admin.user._id, badId)).rejects.toMatchObject({
        errorCode: "FEST_NOT_FOUND",
        statusCode: 404,
      });
    }
  });
});

describe("listPublicFests", () => {
  it("returns only published fests, sorted by startsOn, hiding draft and archived", async () => {
    await createTestFest(college, admin.user, { festSlug: "a-draft", festName: "Draft" });
    await createTestFest(college, admin.user, {
      festSlug: "later",
      festName: "Later",
      status: "published",
      startsOn: new Date("2027-06-01T00:00:00.000Z"),
      endsOn: new Date("2027-06-05T00:00:00.000Z"),
    });
    await createTestFest(college, admin.user, {
      festSlug: "sooner",
      festName: "Sooner",
      status: "published",
      startsOn: new Date("2027-03-01T00:00:00.000Z"),
      endsOn: new Date("2027-03-05T00:00:00.000Z"),
    });
    await createTestFest(college, admin.user, {
      festSlug: "gone",
      festName: "Gone",
      status: "archived",
    });

    const fests = await festService.listPublicFests();

    expect(fests.map((fest) => fest.festName)).toEqual(["Sooner", "Later"]);
    expect(fests.every((fest) => fest.status === "published")).toBe(true);
    // The host college is populated by name for the browse screen.
    expect(fests[0].hostCollegeId.commonName).toBe("Alliance");
  });

  it("returns an empty list when nothing is published", async () => {
    await createTestFest(college, admin.user);
    expect(await festService.listPublicFests()).toEqual([]);
  });
});

describe("getPublicFestById", () => {
  it("returns a published fest with its host college populated", async () => {
    const fest = await createTestFest(college, admin.user, { status: "published" });
    const found = await festService.getPublicFestById(fest.id);

    expect(found.id).toBe(fest.id);
    expect(found.hostCollegeId.city).toBe("Bengaluru");
  });

  it("hides a draft fest behind the same 404 as a missing one", async () => {
    const draft = await createTestFest(college, admin.user);
    for (const badId of [draft.id, MISSING_ID, "not-an-object-id"]) {
      await expect(festService.getPublicFestById(badId)).rejects.toMatchObject({
        errorCode: "FEST_NOT_FOUND",
        statusCode: 404,
      });
    }
  });

  it("hides an archived fest behind a 404", async () => {
    const archived = await createTestFest(college, admin.user, { status: "archived" });
    await expect(festService.getPublicFestById(archived.id)).rejects.toMatchObject({
      errorCode: "FEST_NOT_FOUND",
      statusCode: 404,
    });
  });
});

describe("updateFest", () => {
  it("applies the patch and re-runs the cross-field hook", async () => {
    const fest = await createTestFest(college, admin.user);
    const updated = await festService.updateFest(admin.user._id, fest.id, { festName: "Renamed" });

    expect(updated.festName).toBe("Renamed");
  });

  it("rejects a patch that breaks an invariant", async () => {
    const fest = await createTestFest(college, admin.user);

    await expect(
      festService.updateFest(admin.user._id, fest.id, {
        endsOn: new Date("2026-01-01T00:00:00.000Z"),
      })
    ).rejects.toThrow(/endsOn must be on or after startsOn/);
  });

  it("refuses a non-administrator", async () => {
    const fest = await createTestFest(college, admin.user);

    await expect(
      festService.updateFest(outsider.user._id, fest.id, { festName: "Hacked" })
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED" });
  });

  it("refuses to edit an archived fest, naming the state and the action", async () => {
    const fest = await createTestFest(college, admin.user, { status: "archived" });

    const error = await festService
      .updateFest(admin.user._id, fest.id, { festName: "Renamed" })
      .catch((caughtError) => caughtError);

    expect(error.errorCode).toBe("INVALID_FEST_STATE");
    expect(error.statusCode).toBe(409);
    expect(error.details).toEqual({ currentStatus: "archived", attemptedAction: "update" });
  });

  /* Neither published nor draft is terminal, so both stay editable. */
  it("allows editing a published fest", async () => {
    const fest = await createTestFest(college, admin.user, { status: "published" });
    const updated = await festService.updateFest(admin.user._id, fest.id, { festName: "Renamed" });

    expect(updated.festName).toBe("Renamed");
  });
});

describe("publishFest", () => {
  it("creates a single gate checkpoint on publish", async () => {
    const fest = await createTestFest(college, admin.user, { status: "draft" });
    await festService.publishFest(admin.user._id, fest.id);

    const gates = await CheckpointModel.find({ festId: fest._id, checkpointType: "gate" });
    expect(gates).toHaveLength(1);
    expect(gates[0].checkpointName).toBe("Main Gate");
    expect(gates[0].directionMode).toBe("inAndOut");
    expect(gates[0].eventId).toBeNull();
  });

  it("does not duplicate the gate when a republished fest is published again", async () => {
    const fest = await createTestFest(college, admin.user, { status: "draft" });
    await festService.publishFest(admin.user._id, fest.id);
    await festService.archiveFest(admin.user._id, fest.id);
    await festService.unarchiveFest(admin.user._id, fest.id);
    await festService.publishFest(admin.user._id, fest.id);

    const gates = await CheckpointModel.find({ festId: fest._id, checkpointType: "gate" });
    expect(gates).toHaveLength(1);
  });
});

describe("offer checkpoint materialisation", () => {
  const twoOffers = [
    { offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true },
    { offerName: "Accommodation", offerKey: "accommodation", requiresQuantity: false, isActive: true },
  ];

  async function publishedFestWithOffers() {
    const fest = await createTestFest(college, admin.user, { status: "draft", offers: twoOffers });
    await festService.publishFest(admin.user._id, fest.id);
    return FestModel.findById(fest._id);
  }

  it("publishing materialises one checkpoint per active offer", async () => {
    const fest = await publishedFestWithOffers();
    const offerCheckpoints = await CheckpointModel.find({ festId: fest._id, checkpointType: "offer" });
    expect(offerCheckpoints).toHaveLength(2);
    const names = offerCheckpoints.map((checkpoint) => checkpoint.checkpointName).sort();
    expect(names).toEqual(["Accommodation", "Food"]);
    const offerIds = fest.offers.map((offer) => String(offer._id)).sort();
    expect(offerCheckpoints.map((checkpoint) => String(checkpoint.offerId)).sort()).toEqual(offerIds);
  });

  it("republishing creates no duplicates", async () => {
    const fest = await publishedFestWithOffers();
    await festService.archiveFest(admin.user._id, fest.id);
    await festService.unarchiveFest(admin.user._id, fest.id);
    await festService.publishFest(admin.user._id, fest.id);
    expect(await CheckpointModel.countDocuments({ festId: fest._id, checkpointType: "offer" })).toBe(2);
  });

  it("deactivating an offer flips its checkpoint isActive false and never deletes it", async () => {
    const fest = await publishedFestWithOffers();
    const updatedOffers = fest.offers.map((offer) => ({
      offerName: offer.offerName,
      offerKey: offer.offerKey,
      requiresQuantity: offer.requiresQuantity,
      isActive: offer.offerKey !== "food",
    }));
    await festService.updateFest(admin.user._id, fest.id, { offers: updatedOffers });

    const offerCheckpoints = await CheckpointModel.find({ festId: fest._id, checkpointType: "offer" });
    expect(offerCheckpoints).toHaveLength(2);
    const foodCheckpoint = offerCheckpoints.find((checkpoint) => checkpoint.checkpointName === "Food");
    expect(foodCheckpoint.isActive).toBe(false);
  });

  it("renaming an offer renames its checkpoint, keeping the same row", async () => {
    const fest = await publishedFestWithOffers();
    const beforeCheckpoint = await CheckpointModel.findOne({
      festId: fest._id,
      checkpointType: "offer",
      checkpointName: "Food",
    });

    // A rebuilt offers array with the same offerKey IS the same offer — the
    // service carries the subdocument _id over, so the checkpoint renames in
    // place. (A slug-changing rename is a new identity by design.)
    const renamedOffers = [
      { offerName: "FOOD", offerKey: "food", requiresQuantity: true, isActive: true },
      { offerName: "Accommodation", offerKey: "accommodation", requiresQuantity: false, isActive: true },
    ];
    await festService.updateFest(admin.user._id, fest.id, { offers: renamedOffers });

    const renamed = await CheckpointModel.findById(beforeCheckpoint._id);
    expect(renamed.checkpointName).toBe("FOOD");
    expect(await CheckpointModel.countDocuments({ festId: fest._id, checkpointType: "offer" })).toBe(2);
  });
});
