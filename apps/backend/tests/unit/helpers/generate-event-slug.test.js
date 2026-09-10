import { describe, it, expect } from "vitest";
import { generateEventSlug } from "../../../src/helpers/generate-event-slug.js";

describe("generateEventSlug", () => {
  it("lowercases a plain name and joins words with hyphens", () => {
    expect(generateEventSlug("Robowars 2027")).toBe("robowars-2027");
  });

  it("strips accents down to their ASCII base letters", () => {
    expect(generateEventSlug("Rāgā Sangam")).toBe("raga-sangam");
  });

  it("collapses a run of non-alphanumeric characters into one hyphen", () => {
    expect(generateEventSlug("Robowars   2027!!!")).toBe("robowars-2027");
  });

  it("trims the whitespace that would otherwise become edge hyphens", () => {
    expect(generateEventSlug("  Code Off  ")).toBe("code-off");
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateEventSlug("---test---")).toBe("test");
  });

  it("returns an empty string for a name that carries no slug", () => {
    expect(generateEventSlug("")).toBe("");
    expect(generateEventSlug("!!!")).toBe("");
  });

  it("returns an empty string for input that is not a string", () => {
    expect(generateEventSlug(undefined)).toBe("");
    expect(generateEventSlug(null)).toBe("");
    expect(generateEventSlug(42)).toBe("");
  });
});
