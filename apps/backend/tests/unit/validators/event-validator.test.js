import { describe, it, expect } from "vitest";
import {
  validateCreateEventPayload,
  validateUpdateEventPayload,
} from "../../../src/validators/event-validator.js";

function buildCreatePayload(overrides = {}) {
  return {
    eventName: "Robowars 2027",
    description: "Robotics combat.",
    category: "technical",
    eventType: "team",
    venue: "Robotics Lab",
    startsAt: "2027-03-01T10:00:00.000Z",
    endsAt: "2027-03-01T18:00:00.000Z",
    registrationOpensAt: "2027-01-01T00:00:00.000Z",
    registrationClosesAt: "2027-02-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateCreateEventPayload", () => {
  it("accepts a complete payload and parses dates into Date objects", () => {
    const result = validateCreateEventPayload(buildCreatePayload());

    expect(result.ok).toBe(true);
    expect(result.value.eventName).toBe("Robowars 2027");
    expect(result.value.startsAt).toBeInstanceOf(Date);
  });

  it("rejects a body that is not an object", () => {
    const result = validateCreateEventPayload(null);
    expect(result.ok).toBe(false);
    expect(result.error.details.body).toBe("must be a JSON object");
  });

  it("names every missing required field at once", () => {
    const result = validateCreateEventPayload({});

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(result.error.details).sort()).toEqual([
      "description",
      "endsAt",
      "eventName",
      "eventType",
      "registrationClosesAt",
      "registrationOpensAt",
      "startsAt",
      "venue",
    ]);
  });

  it("rejects each enum field with the allowed values named", () => {
    // category is FREE TEXT since the enum was removed; only eventType and
    // scoringFormat remain enum-constrained.
    const enumFields = { eventType: "duo", scoringFormat: "vibes" };

    for (const [fieldName, badValue] of Object.entries(enumFields)) {
      const result = validateCreateEventPayload(buildCreatePayload({ [fieldName]: badValue }));
      expect(result.ok).toBe(false);
      expect(result.error.details[fieldName]).toContain("must be one of:");
    }
  });

  it("rejects a non-integer or below-minimum team size", () => {
    for (const badSize of [0, -1, 2.5, "2"]) {
      const result = validateCreateEventPayload(buildCreatePayload({ minimumTeamSize: badSize }));
      expect(result.error.details.minimumTeamSize).toBe("must be an integer of at least 1");
    }
  });

  it("allows a zero fee but rejects a negative one", () => {
    expect(validateCreateEventPayload(buildCreatePayload({ feeAmountPaise: 0 })).ok).toBe(true);
    const result = validateCreateEventPayload(buildCreatePayload({ feeAmountPaise: -1 }));
    expect(result.error.details.feeAmountPaise).toBe("must be an integer of at least 0");
  });

  /* null capacity means unlimited, which is the one number where null is meaningful. */
  it("accepts a null capacity and rejects a zero one", () => {
    expect(validateCreateEventPayload(buildCreatePayload({ capacity: null })).value.capacity).toBe(
      null
    );
    expect(validateCreateEventPayload(buildCreatePayload({ capacity: 0 })).ok).toBe(false);
  });

  it("clears an optional free-text field to null rather than to an empty string", () => {
    const result = validateCreateEventPayload(buildCreatePayload({ rules: "   " }));
    expect(result.value.rules).toBe(null);
  });

  it("rejects a poster URL that is not a URL", () => {
    const result = validateCreateEventPayload(buildCreatePayload({ posterImageUrl: "not a url" }));
    expect(result.error.details.posterImageUrl).toBe("must be a valid URL");
  });

  it("accepts a valid poster URL and a null one", () => {
    expect(
      validateCreateEventPayload(buildCreatePayload({ posterImageUrl: "https://example.com/a.png" }))
        .ok
    ).toBe(true);
    expect(validateCreateEventPayload(buildCreatePayload({ posterImageUrl: null })).ok).toBe(true);
  });

  it("rejects a non-boolean waitlist flag", () => {
    const result = validateCreateEventPayload(buildCreatePayload({ waitlistEnabled: "yes" }));
    expect(result.error.details.waitlistEnabled).toBe("must be a boolean");
  });

  it("rejects a category array that is not an array, and one holding a blank entry", () => {
    expect(
      validateCreateEventPayload(buildCreatePayload({ weightCategories: "58kg" })).error.details
        .weightCategories
    ).toBe("must be an array");
    expect(
      validateCreateEventPayload(buildCreatePayload({ genderCategories: ["  "] })).error.details
        .genderCategories
    ).toContain("every entry");
  });

  /* The whitelist is what stops a client from setting server-owned fields. */
  it("silently drops festId, eventSlug, status and registeredCount", () => {
    const result = validateCreateEventPayload(
      buildCreatePayload({
        festId: "6a4f697d132f3ed2c291a7dc",
        eventSlug: "hacked",
        status: "published",
        registeredCount: 999,
        createdByUserId: "x",
      })
    );

    expect(result.ok).toBe(true);
    for (const forbiddenField of [
      "festId",
      "eventSlug",
      "status",
      "registeredCount",
      "createdByUserId",
    ]) {
      expect(result.value[forbiddenField]).toBeUndefined();
    }
  });
});

describe("validateUpdateEventPayload", () => {
  it("accepts an empty body because every field is optional", () => {
    const result = validateUpdateEventPayload({});
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
  });

  it("validates only the fields that are present", () => {
    const result = validateUpdateEventPayload({ venue: "Hall B" });
    expect(result.value).toEqual({ venue: "Hall B" });
  });

  it("still rejects a present-but-invalid field", () => {
    expect(validateUpdateEventPayload({ eventType: "duo" }).ok).toBe(false);
  });

  it("drops the same forbidden fields as create", () => {
    const result = validateUpdateEventPayload({ status: "published", registeredCount: 5 });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({});
  });
});
