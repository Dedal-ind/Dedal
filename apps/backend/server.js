require("dotenv").config();

const { applicationConfig } = require("./src/config/application-config");
const { connectToDatabase } = require("./src/database/database-connection");
const { logDatabaseIndexes } = require("./src/helpers/database-index-helpers");
const { logActiveUploadDriver } = require("./src/services/upload-storage-service");
const { logActiveEmailDriver } = require("./src/services/email-service");
const { application } = require("./src/application");
const {
  startShiftReminderSweep,
  REMINDER_SWEEP_INTERVAL_MILLISECONDS,
} = require("./src/services/shift-reminder-service");
const { AUTHENTICATION_CONSTANTS } = require("./src/constants/authentication-constants");
const { ensurePolicyRegistryAtBoot } = require("./src/helpers/policy-registry-boot");
const {
  assertStagingPaymentSafety,
  assertStagingStorageBucketSafety,
} = require("./src/helpers/staging-boot-checks");
const {
  startDeliveryRollupSweep,
  ROLLUP_SWEEP_INTERVAL_MILLISECONDS,
} = require("./src/services/delivery-rollup-service");

/*
 * The master OTP code is a full authentication bypass for any address that has
 * requested a code. It exists only in development, and this line is the reason
 * you cannot boot a development build without noticing it.
 */
function logDevelopmentAuthenticationWarnings() {
  if (!applicationConfig.isDevelopment) {
    return;
  }
  console.log(
    `Development master OTP code enabled: ${AUTHENTICATION_CONSTANTS.DEVELOPMENT_MASTER_OTP_CODE}`
  );
}

/*
 * Delivery failures are swallowed by design — sendMailQuietly never throws, so
 * the OTP endpoint still answers 200 and never leaks whether an address exists.
 * The cost is that a placeholder sender is invisible until nobody can sign in.
 * This is the one place that can say so out loud, at boot, before it matters.
 *
 * The missing-transport case is reported by logActiveEmailDriver; this covers
 * the other half, a sender address left as scaffolding. A warning rather than a
 * fatal error: a running server that cannot mail is still worth more than one
 * that refuses to start, and Google Sign-In does not depend on email.
 */
function logEmailConfigurationWarnings() {
  const placeholderPattern = /(^|<)\s*(your[_.-]?|placeholder|example|changeme|replace_me)/i;
  const fromAddress = applicationConfig.emailFromAddress;

  if (fromAddress && placeholderPattern.test(fromAddress)) {
    console.warn(
      `WARNING: EMAIL_FROM_ADDRESS still holds a placeholder ("${fromAddress}"). ` +
        `Delivery will be rejected by the provider until it is a real, verified sender.`
    );
  }
}

/*
 * Process-level crash handlers.
 *
 * THE PROCESS MUST EXIT. Node's own documentation is explicit: after an
 * uncaught exception the process is in an undefined state — a half-finished
 * write, a lock never released, a connection pool with a torn entry. Swallowing
 * one and continuing is how a fest gate ends up serving quietly wrong answers
 * for an hour. pm2 restarts a dead process in under a second; nothing restarts
 * a corrupted one.
 *
 * A LOG FILE, NOT THE AUDIT LOG. The audit log is a Mongo write, and the most
 * likely cause of a crash this severe is that Mongo is the thing that broke —
 * so the record of it must not depend on Mongo being healthy. Appending
 * synchronously to a file is the only sink guaranteed to survive the state that
 * produced the crash, and appendFileSync is deliberate: the process is about to
 * exit and an async write would never flush.
 */
const fileSystem = require("node:fs");
const path = require("node:path");

const CRASH_LOG_FILE_PATH = path.join(__dirname, "logs", "crash.log");
const CRASH_EXIT_DELAY_MILLISECONDS = 100;

function recordFatalError(kind, error) {
  const entry = [
    `[${new Date().toISOString()}] ${kind}`,
    `  message: ${error?.message ?? String(error)}`,
    `  stack: ${(error?.stack ?? "no stack").split("\n").join("\n  ")}`,
    "",
  ].join("\n");

  // Always to stderr — pm2 captures it even if the file write fails.
  console.error(entry);
  try {
    fileSystem.mkdirSync(path.dirname(CRASH_LOG_FILE_PATH), { recursive: true });
    fileSystem.appendFileSync(CRASH_LOG_FILE_PATH, entry);
  } catch (writeError) {
    console.error(`Could not write the crash log: ${writeError.message}`);
  }
}

process.on("uncaughtException", (error) => {
  recordFatalError("uncaughtException", error);
  /*
   * A short delay so stderr flushes before exit — process.exit() truncates
   * pending writes on a pipe, which is exactly how pm2 receives them.
   */
  setTimeout(() => process.exit(1), CRASH_EXIT_DELAY_MILLISECONDS).unref();
});

/*
 * An unhandled rejection is treated the same way. Node's default since v15 is
 * already to terminate; this replaces that with the same handler so the reason
 * is recorded rather than printed and lost.
 */
process.on("unhandledRejection", (reason) => {
  recordFatalError("unhandledRejection", reason instanceof Error ? reason : new Error(String(reason)));
  setTimeout(() => process.exit(1), CRASH_EXIT_DELAY_MILLISECONDS).unref();
});

async function startServer() {
  await connectToDatabase();
  /*
   * Refuses to start unless every legal document has one effective, hashed
   * version. Before anything listens: a server that accepts consents it
   * cannot prove is worse than one that is down.
   */
  await ensurePolicyRegistryAtBoot();
  assertStagingPaymentSafety({
    isStaging: applicationConfig.isStaging,
    razorpayKeyId: applicationConfig.razorpayKeyId,
  });
  assertStagingStorageBucketSafety({
    isStaging: applicationConfig.isStaging,
    s3BucketName: process.env.S3_BUCKET_NAME,
    productionS3BucketName: process.env.PRODUCTION_S3_BUCKET_NAME,
  });
  await logDatabaseIndexes();
  console.log(`trust proxy hops: ${applicationConfig.trustProxyHops}`);
  logActiveUploadDriver();
  logActiveEmailDriver();
  logDevelopmentAuthenticationWarnings();
  logEmailConfigurationWarnings();
  /*
   * The volunteer shift reminder sweep. Started HERE rather than in
   * application.js on purpose: application.js is imported directly by every
   * integration suite, so starting the interval there would have ~30 test files
   * each polling their own in-memory database in the background, firing real
   * sweeps in the middle of unrelated assertions. server.js runs once, in the
   * real process, and only after connectToDatabase has resolved — which the
   * sweep requires and application.js cannot promise.
   */
  startShiftReminderSweep();
  console.log(
    `Shift reminder sweep every ${REMINDER_SWEEP_INTERVAL_MILLISECONDS / 60000} minutes`
  );
  /*
   * The delivery rollup, same pattern and same reasoning as the shift sweep:
   * once, in the real process, after the database is up. Raw delivery events
   * become daily counts here, and the campaigns' pacing counters are set
   * from those counts — never on the request path.
   */
  startDeliveryRollupSweep();
  console.log(`Delivery rollup sweep every ${ROLLUP_SWEEP_INTERVAL_MILLISECONDS / 60000} minutes`);
  application.listen(applicationConfig.applicationPort, () => {
    console.log(`Server listening on port ${applicationConfig.applicationPort}`);
  });
}

startServer().catch((error) => {
  console.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});
