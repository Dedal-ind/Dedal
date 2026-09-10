const requiredEnvironmentVariables = [
  "APPLICATION_PORT",
  "APPLICATION_ENVIRONMENT",
  "DATABASE_URI",
  "JWT_SECRET",
  /*
   * The sender identity is required — every driver needs a From, and it must be
   * an address on the Resend-verified domain (the live .env's noreply address).
   * The transport credential (RESEND_API_KEY) is deliberately NOT required:
   * absent, development falls back to the console driver.
   */
  "EMAIL_FROM_ADDRESS",
  "FRONTEND_BASE_URL",
  "SEED_ADMIN_EMAIL",
];

const { EMAIL_ADDRESS_PATTERN } = require("@dedal/shared");

const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (variableName) => !process.env[variableName]
);

if (missingEnvironmentVariables.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvironmentVariables.join(", ")}`
  );
}

const DEFAULT_JWT_EXPIRY_DAYS = 30;
const DEVELOPMENT_TRUST_PROXY_HOPS = 0;
const PRODUCTION_TRUST_PROXY_HOPS = 1;

/*
 * A present-but-invalid value is a typo, not an instruction to fall back.
 * The default applies only when the variable is absent entirely.
 */
function parseRequiredPositiveInteger(variableName, defaultValue) {
  const rawValue = process.env[variableName];

  if (rawValue === undefined || rawValue === "") {
    if (defaultValue === undefined) {
      throw new Error(`Missing required environment variable: ${variableName}`);
    }
    return defaultValue;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(
      `Environment variable ${variableName} must be a positive integer, received "${rawValue}".`
    );
  }

  return parsedValue;
}

/*
 * Zero is a legal hop count, so this cannot reuse parseRequiredPositiveInteger.
 * An integer is the only accepted form: `trust proxy: true` would honour any
 * X-Forwarded-For a client sends, letting an attacker forge request.ip at will —
 * which would corrupt request logging and any future per-client-IP controls.
 */
function parseTrustProxyHops(applicationEnvironment) {
  const rawValue = process.env.TRUST_PROXY_HOPS;

  if (rawValue === undefined || rawValue === "") {
    return applicationEnvironment === "development"
      ? DEVELOPMENT_TRUST_PROXY_HOPS
      : PRODUCTION_TRUST_PROXY_HOPS;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(
      `Environment variable TRUST_PROXY_HOPS must be a non-negative integer, received "${rawValue}".`
    );
  }

  return parsedValue;
}

/*
 * Config, not user data: SEED_ADMIN_EMAIL is exactly one address, not a list. A
 * present-but-invalid value (e.g. a leftover comma-separated pair) is a typo and
 * fails fast rather than silently producing a malformed admin identity.
 */
function parseRequiredEmail(variableName) {
  const rawValue = process.env[variableName];
  if (rawValue === undefined || rawValue.trim() === "") {
    throw new Error(`Missing required environment variable: ${variableName}`);
  }
  const value = rawValue.trim().toLowerCase();
  if (!EMAIL_ADDRESS_PATTERN.test(value)) {
    throw new Error(
      `Environment variable ${variableName} must be a single valid email address, received "${rawValue}".`
    );
  }
  return value;
}

/*
 * An optional non-negative integer: absent falls back to the default (zero is a
 * legal value here, so this cannot reuse parseRequiredPositiveInteger). A present
 * but non-integer value is a typo and fails fast.
 */
function parseOptionalNonNegativeInteger(variableName, defaultValue) {
  const rawValue = process.env[variableName];
  if (rawValue === undefined || rawValue === "") {
    return defaultValue;
  }
  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(
      `Environment variable ${variableName} must be a non-negative integer, received "${rawValue}".`
    );
  }
  return parsedValue;
}

const applicationEnvironment = process.env.APPLICATION_ENVIRONMENT;

const applicationConfig = {
  applicationPort: parseRequiredPositiveInteger("APPLICATION_PORT"),
  applicationEnvironment,
  isDevelopment: applicationEnvironment === "development",
  isStaging: applicationEnvironment === "staging",
  isProduction: applicationEnvironment === "production",
  trustProxyHops: parseTrustProxyHops(applicationEnvironment),
  databaseUri: process.env.DATABASE_URI,

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiryDays: parseRequiredPositiveInteger("JWT_EXPIRY_DAYS", DEFAULT_JWT_EXPIRY_DAYS),

  /*
   * Google Sign-In. Optional: absent means the feature is simply off — the
   * endpoint refuses and the frontend hides its button — so an install without a
   * Google project still boots and signs in by OTP. It is the OAuth *Client ID*
   * only (public, safe to ship to the browser); ID-token verification needs no
   * client secret. The frontend fetches this same value from
   * GET /authentication/google/config, so the browser's audience can never
   * diverge from what we verify against.
   */
  googleClientId: process.env.GOOGLE_CLIENT_ID || null,

  /*
   * Resend's API credential. Optional on purpose: its presence is what selects
   * the real transport. Absent in development, mail is written to the console
   * instead; absent in production, there is no transport and every send fails
   * loudly at boot rather than silently at the first sign-in.
   */
  resendApiKey: process.env.RESEND_API_KEY || null,

  emailFromAddress: process.env.EMAIL_FROM_ADDRESS,
  /*
   * Optional display name. Resend wants one RFC 5322 From, so this is folded
   * into "Name <address>" at send time — but only when EMAIL_FROM_ADDRESS is a
   * bare address, since it may already carry a display name of its own.
   */
  emailFromName: process.env.EMAIL_FROM_NAME || null,

  stagingEmailAllowlist: (process.env.STAGING_EMAIL_ALLOWLIST || "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean),

  // Where an invited staff member is told to sign in.
  frontendBaseUrl: process.env.FRONTEND_BASE_URL,

  // The single administrator the dev seed provisions. One address, validated.
  seedAdminEmail: parseRequiredEmail("SEED_ADMIN_EMAIL"),

  // The platform owner (superadmin) the dev seed provisions. Defaulted so existing
  // .env files keep working; override with PLATFORM_ADMIN_EMAIL.
  platformAdminEmail: process.env.PLATFORM_ADMIN_EMAIL || "owner@gmail.com",

  /*
   * Image uploads. In development, files are written to a local folder and served
   * back over HTTP by this server; in production, the same upload service pushes to
   * S3 instead. The base URL is how a stored dev file becomes an absolute URL the
   * frontend (a different origin) can load — defaults to this server's own address.
   */
  uploadStorageDriver: process.env.UPLOAD_STORAGE_DRIVER || (applicationEnvironment === "production" ? "s3" : "local"),
  uploadLocalDir: process.env.UPLOAD_LOCAL_DIR || "uploads",
  backendBaseUrl:
    process.env.BACKEND_BASE_URL || `http://localhost:${process.env.APPLICATION_PORT || 4000}`,
  awsS3Bucket: process.env.AWS_S3_BUCKET,
  awsRegion: process.env.AWS_REGION,
  awsS3PublicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL,

  /*
   * Razorpay. Optional like googleClientId: absent means payment features are off
   * (the gateway service refuses with PAYMENT_NOT_CONFIGURED) so an install without
   * a Razorpay account still boots and free events keep working. The key id is
   * public (shipped to the browser to open Checkout); the secrets never leave here.
   */
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || null,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || null,

  /*
   * Platform fee added on top of the registration fee, flat per payment group.
   * Zero means no platform fee. GST on the platform fee is a hidden toggle for a
   * future activation; the rate lives in config rather than hardcoded.
   */
  platformFeePaise: parseOptionalNonNegativeInteger("PLATFORM_FEE_PAISE", 0),
  gstOnPlatformFeeEnabled: process.env.GST_ON_PLATFORM_FEE_ENABLED === "true",
  gstRatePercent: parseOptionalNonNegativeInteger("GST_RATE_PERCENT", 18),
};

module.exports = { applicationConfig };
