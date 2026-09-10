function assertStagingPaymentSafety({ isStaging, razorpayKeyId }) {
  if (!isStaging) {
    return;
  }
  if (razorpayKeyId && !razorpayKeyId.startsWith("rzp_test_")) {
    throw new Error(
      "FATAL: staging environment has a live Razorpay key (RAZORPAY_KEY_ID does not " +
        "start with rzp_test_). Refusing to boot — real money would be charged."
    );
  }
}

function assertStagingStorageBucketSafety({ isStaging, s3BucketName, productionS3BucketName }) {
  if (!isStaging) {
    return;
  }
  if (!s3BucketName) {
    return;
  }
  if (!productionS3BucketName) {
    throw new Error(
      "FATAL: staging has S3 configured but PRODUCTION_S3_BUCKET_NAME is not set — " +
        "cannot verify bucket isolation. Set it to the production bucket name so the " +
        "staging boot check can confirm they differ."
    );
  }
  if (s3BucketName === productionS3BucketName) {
    throw new Error(
      "FATAL: staging S3 bucket matches production bucket — uploads would write " +
        "into production storage. Set S3_BUCKET_NAME to a separate staging bucket."
    );
  }
}

module.exports = { assertStagingPaymentSafety, assertStagingStorageBucketSafety };
