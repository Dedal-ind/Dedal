import { describe, it, expect } from "vitest";
import {
  validateCreateFestPayload,
  validateUpdateFestPayload,
} from "../../../src/validators/fest-validators.js";

const VALID_COLLEGE_ID = "6a4f697d132f3ed2c291a7dc";

function buildCreatePayload(overrides = {}) {
  return {
    festName: "Alliance ONE 2027",
    hostCollegeId: VALID_COLLEGE_ID,
    startsOn: "2027-03-01T00:00:00.000Z",
    endsOn: "2027-03-05T00:00:00.000Z",
    visibility: "intraCollege",
    ...overrides,
  };
}

describe("validateCreateFestPayload", () => {
  it("accepts a complete payload and returns parsed values", () => {
    const result = validateCreateFestPayload(buildCreatePayload());

    expect(result.ok).toBe(true);
    expect(result.value.festName).toBe("Alliance ONE 2027");
    expect(result.value.startsOn).toBeInstanceOf(Date);
  });

  it("trims a padded fest name", () => {
    const result = validateCreateFestPayload(buildCreatePayload({ festName: "  Spaced  " }));
    expect(result.value.festName).toBe("Spaced");
  });

  it("rejects a body that is not an object", () => {
    for (const badBody of [null, "string", 42]) {
      const result = validateCreateFestPayload(badBody);
      expect(result.ok).toBe(false);
      expect(result.error.details.body).toBe("must be a JSON object");
    }
  });

  it("names every missing required field at once", () => {
    const result = validateCreateFestPayload({});

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(result.error.details).sort()).toEqual([
      "endsOn",
      "festName",
      "hostCollegeId",
      "startsOn",
      "visibility",
    ]);
  });

  it("rejects an empty fest name rather than treating it as absent", () => {
    const result = validateCreateFestPayload(buildCreatePayload({ festName: "   " }));
    expect(result.error.details.festName).toBe("must be a non-empty string");
  });

  it("rejects a malformed ObjectId", () => {
    const result = validateCreateFestPayload(buildCreatePayload({ hostCollegeId: "nope" }));
    expect(result.error.details.hostCollegeId).toBe("must be a valid ObjectId");
  });

  it("rejects an unparseable date", () => {
    const result = validateCreateFestPayload(buildCreatePayload({ startsOn: "not-a-date" }));
    expect(result.error.details.startsOn).toBe("must be a valid ISO 8601 date");
  });

  it("rejects a visibility outside the enum and names the allowed values", () => {
    const result = validateCreateFestPayload(buildCreatePayload({ visibility: "secret" }));
    expect(result.error.details.visibility).toContain("must be one of:");
  });

  it("rejects an allowedCollegeIds entry that is not an ObjectId", () => {
    const result = validateCreateFestPayload(
      buildCreatePayload({ visibility: "interCollege", allowedCollegeIds: ["nope"] })
    );
    expect(result.error.details.allowedCollegeIds).toContain("every entry");
  });

  it("rejects allowedCollegeIds that is not an array", () => {
    const result = validateCreateFestPayload(buildCreatePayload({ allowedCollegeIds: "x" }));
    expect(result.error.details.allowedCollegeIds).toBe("must be an array");
  });

  /* The whitelist is what stops a client from setting server-owned fields. */
  it("silently drops fields outside the whitelist", () => {
    const result = validateCreateFestPayload(
      buildCreatePayload({ status: "published", festSlug: "hacked", createdByUserId: "x" })
    );

    expect(result.ok).toBe(true);
    expect(result.value.status).toBeUndefined();
    expect(result.value.festSlug).toBeUndefined();
    expect(result.value.createdByUserId).toBeUndefined();
  });
});

describe("validateUpdateFestPayload", () => {
  it("accepts an empty body because every field is optional", () => {
    const result = validateUpdateFestPayload({});
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
  });

  it("validates only the fields that are present", () => {
    const result = validateUpdateFestPayload({ festName: "Renamed" });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ festName: "Renamed" });
  });

  it("still rejects a present-but-invalid field", () => {
    const result = validateUpdateFestPayload({ visibility: "secret" });
    expect(result.ok).toBe(false);
  });

  /* A fest cannot be moved to another college, so hostCollegeId is not updatable. */
  it("drops hostCollegeId even though create accepts it", () => {
    const result = validateUpdateFestPayload({ hostCollegeId: VALID_COLLEGE_ID });
    expect(result.ok).toBe(true);
    expect(result.value.hostCollegeId).toBeUndefined();
  });
});
