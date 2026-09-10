const { applicationConfig } = require("../config/application-config");
const consentService = require("../services/consent-service");

/*
 * The policy registry at boot.
 *
 * PRODUCTION REFUSES TO START without exactly one effective, hashed version of
 * every legal document. A forgotten publish must stop a deploy, not quietly
 * degrade every consent written after it: a consent recorded against nothing
 * — or against a hash-less placeholder — cannot later prove what anyone saw.
 *
 * DEVELOPMENT SEEDS ITSELF from the bundled text under backend/policies, so
 * local work never trips over an empty registry; it still runs the same check
 * afterwards, so the bundled files must be present and non-empty.
 *
 * The test bootstrap (tests/setup/test-database.js) seeds the same way; this
 * module is for the real process only.
 */
async function ensurePolicyRegistryAtBoot() {
  if (applicationConfig.isDevelopment) {
    const seeded = await consentService.seedPolicyRegistryFromBundledText();
    for (const version of seeded) {
      console.log(
        `Development: published bundled ${version.kind} policy text as ${version.versionLabel}.`
      );
    }
  }
  await consentService.assertPolicyRegistryReady();
  console.log("Policy registry: every document kind has one effective version.");
}

module.exports = { ensurePolicyRegistryAtBoot };
