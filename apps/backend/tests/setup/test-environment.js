/*
 * Loaded by vitest.config.js before any test module is imported, because
 * src/config/application-config.js throws at import time on a missing variable.
 *
 * DATABASE_URI points at a port nothing listens on: the suite always connects to
 * the in-memory server explicitly, so if application code ever reaches for this
 * value the test fails loudly instead of quietly writing to the real database.
 *
 * APPLICATION_ENVIRONMENT is "test", not "development", so the master OTP code is
 * disabled and the error handler leaves stack traces out of the response body.
 * Tests that need the development branch re-import the module with the variable
 * stubbed.
 */
const TEST_ENVIRONMENT_VARIABLES = {
  APPLICATION_PORT: "5000",
  APPLICATION_ENVIRONMENT: "test",
  DATABASE_URI: "mongodb://127.0.0.1:1/never-used-by-tests",
  JWT_SECRET: "test-jwt-secret-not-a-real-secret",
  JWT_EXPIRY_DAYS: "30",
  /*
   * One trusted hop, so a test can present its own X-Forwarded-For and be seen as
   * a distinct client. The per-IP OTP limiter this was first needed for is gone;
   * request.ip is still asserted on, so the hop count stays.
   */
  TRUST_PROXY_HOPS: "1",
  /*
   * No RESEND_API_KEY: the suite must never reach a real provider. Combined
   * with APPLICATION_ENVIRONMENT=test this selects the NONE driver, so any send
   * that escapes the email-service mock fails closed instead of sending.
   */
  EMAIL_FROM_ADDRESS: "no-reply@test.invalid",
  FRONTEND_BASE_URL: "http://localhost:5173",
  // Required by application-config at import time; without it every suite that
  // touches the config throws before its first test runs.
  SEED_ADMIN_EMAIL: "seed-admin@test.invalid",
  /*
   * Razorpay keys are optional in config, but set here so payment code treats the
   * gateway as configured. The SDK client is stubbed in tests (no network); the
   * signature secret is a known value tests compute HMACs against.
   */
  RAZORPAY_KEY_ID: "rzp_test_key",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_WEBHOOK_SECRET: "rzp_test_webhook_secret",
  PLATFORM_FEE_PAISE: "2000",
};

for (const [variableName, value] of Object.entries(TEST_ENVIRONMENT_VARIABLES)) {
  process.env[variableName] = value;
}
