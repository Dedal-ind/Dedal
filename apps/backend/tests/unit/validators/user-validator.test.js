import { describe, it, expect } from "vitest";
import { validateUpdateProfilePayload } from "../../../src/validators/user-validator.js";

const VALID_COLLEGE_ID = "6a4f697d132f3ed2c291a7dc";

function buildUpdateProfilePayload(overrides = {}) {
  return {
    fullName: "Asha Participant",
    collegeId: VALID_COLLEGE_ID,
    usn: "1RV21CS001",
    phoneNumber: "9876543210",
    ...overrides,
  };
}

describe("validateUpdateProfilePayload — department", () => {
  it("rejects a department longer than 100 characters with a field-level reason", () => {
    const result = validateUpdateProfilePayload(
      buildUpdateProfilePayload({ department: "a".repeat(101) })
    );
    expect(result.ok).toBe(false);
    expect(result.error.details.department).toBe("must be at most 100 characters");
  });

  it("accepts a department of exactly 100 characters", () => {
    const department = "a".repeat(100);
    const result = validateUpdateProfilePayload(buildUpdateProfilePayload({ department }));
    expect(result.ok).toBe(true);
    expect(result.value.department).toBe(department);
  });

  it("resolves a whitespace-only department to null", () => {
    const result = validateUpdateProfilePayload(buildUpdateProfilePayload({ department: "   " }));
    expect(result.ok).toBe(true);
    expect(result.value.department).toBeNull();
  });

  it("collapses internal whitespace runs to a single space", () => {
    const result = validateUpdateProfilePayload(
      buildUpdateProfilePayload({ department: "Computer   Science" })
    );
    expect(result.ok).toBe(true);
    expect(result.value.department).toBe("Computer Science");
  });
});
