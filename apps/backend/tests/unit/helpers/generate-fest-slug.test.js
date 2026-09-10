import { describe, it, expect } from "vitest";
import { generateFestSlug } from "../../../src/helpers/generate-fest-slug.js";

describe("generateFestSlug", () => {
  it("lowercases a plain name and joins words with hyphens", () => {
    expect(generateFestSlug("Alliance ONE 2026")).toBe("alliance-one-2026");
  });

  it("strips accents down to their ASCII base letters", () => {
    expect(generateFestSlug("Rāgā Festival")).toBe("raga-festival");
  });

  it("collapses a run of non-alphanumeric characters into one hyphen", () => {
    expect(generateFestSlug("Code   Off!!! 2027")).toBe("code-off-2027");
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateFestSlug("----test----")).toBe("test");
  });

  it("returns an empty string for input that carries no slug", () => {
    expect(generateFestSlug("")).toBe("");
    expect(generateFestSlug("!!!")).toBe("");
  });

  it("returns an empty string for input that is not a string", () => {
    expect(generateFestSlug(undefined)).toBe("");
    expect(generateFestSlug(null)).toBe("");
  });
});
