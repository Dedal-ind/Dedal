import { describe, it, expect } from "vitest";
import {
  createAuthenticationToken,
  verifyAuthenticationToken,
} from "../../../src/helpers/token-helpers.js";

/*
 * The payload must carry the standard iat claim (added by jsonwebtoken.sign) and
 * NOT a bespoke issuedAt duplicating it — one value under one name, so a
 * downstream reader cannot drift between the two.
 */
describe("createAuthenticationToken", () => {
  it("carries a standard iat claim and no bespoke issuedAt field", () => {
    const token = createAuthenticationToken({
      id: "507f1f77bcf86cd799439011",
      emailAddress: "person@example.com",
    });
    const payload = verifyAuthenticationToken(token);

    expect(payload.issuedAt).toBeUndefined();
    expect(Number.isInteger(payload.iat)).toBe(true);
    expect(payload.iat).toBeGreaterThan(0);

    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(Math.abs(nowSeconds - payload.iat)).toBeLessThanOrEqual(5);
  });
});
