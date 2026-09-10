require("dotenv").config();
const mongoose = require("mongoose");

const { applicationConfig } = require("../src/config/application-config");
const {
  seedPolicyRegistryFromBundledText,
  assertPolicyRegistryReady,
} = require("../src/services/consent-service");

/*
 * Deploy-time migration: runs after install and before PM2 restart.
 *
 * Safe to run every deploy — every step is idempotent:
 *   - seedPolicyRegistryFromBundledText skips kinds that already have a
 *     non-legacy effective version.
 *   - assertPolicyRegistryReady throws if any kind is still missing,
 *     stopping the deploy before PM2 restarts into a refusal loop.
 *
 * Exit 0 = safe to restart. Exit 1 = do NOT restart.
 */
async function main() {
  await mongoose.connect(applicationConfig.databaseUri);
  try {
    console.log("==> Seeding policy registry (idempotent)...");
    const seeded = await seedPolicyRegistryFromBundledText();
    for (const version of seeded) {
      console.log(
        `    Published bundled ${version.kind} policy as ${version.versionLabel}.`
      );
    }
    if (seeded.length === 0) {
      console.log("    All policy kinds already have an effective version.");
    }

    console.log("==> Asserting policy registry readiness...");
    await assertPolicyRegistryReady();
    console.log("    Policy registry OK.");
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Deploy migration FAILED: ${error.message}`);
    console.error("DO NOT restart PM2 — the backend will refuse to boot.");
    process.exit(1);
  });
