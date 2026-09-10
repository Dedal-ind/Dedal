import { describe, it, expect } from "vitest";
import { generateQrToken } from "../../../src/helpers/generate-qr-token.js";

const URL_SAFE_BASE64 = /^[A-Za-z0-9_-]+$/;

describe("generateQrToken", () => {
  it("returns a 32-character token", () => {
    expect(generateQrToken()).toHaveLength(32);
  });

  it("uses only URL-safe base64 characters", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateQrToken()).toMatch(URL_SAFE_BASE64);
    }
  });

  it("is unique across a thousand calls", () => {
    const tokens = new Set();
    for (let index = 0; index < 1000; index += 1) {
      tokens.add(generateQrToken());
    }
    expect(tokens.size).toBe(1000);
  });

  it("draws from a wide spread of characters", () => {
    const seen = new Set();
    for (let index = 0; index < 200; index += 1) {
      for (const character of generateQrToken()) {
        seen.add(character);
      }
    }
    // A healthy random source touches most of the 64-symbol alphabet quickly.
    expect(seen.size).toBeGreaterThan(40);
  });
});
