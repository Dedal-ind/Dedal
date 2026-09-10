const { applicationConfig } = require("../config/application-config");
const { UserModel } = require("../models/user-model");
const { OtpCodeModel } = require("../models/otp-code-model");
const { CollegeModel } = require("../models/college-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { PassModel } = require("../models/pass-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ScanModel } = require("../models/scan-model");
const { SignInLogModel } = require("../models/sign-in-log-model");
const { AuditLogModel } = require("../models/audit-log-model");
const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { MatchModel } = require("../models/match-model");
const { RegistrationModel } = require("../models/registration-model");
const { TeamModel } = require("../models/team-model");
const { CertificateModel } = require("../models/certificate-model");
const { EntitlementModel } = require("../models/entitlement-model");

/*
 * syncIndexes drops indexes that Mongo holds but the schema no longer declares,
 * which is useful while the schema churns and unacceptable once real data
 * exists. Outside development we only ever build.
 */
async function logDatabaseIndexes() {
  const isDevelopment = applicationConfig.applicationEnvironment === "development";
  const models = [
    UserModel,
    OtpCodeModel,
    CollegeModel,
    StaffAssignmentModel,
    FestModel,
    EventModel,
    PassModel,
    CheckpointModel,
    ScanModel,
    SignInLogModel,
    AuditLogModel,
    VolunteerShiftModel,
    /*
     * The match slot index became partial in 12.10 so a superseded bracket can
     * keep its round and match numbers while a new one reuses them. A database
     * still holding the old unconditional unique index would refuse every force
     * regeneration with a duplicate key, so this model has to be synced rather
     * than left to whatever it was first built with.
     */
    MatchModel,

    /*
     * These four were absent until the audit found them. autoIndex still builds
     * a missing index lazily, so nothing was broken — but it never reconciles an
     * index whose definition has changed, and reconciliation is the whole reason
     * this file exists. A database still holding a superseded index keeps it
     * silently, which is exactly how MatchModel above ended up needing a live
     * migration.
     *
     * Two carry uniqueness that other code trusts to be there:
     * registrations' partial (eventId, userId) is what catches the concurrent
     * team-leader race, and certificates' (userId, festId, eventId) is the sole
     * thing making the insert-and-catch-duplicate in certificate-insert-helpers
     * race-correct. Neither guarantee should rest on a lazy build.
     */
    RegistrationModel,
    TeamModel,
    CertificateModel,
    EntitlementModel,
  ];

  console.log(`Index sync path: ${isDevelopment ? "syncIndexes" : "createIndexes"}`);

  for (const model of models) {
    if (isDevelopment) {
      await model.syncIndexes();
    } else {
      await model.createIndexes();
    }

    const indexes = await model.collection.indexes();
    const indexDescriptions = indexes
      .map((index) => `${index.name}${index.unique ? " (unique)" : ""}`)
      .join(", ");
    console.log(`Indexes on ${model.collection.collectionName}: ${indexDescriptions}`);
  }
}

module.exports = { logDatabaseIndexes };
