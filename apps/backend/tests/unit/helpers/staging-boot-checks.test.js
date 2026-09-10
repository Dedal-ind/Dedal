import { describe, it, expect } from "vitest";

const {
  assertStagingPaymentSafety,
  assertStagingStorageBucketSafety,
} = await import("../../../src/helpers/staging-boot-checks.js");

describe("assertStagingPaymentSafety", () => {
  it("throws when staging has a live Razorpay key", () => {
    expect(() =>
      assertStagingPaymentSafety({ isStaging: true, razorpayKeyId: "rzp_live_abc123" })
    ).toThrow("live Razorpay key");
  });

  it("does not throw when staging has a test key", () => {
    expect(() =>
      assertStagingPaymentSafety({ isStaging: true, razorpayKeyId: "rzp_test_abc123" })
    ).not.toThrow();
  });

  it("does not throw when staging has no key", () => {
    expect(() =>
      assertStagingPaymentSafety({ isStaging: true, razorpayKeyId: null })
    ).not.toThrow();
  });

  it("skips the check outside staging", () => {
    expect(() =>
      assertStagingPaymentSafety({ isStaging: false, razorpayKeyId: "rzp_live_abc123" })
    ).not.toThrow();
  });
});

describe("assertStagingStorageBucketSafety", () => {
  it("throws when staging bucket matches production bucket", () => {
    expect(() =>
      assertStagingStorageBucketSafety({
        isStaging: true,
        s3BucketName: "dedal-uploads",
        productionS3BucketName: "dedal-uploads",
      })
    ).toThrow("matches production bucket");
  });

  it("throws when staging has S3 configured but PRODUCTION_S3_BUCKET_NAME is absent", () => {
    expect(() =>
      assertStagingStorageBucketSafety({
        isStaging: true,
        s3BucketName: "dedal-staging-uploads",
        productionS3BucketName: undefined,
      })
    ).toThrow("PRODUCTION_S3_BUCKET_NAME is not set");
  });

  it("does not throw when staging bucket differs from production bucket", () => {
    expect(() =>
      assertStagingStorageBucketSafety({
        isStaging: true,
        s3BucketName: "dedal-staging-uploads",
        productionS3BucketName: "dedal-uploads",
      })
    ).not.toThrow();
  });

  it("does not throw when S3 is not configured in staging", () => {
    expect(() =>
      assertStagingStorageBucketSafety({
        isStaging: true,
        s3BucketName: "",
        productionS3BucketName: undefined,
      })
    ).not.toThrow();
  });

  it("skips the check outside staging", () => {
    expect(() =>
      assertStagingStorageBucketSafety({
        isStaging: false,
        s3BucketName: "dedal-uploads",
        productionS3BucketName: "dedal-uploads",
      })
    ).not.toThrow();
  });
});
