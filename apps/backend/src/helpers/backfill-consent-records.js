require("dotenv").config();
const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { UserModel } = require("../models/user-model");
const { ConsentRecordModel } = require("../models/consent-record-model");
const { ensureLegacyPolicyVersion } = require("../services/consent-service");
const {
  POLICY_DOCUMENT_KINDS,
  CONSENT_ACTIONS,
  CONSENT_SOURCES,
} = require("../constants/consent-constants");

/*
 * Operator-run, IDEMPOTENT backfill of consent records from the deprecated
 * per-user timestamps (termsOfServiceConsentedAt, privacyPolicyConsentedAt).
 *
 * Two things, in order:
 *
 *   1. A LEGACY VERSION per document kind in the registry, standing for the
 *      text people accepted before versioning existed. It is marked isLegacy
 *      and carries NO content hash or text, because we did not capture what
 *      they saw and making it up now would be manufacturing evidence. It is
 *      NEVER the effective version: it exists only so historical records have
 *      something to point at. The real text is published separately with
 *      npm run publish:policy-version, and boot refuses to start until it is.
 *
 *   2. A LEGACY CONSENT RECORD for every user carrying a timestamp, dated at
 *      that timestamp, with no IP or user agent (we never kept them), pointing
 *      at the legacy version. Users already holding a legacy-backfill record
 *      for a kind are skipped, which is what makes a re-run a no-op.
 *
 * The timestamps themselves are NOT touched: they stay on the user as a
 * read-only remnant for one release.
 *
 * Run with: npm run migrate:consent-records
 */

const KIND_TO_TIMESTAMP_FIELD = {
  [POLICY_DOCUMENT_KINDS.TERMS_OF_SERVICE]: "termsOfServiceConsentedAt",
  [POLICY_DOCUMENT_KINDS.PRIVACY_POLICY]: "privacyPolicyConsentedAt",
};

async function backfillConsentRecords() {
  // Reuse an already-open connection; only a bare script invocation opens one.
  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) {
    await mongoose.connect(applicationConfig.databaseUri);
  }
  try {
    const report = {
      legacyVersionsCreated: 0,
      usersSeen: 0,
      recordsCreated: 0,
      recordsSkipped: 0,
    };

    const users = await UserModel.find({
      $or: Object.values(KIND_TO_TIMESTAMP_FIELD).map((field) => ({ [field]: { $ne: null } })),
    })
      .select(Object.values(KIND_TO_TIMESTAMP_FIELD).join(" "))
      .lean();
    report.usersSeen = users.length;

    for (const [kind, field] of Object.entries(KIND_TO_TIMESTAMP_FIELD)) {
      const stamped = users.filter((user) => user[field]);
      const earliest = stamped.reduce(
        (soonest, user) => (soonest === null || user[field] < soonest ? user[field] : soonest),
        null
      );
      const { version, created } = await ensureLegacyPolicyVersion(kind, earliest);
      if (created) {
        report.legacyVersionsCreated += 1;
      }

      const alreadyBackfilled = new Set(
        (
          await ConsentRecordModel.find({
            documentKind: kind,
            source: CONSENT_SOURCES.LEGACY_BACKFILL,
            userId: { $in: stamped.map((user) => user._id) },
          })
            .select("userId")
            .lean()
        ).map((row) => String(row.userId))
      );

      const rows = stamped
        .filter((user) => !alreadyBackfilled.has(String(user._id)))
        .map((user) => ({
          userId: user._id,
          documentKind: kind,
          policyVersionId: version._id,
          contentHash: null,
          action: CONSENT_ACTIONS.ACCEPTED,
          source: CONSENT_SOURCES.LEGACY_BACKFILL,
          consentedAt: user[field],
          ipAddress: null,
          userAgent: null,
          isLegacy: true,
        }));
      if (rows.length > 0) {
        await ConsentRecordModel.insertMany(rows, { ordered: true });
      }
      report.recordsCreated += rows.length;
      report.recordsSkipped += stamped.length - rows.length;
    }

    console.log(
      `consentRecords: ${report.recordsCreated} created, ${report.recordsSkipped} already present, ` +
        `across ${report.usersSeen} stamped users; ${report.legacyVersionsCreated} legacy policy versions created.`
    );
    return report;
  } finally {
    if (ownsConnection) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  backfillConsentRecords()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { backfillConsentRecords };
