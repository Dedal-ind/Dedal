import { describe, it, expect, vi, afterEach } from "vitest";
import { CertificateModel } from "../../../src/models/certificate-model.js";
import {
  isVerificationCodeDuplicate,
  isCertificateAlreadyExists,
  insertCertificate,
  VERIFICATION_CODE_MAXIMUM_ATTEMPTS,
} from "../../../src/helpers/certificate-insert-helpers.js";

function duplicateError(keyPattern) {
  return { code: 11000, keyPattern };
}

const CANDIDATE = { userId: "user-1", festId: "fest-1", eventId: "event-1" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isVerificationCodeDuplicate", () => {
  it("is true only for a verificationCode duplicate-key error", () => {
    expect(isVerificationCodeDuplicate(duplicateError({ verificationCode: 1 }))).toBe(true);
    expect(isVerificationCodeDuplicate(duplicateError({ userId: 1, festId: 1 }))).toBe(false);
    expect(isVerificationCodeDuplicate({ code: 121, keyPattern: { verificationCode: 1 } })).toBe(false);
    expect(isVerificationCodeDuplicate(new Error("boom"))).toBe(false);
    expect(isVerificationCodeDuplicate(null)).toBe(false);
  });
});

describe("isCertificateAlreadyExists", () => {
  it("is true only for the composite (userId+festId+eventId+type) duplicate", () => {
    expect(
      isCertificateAlreadyExists(duplicateError({ userId: 1, festId: 1, eventId: 1, certificateType: 1 }))
    ).toBe(true);
    expect(isCertificateAlreadyExists(duplicateError({ verificationCode: 1 }))).toBe(false);
    expect(isCertificateAlreadyExists({ code: 1, keyPattern: { userId: 1 } })).toBe(false);
    expect(isCertificateAlreadyExists(null)).toBe(false);
  });
});

describe("insertCertificate", () => {
  it("returns the created certificate on the first try", async () => {
    const created = { id: "cert-1" };
    const spy = vi.spyOn(CertificateModel, "create").mockResolvedValue(created);

    const result = await insertCertificate(CANDIDATE);

    expect(result).toBe(created);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries on a verification-code collision, then succeeds", async () => {
    const created = { id: "cert-2" };
    const spy = vi
      .spyOn(CertificateModel, "create")
      .mockRejectedValueOnce(duplicateError({ verificationCode: 1 }))
      .mockResolvedValueOnce(created);

    const result = await insertCertificate(CANDIDATE);

    expect(result).toBe(created);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns null when the certificate already exists (idempotency signal)", async () => {
    vi.spyOn(CertificateModel, "create").mockRejectedValue(
      duplicateError({ userId: 1, festId: 1, eventId: 1, certificateType: 1 })
    );

    const result = await insertCertificate(CANDIDATE);

    expect(result).toBeNull();
  });

  it("throws CERTIFICATE_CODE_COLLISION after the maximum attempts are exhausted", async () => {
    const spy = vi
      .spyOn(CertificateModel, "create")
      .mockRejectedValue(duplicateError({ verificationCode: 1 }));

    const error = await insertCertificate(CANDIDATE).catch((caught) => caught);

    expect(error.statusCode).toBe(500);
    expect(error.errorCode).toBe("CERTIFICATE_CODE_COLLISION");
    expect(spy).toHaveBeenCalledTimes(VERIFICATION_CODE_MAXIMUM_ATTEMPTS);
  });

  it("rethrows an error that is neither a code collision nor an existing certificate", async () => {
    vi.spyOn(CertificateModel, "create").mockRejectedValue(new Error("network down"));

    await expect(insertCertificate(CANDIDATE)).rejects.toThrow(/network down/);
  });
});
