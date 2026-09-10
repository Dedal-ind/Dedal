import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { CollegeModel } from "../../src/models/college-model.js";
import {
  migrateCollegeAddress,
  SENTINEL_PIN_CODE,
} from "../../src/helpers/migrate-college-address.js";
import { validateRegisterCollegePayload } from "../../src/validators/college-validators.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";

/*
 * The structured college address: what the validator accepts, what the model
 * keeps in step, and what the migration plants on colleges that predate it.
 */

const VALID_ADDRESS = {
  addressLine1: "12 University Road",
  addressLine2: "Near the old library",
  city: "Bengaluru",
  district: "Bengaluru Urban",
  state: "Karnataka",
  pinCode: "560001",
};

function buildRegisterPayload(addressOverrides = {}) {
  return {
    collegeName: "Test Institute of Technology",
    commonName: "Test Institute",
    city: "Bengaluru",
    state: "Karnataka",
    address: { ...VALID_ADDRESS, ...addressOverrides },
  };
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);
beforeEach(clearAllCollections);

describe("PIN code validation", () => {
  it("accepts a real PIN and defaults the country to India", () => {
    const result = validateRegisterCollegePayload(buildRegisterPayload({ pinCode: "110001" }));
    expect(result.ok).toBe(true);
    expect(result.value.address.pinCode).toBe("110001");
    expect(result.value.address.country).toBe("India");
    // Absent optional fields are stored as null, never left undefined.
    expect(result.value.address.addressLine3).toBeNull();
    expect(result.value.address.townOrLocality).toBeNull();
  });

  it("rejects the migration sentinel 000000", () => {
    const result = validateRegisterCollegePayload(buildRegisterPayload({ pinCode: SENTINEL_PIN_CODE }));
    expect(result.ok).toBe(false);
    expect(result.error.details.pinCode).toBe(
      "must be a valid 6-digit Indian PIN code (first digit 1–8)"
    );
  });

  it("rejects a leading zero (012345)", () => {
    const result = validateRegisterCollegePayload(buildRegisterPayload({ pinCode: "012345" }));
    expect(result.ok).toBe(false);
    expect(result.error.details.pinCode).toBeDefined();
  });

  /*
   * KNOWN SPEC INCONSISTENCY, pinned deliberately. The mandated regex is
   * ^[1-9]\d{5}$, which admits a leading 9 — while the error message it pairs
   * with says "first digit 1–8". 9xxxxx is in fact allocated, to the Army
   * Postal Service, so accepting it is defensible; the MESSAGE is what is
   * inaccurate. This test documents the behaviour as built so that tightening
   * the regex to [1-8] (or rewording the message) is a deliberate decision and
   * not an accident.
   */
  it("accepts a leading nine (Army Postal Service range) — see the note above", () => {
    const result = validateRegisterCollegePayload(buildRegisterPayload({ pinCode: "912345" }));
    expect(result.ok).toBe(true);
  });

  it("rejects the wrong length and non-digits", () => {
    for (const invalidPinCode of ["56001", "5600011", "56A001"]) {
      const result = validateRegisterCollegePayload(buildRegisterPayload({ pinCode: invalidPinCode }));
      expect(result.ok, `${invalidPinCode} should be rejected`).toBe(false);
    }
  });
});

describe("required and optional address fields", () => {
  it("names every missing mandatory field, and leaves the optional ones alone", () => {
    const result = validateRegisterCollegePayload({
      collegeName: "Test Institute of Technology",
      commonName: "Test Institute",
      city: "Bengaluru",
      state: "Karnataka",
      address: { addressLine2: "only the optional one" },
    });
    expect(result.ok).toBe(false);
    expect(result.error.details).toMatchObject({
      addressLine1: "is required",
      city: "is required",
      state: "is required",
      pinCode: "is required",
    });
    expect(result.error.details.addressLine2).toBeUndefined();
    expect(result.error.details.addressLine3).toBeUndefined();
    expect(result.error.details.townOrLocality).toBeUndefined();
    expect(result.error.details.country).toBeUndefined();
    /*
     * district is OPTIONAL now. The registration form stopped collecting it
     * (city, state and PIN identify an Indian address without it), and it is
     * still accepted and still stored so applications submitted before that
     * change keep their district.
     */
    expect(result.error.details.district).toBeUndefined();
  });

  it("requires the address object itself", () => {
    const payload = buildRegisterPayload();
    delete payload.address;
    const result = validateRegisterCollegePayload(payload);
    expect(result.ok).toBe(false);
    expect(result.error.details.address).toBe("is required");
  });

  it("never lets isVerified through the validator", () => {
    const result = validateRegisterCollegePayload({ ...buildRegisterPayload(), isVerified: true });
    expect(result.ok).toBe(true);
    expect(result.value.isVerified).toBeUndefined();
  });
});

describe("top-level city/state stay in step with the address", () => {
  it("a save rewrites the summary fields from the address", async () => {
    const college = await CollegeModel.create({
      collegeName: "Sync Test College",
      commonName: "Sync Test",
      // Deliberately disagreeing with the address below.
      city: "Stale City",
      state: "Stale State",
      address: { ...VALID_ADDRESS },
    });
    expect(college.city).toBe("Bengaluru");
    expect(college.state).toBe("Karnataka");

    college.address.city = "Mysuru";
    college.address.district = "Mysuru";
    await college.save();
    expect(college.city).toBe("Mysuru");
  });

  it("a college with no address keeps its own city/state untouched", async () => {
    const college = await CollegeModel.create({
      collegeName: "Reference College",
      commonName: "Reference",
      city: "Hubballi",
      state: "Karnataka",
      status: "reference",
    });
    expect(college.city).toBe("Hubballi");
    expect(college.address).toBeUndefined();
  });
});

describe("migration", () => {
  it("plants the sentinel on every address-less college and skips the rest", async () => {
    await CollegeModel.create({
      collegeName: "Old Reference College",
      commonName: "Old Reference",
      city: "Mangaluru",
      state: "Karnataka",
      status: "reference",
    });
    await CollegeModel.create({
      collegeName: "Another Old College",
      commonName: "Another Old",
      city: "Belagavi",
      state: "Karnataka",
      status: "reference",
    });
    const alreadyAddressed = await CollegeModel.create({
      collegeName: "New College",
      commonName: "New",
      city: "Bengaluru",
      state: "Karnataka",
      address: { ...VALID_ADDRESS },
    });

    const { convertedCount } = await migrateCollegeAddress();
    expect(convertedCount).toBe(2);

    const migrated = await CollegeModel.findOne({ commonName: "Old Reference" }).lean();
    expect(migrated.address).toMatchObject({
      addressLine1: "Old Reference College", // the full name is the best guess
      city: "Mangaluru",
      state: "Karnataka",
      district: "—",
      pinCode: SENTINEL_PIN_CODE,
      country: "India",
    });

    // The sentinel is intentionally invalid, so any later edit must supply a
    // real PIN before it can be saved.
    const sentinelResult = validateRegisterCollegePayload(
      buildRegisterPayload({ pinCode: migrated.address.pinCode })
    );
    expect(sentinelResult.ok).toBe(false);

    // A college that already had an address is untouched.
    const untouched = await CollegeModel.findById(alreadyAddressed._id).lean();
    expect(untouched.address.pinCode).toBe("560001");

    // Idempotent: a second run finds nothing left to convert.
    const secondRun = await migrateCollegeAddress();
    expect(secondRun.convertedCount).toBe(0);
  });
});
