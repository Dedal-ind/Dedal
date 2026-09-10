import { describe, it, expect } from "vitest";
import { deriveAgeInYears, isUnderEighteen } from "../../../src/helpers/age-helpers.js";
import { UserModel } from "../../../src/models/user-model.js";

const utc = (year, month, day) => new Date(Date.UTC(year, month - 1, day));

describe("isUnderEighteen", () => {
  it("returns UNKNOWN (null), never false, when there is no usable date of birth", () => {
    expect(isUnderEighteen(null)).toBeNull();
    expect(isUnderEighteen(undefined)).toBeNull();
    expect(isUnderEighteen("")).toBeNull();
    expect(isUnderEighteen("not a date")).toBeNull();
    expect(deriveAgeInYears(null)).toBeNull();
  });

  it("is true below eighteen and false at or above it", () => {
    const today = utc(2026, 9, 7);
    expect(isUnderEighteen(utc(2010, 1, 1), today)).toBe(true);
    expect(isUnderEighteen(utc(2008, 9, 8), today)).toBe(true); // 18 tomorrow
    expect(isUnderEighteen(utc(2008, 9, 7), today)).toBe(false); // 18 today
    expect(isUnderEighteen(utc(2000, 1, 1), today)).toBe(false);
    expect(deriveAgeInYears(utc(2008, 9, 7), today)).toBe(18);
    expect(deriveAgeInYears(utc(2008, 9, 8), today)).toBe(17);
  });

  it("flips on the eighteenth birthday with no write — the same stored date, a different day", () => {
    const dateOfBirth = utc(2008, 9, 7);
    expect(isUnderEighteen(dateOfBirth, utc(2026, 9, 6))).toBe(true);
    expect(isUnderEighteen(dateOfBirth, utc(2026, 9, 7))).toBe(false);
  });

  it("handles a 29 February birthday without crediting a day early", () => {
    const leapBirth = utc(2008, 2, 29);
    expect(isUnderEighteen(leapBirth, utc(2026, 2, 28))).toBe(true);
    expect(isUnderEighteen(leapBirth, utc(2026, 3, 1))).toBe(false);
  });
});

describe("UserModel.isUnderEighteen virtual", () => {
  it("derives from dateOfBirth alone, with nothing stored and unknown when absent", () => {
    // No database: a document instance is enough, which is the point — the
    // predicate is computed, not persisted.
    const child = new UserModel({ emailAddress: "a@example.com", dateOfBirth: utc(2015, 1, 1) });
    const adult = new UserModel({ emailAddress: "b@example.com", dateOfBirth: utc(1990, 1, 1) });
    const unknown = new UserModel({ emailAddress: "c@example.com" });

    expect(child.isUnderEighteen).toBe(true);
    expect(adult.isUnderEighteen).toBe(false);
    expect(unknown.isUnderEighteen).toBeNull();

    // Nothing in the stored shape carries the answer.
    const stored = child.toObject({ virtuals: false });
    expect(Object.keys(stored)).not.toContain("isUnderEighteen");
    expect(Object.keys(stored)).not.toContain("age");
    // But the JSON a client reads does.
    expect(child.toJSON().isUnderEighteen).toBe(true);
  });
});
