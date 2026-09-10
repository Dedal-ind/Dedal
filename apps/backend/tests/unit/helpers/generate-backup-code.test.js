import { describe, it, expect } from "vitest";
import { generateBackupCode } from "../../../src/helpers/generate-backup-code.js";

describe("generateBackupCode", () => {
  it("returns a 6-character numeric string", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = generateBackupCode();
      expect(code).toMatch(/^[0-9]{6}$/);
      expect(code).toHaveLength(6);
    }
  });

  it("never produces a leading zero, since the floor is 100000", () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const code = generateBackupCode();
      expect(code[0]).not.toBe("0");
      const asNumber = Number(code);
      expect(asNumber).toBeGreaterThanOrEqual(100000);
      expect(asNumber).toBeLessThanOrEqual(999999);
    }
  });

  it("is reasonably unique across 1000 calls", () => {
    const codes = new Set();
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      codes.add(generateBackupCode());
    }
    // Collisions are possible in a 900k space but should be rare; allow a small margin.
    expect(codes.size).toBeGreaterThan(985);
  });
});
