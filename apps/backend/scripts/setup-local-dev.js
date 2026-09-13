// setup-local-dev.js
// Puts a named developer account into the LOCAL database as a platformAdmin and
// hands it the demo fests, so the admin console has something to show when you
// sign in as yourself instead of as a seeded fixture.
//
// LOCAL ONLY. It grants platform-wide admin — the role that passes every college
// and fest check — and reassigns fest ownership, so it refuses to run against
// anything but a localhost database. Pointing DATABASE_URI at a shared or
// production host and running this would silently hand one account the whole
// platform.
//
// IDEMPOTENT: rerunning finds the existing user and assignment rather than
// duplicating either, and reassigning an already-reassigned fest is a no-op.
//
// Run with: node scripts/setup-local-dev.js [--email=<address>] [--name=<name>] [--claim-demo-fests]
//
// With no --email it sets up the original developer account and claims the
// demo fests, exactly as before. With --email it grants platformAdmin to THAT
// account and leaves fest ownership alone unless --claim-demo-fests is passed:
// adding a second admin must not quietly take the demo fests off the first.

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const mongoose = require("mongoose");

const { UserModel } = require("../src/models/user-model");
const { FestModel } = require("../src/models/fest-model");
const { CollegeModel } = require("../src/models/college-model");
const { StaffAssignmentModel } = require("../src/models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../src/constants/staff-constants");

const DEFAULT_EMAIL = "dhanushshonnal3@gmail.com";

function readArgument(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const requestedEmail = readArgument("email");
const TARGET_EMAIL = (requestedEmail ?? DEFAULT_EMAIL).trim().toLowerCase();
const isDefaultAccount = TARGET_EMAIL === DEFAULT_EMAIL;
const TARGET_NAME = readArgument("name") ?? (isDefaultAccount ? "Dhanush" : TARGET_EMAIL.split("@")[0]);
/* Opt-in for a named account; implied for the default one, which is what this
   script always did. */
const SHOULD_CLAIM_DEMO_FESTS = process.argv.includes("--claim-demo-fests") || requestedEmail === null;

/*
 * Profile fields that may carry a unique index, derived from the email so a
 * second local account never collides with the first. The default account keeps
 * its original values so reruns stay idempotent against an existing database.
 */
const emailDigest = crypto.createHash("sha1").update(TARGET_EMAIL).digest("hex");
const TARGET_USN = isDefaultAccount ? "LOCALDEV001" : `LOCALDEV${emailDigest.slice(0, 6).toUpperCase()}`;
const TARGET_PHONE = isDefaultAccount
  ? "9000000000"
  : `9${String(parseInt(emailDigest.slice(0, 8), 16) % 1000000000).padStart(9, "0")}`;
const DEMO_FEST_SLUG = "alliance-one-demo";
const SECOND_FEST_NAME = "Alliance ONE 2026";

function assertLocalDatabase(uri) {
  const isLocal = /(?:\/\/|@)(127\.0\.0\.1|localhost)[:/]/.test(uri);
  if (!isLocal) {
    throw new Error(
      "Refusing to run: DATABASE_URI does not point at localhost.\n" +
        "  This script grants platformAdmin and reassigns fest ownership, which " +
        "must never happen on a shared or production database.\n" +
        "  URI host was: " + uri.replace(/\/\/[^@]*@/, "//<credentials>@"),
    );
  }
}

async function main() {
  const databaseUri = process.env.DATABASE_URI;
  if (!databaseUri) {
    throw new Error("DATABASE_URI is not set. Check backend/.env.");
  }
  assertLocalDatabase(databaseUri);

  await mongoose.connect(databaseUri);
  console.log(`Connected to: ${mongoose.connection.name}`);

  /*
   * 1. The user.
   *
   * isProfileComplete is NOT set as a bare flag. recomputeIsProfileComplete
   * derives it from fullName + collegeId + usn + phoneNumber, so a true flag
   * without those four fields is a lie the next profile save would silently
   * correct — landing you back on the profile-completion screen with no
   * explanation. The four fields are filled so the flag is earned.
   */
  let user = await UserModel.findOne({ emailAddress: TARGET_EMAIL });
  let userWasCreated = false;

  const college = await CollegeModel.findOne().sort({ createdAt: 1 });
  if (!college) {
    throw new Error("No college exists in this database; cannot complete a profile.");
  }

  if (!user) {
    user = new UserModel({
      emailAddress: TARGET_EMAIL,
      fullName: TARGET_NAME,
      collegeId: college._id,
      usn: TARGET_USN,
      phoneNumber: TARGET_PHONE,
      isBlocked: false,
      emailVerifiedAt: new Date(),
      signedUpAt: new Date(),
    });
    user.recomputeIsProfileComplete();
    await user.save();
    userWasCreated = true;
    console.log(`Created user ${TARGET_EMAIL} → ${user._id}`);
  } else {
    // Fill only what is missing; an existing real profile is left alone.
    user.fullName = user.fullName || TARGET_NAME;
    user.collegeId = user.collegeId || college._id;
    user.usn = user.usn || TARGET_USN;
    user.phoneNumber = user.phoneNumber || TARGET_PHONE;
    user.isBlocked = false;
    user.recomputeIsProfileComplete();
    await user.save();
    console.log(`Found existing user ${TARGET_EMAIL} → ${user._id}`);
  }
  console.log(`  isProfileComplete: ${user.isProfileComplete}`);

  /*
   * 2. The platformAdmin grant.
   *
   * A platformAdmin assignment must carry neither collegeId nor festId — the
   * model invalidates it otherwise — because the role's scope is the platform,
   * not a college within it.
   */
  let assignment = await StaffAssignmentModel.findOne({
    userId: user._id,
    role: STAFF_ROLES.PLATFORM_ADMIN,
  });

  if (!assignment) {
    /*
     * Every assignment records who granted it. There is no human granting this
     * one, so it is attributed to an existing platformAdmin when one exists and
     * self-attributed otherwise — a self-granted row is honest about a local
     * bootstrap, and inventing a third party in the audit trail would not be.
     */
    const existingPlatformAdmin = await StaffAssignmentModel.findOne({
      role: STAFF_ROLES.PLATFORM_ADMIN,
      status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    }).sort({ createdAt: 1 });

    assignment = await StaffAssignmentModel.create({
      userId: user._id,
      role: STAFF_ROLES.PLATFORM_ADMIN,
      status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
      collegeId: null,
      festId: null,
      assignedByUserId: existingPlatformAdmin ? existingPlatformAdmin.userId : user._id,
    });
    console.log(`Created platformAdmin assignment → ${assignment._id}`);
  } else if (assignment.status !== STAFF_ASSIGNMENT_STATUSES.ACTIVE) {
    // A revoked grant is reactivated rather than duplicated.
    assignment.status = STAFF_ASSIGNMENT_STATUSES.ACTIVE;
    await assignment.save();
    console.log(`Reactivated existing platformAdmin assignment → ${assignment._id}`);
  } else {
    console.log(`platformAdmin assignment already active → ${assignment._id}`);
  }

  if (SHOULD_CLAIM_DEMO_FESTS) {
    /*
     * 3. Fest ownership.
     *
     * Strictly speaking this is now redundant: fetchFestsForAdministrator returns
     * every fest to a platformAdmin regardless of who created it. It is done
     * anyway so the console still works if that role-scoping is ever reverted, and
     * so the fests read as this developer's own.
     */
    const festsToReassign = await FestModel.find({
      $or: [{ festSlug: DEMO_FEST_SLUG }, { festName: SECOND_FEST_NAME }],
    });

    for (const fest of festsToReassign) {
      if (String(fest.createdByUserId) === String(user._id)) {
        console.log(`  ${fest.festName}: already owned by this user`);
        continue;
      }
      fest.createdByUserId = user._id;
      await fest.save();
      console.log(`  ${fest.festName}: owner set to ${user._id}`);
    }

    /*
     * 4. The demo hierarchy, if it is not there yet.
     *
     * Delegated to the existing seeder rather than duplicated here — two copies of
     * the same 19-event structure would drift, and that script already owns the
     * model's validation rules. It resolves its own owner and is idempotent, so
     * the reassignment above is repeated afterwards to catch the fest it creates.
     */
    const demoFest = await FestModel.findOne({ festSlug: DEMO_FEST_SLUG });
    if (!demoFest) {
      console.log("\nDemo fest missing — running the structure seeder…");
      execFileSync("node", [path.join(__dirname, "seed-event-structure-demo.js")], {
        stdio: "inherit",
      });
      // The seeder picks its own owner, so the fest it just made is reassigned here.
      const seeded = await FestModel.findOne({ festSlug: DEMO_FEST_SLUG });
      if (seeded && String(seeded.createdByUserId) !== String(user._id)) {
        seeded.createdByUserId = user._id;
        await seeded.save();
        console.log(`  ${seeded.festName}: owner set to ${user._id}`);
      }
    }
  } else {
    console.log("Fest ownership left unchanged (pass --claim-demo-fests to claim the demo fests).");
  }

  const ownedCount = await FestModel.countDocuments({ createdByUserId: user._id });
  const totalCount = await FestModel.countDocuments();

  console.log("");
  console.log(`${TARGET_EMAIL} is now platformAdmin with ${ownedCount} fests`);
  console.log(`  (as a platformAdmin the console shows all ${totalCount} fests in the database)`);
  console.log(`  user _id: ${user._id}`);
  console.log(`  created new user: ${userWasCreated}`);
}

main()
  .catch((error) => {
    console.error("Setup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    console.log("Disconnected.");
  });
