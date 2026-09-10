require("dotenv").config();

const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { connectToDatabase } = require("../database/database-connection");
const { UserModel } = require("../models/user-model");
const { RegistrationModel } = require("../models/registration-model");
const { PassModel } = require("../models/pass-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { ScanModel } = require("../models/scan-model");
const { CertificateModel } = require("../models/certificate-model");
const { TeamModel } = require("../models/team-model");

/*
 * One-time manual cleanup. Admin was accidentally registered as a participant
 * during early testing, before the strict-admin rule (12.5.1a) was enforced. This
 * removes those stale participant rows so the admin's DB record reflects the rule:
 * staffAssignments only, nothing participant-side. It touches ONLY participant
 * data owned by the admin — never users, staffAssignments (the admin role stays),
 * colleges/fests/events/checkpoints, or auditLogs/signInLogs (history is permanent
 * per 12.2). Not wired into any other script: run it by hand when needed.
 */

// Counts the admin's participant footprint across the affected collections, for
// the before/after report. Team footprint is any team the admin leads or is in.
async function countAdminFootprint(adminId, passIds) {
  const [registrations, passes, entitlements, scans, certificates, teams] = await Promise.all([
    RegistrationModel.countDocuments({ userId: adminId }),
    PassModel.countDocuments({ userId: adminId }),
    EntitlementModel.countDocuments({ passId: { $in: passIds } }),
    ScanModel.countDocuments({ scannedByUserId: adminId }),
    CertificateModel.countDocuments({ userId: adminId }),
    TeamModel.countDocuments({
      $or: [{ leaderUserId: adminId }, { memberUserIds: adminId }],
    }),
  ]);
  return { registrations, passes, entitlements, scans, certificates, teams };
}

function printCounts(label, counts) {
  console.log(`--- ${label} (admin footprint) ---`);
  console.log(`Registrations: ${counts.registrations}`);
  console.log(`Passes:        ${counts.passes}`);
  console.log(`Entitlements:  ${counts.entitlements}`);
  console.log(`Scans:         ${counts.scans}`);
  console.log(`Certificates:  ${counts.certificates}`);
  console.log(`Team memberships: ${counts.teams}`);
}

/*
 * A team the admin led is orphaned once the admin leaves, so the whole team goes.
 * A team the admin merely joined survives — the admin is pulled from the roster.
 */
async function cleanTeams(adminId) {
  const ledTeams = await TeamModel.deleteMany({ leaderUserId: adminId });
  console.log(`Deleted ${ledTeams.deletedCount} team(s) led by admin`);

  const memberOnly = await TeamModel.updateMany(
    { leaderUserId: { $ne: adminId }, memberUserIds: adminId },
    { $pull: { memberUserIds: adminId } }
  );
  console.log(`Removed admin from ${memberOnly.modifiedCount} team roster(s)`);
}

async function cleanupAdminParticipantData() {
  if (!applicationConfig.isDevelopment) {
    throw new Error(
      "db:cleanup:admin refuses to run: APPLICATION_ENVIRONMENT must be 'development'."
    );
  }

  await connectToDatabase();

  const emailAddress = applicationConfig.seedAdminEmail;
  const admin = await UserModel.findOne({ emailAddress });
  if (!admin) {
    console.log("Admin not found — nothing to clean.");
    return;
  }
  const adminId = admin._id;
  console.log(`Cleaning participant data for admin ${emailAddress} (${admin.id})`);

  // Capture the admin's pass ids first: entitlements are keyed by passId, so they
  // must be deleted before (or alongside) the passes they hang off.
  const adminPasses = await PassModel.find({ userId: adminId }).select("_id").lean();
  const passIds = adminPasses.map((pass) => pass._id);

  const before = await countAdminFootprint(adminId, passIds);
  printCounts("Before", before);

  const entitlements = await EntitlementModel.deleteMany({ passId: { $in: passIds } });
  console.log(`Deleted ${entitlements.deletedCount} entitlements`);

  const passes = await PassModel.deleteMany({ userId: adminId });
  console.log(`Deleted ${passes.deletedCount} passes`);

  const registrations = await RegistrationModel.deleteMany({ userId: adminId });
  console.log(`Deleted ${registrations.deletedCount} registrations`);

  const scans = await ScanModel.deleteMany({ scannedByUserId: adminId });
  console.log(`Deleted ${scans.deletedCount} scans`);

  const certificates = await CertificateModel.deleteMany({ userId: adminId });
  console.log(`Deleted ${certificates.deletedCount} certificates`);

  await cleanTeams(adminId);

  const after = await countAdminFootprint(adminId, passIds);
  printCounts("After", after);
}

async function main() {
  let exitCode = 0;
  try {
    await cleanupAdminParticipantData();
  } catch (error) {
    console.error(`Cleanup failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  // Let stdout flush before process.exit, which does not wait for it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.exit(exitCode);
}

main();
