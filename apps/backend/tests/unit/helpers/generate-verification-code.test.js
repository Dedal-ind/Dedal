import { describe, it, expect } from "vitest";
import {
  generateVerificationCode,
  UNAMBIGUOUS_ALPHABET,
} from "../../../src/helpers/generate-verification-code.js";

const CONFUSABLE_CHARACTERS = ["0", "O", "1", "I", "L"];

describe("generateVerificationCode", () => {
  it("returns a 16-character code from the unambiguous alphabet", () => {
    const code = generateVerificationCode();

    expect(code).toHaveLength(16);
    for (const character of code) {
      expect(UNAMBIGUOUS_ALPHABET).toContain(character);
    }
  });

  it("never emits a confusable character", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateVerificationCode();
      for (const confusable of CONFUSABLE_CHARACTERS) {
        expect(code).not.toContain(confusable);
      }
    }
  });

  it("produces distinct codes across a thousand calls", () => {
    const codes = new Set();
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      codes.add(generateVerificationCode());
    }
    expect(codes.size).toBe(1000);
  });
});
