import { describe, it, expect } from "vitest";
import { extractBearerToken } from "../../../src/helpers/extract-bearer-token-helper.js";

/*
 * Characterization tests: they lock in exactly what the two middlewares did
 * before the parsing was extracted, so the shared helper cannot silently drift
 * the accept/reject boundary. They pass both before and after the extraction.
 */
describe("extractBearerToken", () => {
  it("returns the token for a well-formed Bearer header", () => {
    expect(extractBearerToken("Bearer some-token-value")).toBe("some-token-value");
  });

  it("returns the token for a lowercase 'bearer' scheme (RFC 6750 case-insensitive)", () => {
    expect(extractBearerToken("bearer some-token-value")).toBe("some-token-value");
  });

  it("returns the token for an uppercase 'BEARER' scheme", () => {
    expect(extractBearerToken("BEARER some-token-value")).toBe("some-token-value");
  });

  it("returns the token for a mixed-case 'bEaReR' scheme", () => {
    expect(extractBearerToken("bEaReR some-token-value")).toBe("some-token-value");
  });

  it("returns null for a header with no space", () => {
    expect(extractBearerToken("Bearersome-token-value")).toBe(null);
  });

  it("returns null for the wrong scheme", () => {
    expect(extractBearerToken("Basic some-token-value")).toBe(null);
  });

  it("returns null when the header is not a string", () => {
    expect(extractBearerToken(undefined)).toBe(null);
    expect(extractBearerToken(null)).toBe(null);
    expect(extractBearerToken(12345)).toBe(null);
  });

  it("returns null for an empty string", () => {
    expect(extractBearerToken("")).toBe(null);
  });

  it("returns null for a trailing space with no token", () => {
    expect(extractBearerToken("Bearer ")).toBe(null);
  });
});
