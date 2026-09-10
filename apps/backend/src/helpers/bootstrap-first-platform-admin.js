/*
 * One-off, production-safe bootstrap: creates (or finds) the very first
 * platform-admin account, so the college-application review queue has someone
 * to answer it. `npm run bootstrap:first-platform-admin`.
 *
 * IDEMPOTENT BY CONSTRUCTION: the user is matched by email and the assignment
 * by (userId, platformAdmin, active); re-running reports both as already
 * existing and changes nothing.
 *
 * CONFIGURATION
 *   PLATFORM_ADMIN_EMAIL  (required) the account to promote.
 *   PLATFORM_ADMIN_NAME   (optional) full name for a newly created account.
 *                         Defaults to "Platform Admin".
 */
require("dotenv").config();

const mongoose = require("mongoose");

const { connectToDatabase } = require("../database/database-connection");
const { UserModel } = require("../models/user-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

function resolvePlatformAdminEmail() {
  const rawEmail = process.env.PLATFORM_ADMIN_EMAIL;
  if (!rawEmail || !rawEmail.trim()) {
    throw new Error(
      "PLATFORM_ADMIN_EMAIL is required. Set it to the email address that should " +
        "become the first platform admin, e.g. PLATFORM_ADMIN_EMAIL=owner@example.com " +
        "npm run bootstrap:first-platform-admin"
    );
  }
  return rawEmail.trim().toLowerCase();
}

async function resolvePlatformAdminUser(emailAddress) {
  const existingUser = await UserModel.findOne({ emailAddress });
  if (existingUser) {
    return { user: existingUser, created: false };
  }

  const user = await UserModel.create({
    emailAddress,
    fullName: (process.env.PLATFORM_ADMIN_NAME || "Platform Admin").trim(),
    // Set directly rather than recomputed: an admin has no USN, and
    // recomputing would trap them on the profile-completion screen.
    isProfileComplete: true,
    /*
     * participantId is deliberately OMITTED, not set to null. It carries a
     * unique SPARSE index, which skips only ABSENT fields — an explicit null
     * would collide with the next admin created this way.
     */
  });
  return { user, created: true };
}

async function ensurePlatformAdminAssignment(user) {
  const existingAssignment = await StaffAssignmentModel.findOne({
    userId: user._id,
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  });
  if (existingAssignment) {
    return false;
  }

  await StaffAssignmentModel.create({
    userId: user._id,
    collegeId: null,
    festId: null,
    role: STAFF_ROLES.PLATFORM_ADMIN,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    // The first admin has nobody above them to grant it, so they grant themselves.
    assignedByUserId: user._id,
  });
  return true;
}

async function bootstrapFirstPlatformAdmin() {
  const emailAddress = resolvePlatformAdminEmail();

  await connectToDatabase();

  const { user, created: userCreated } = await resolvePlatformAdminUser(emailAddress);
  console.log(`User: ${emailAddress} (${userCreated ? "created" : "already existed"}).`);

  const assignmentCreated = await ensurePlatformAdminAssignment(user);
  console.log(`Platform-admin assignment: ${assignmentCreated ? "created" : "already existed"}.`);

  console.log("Bootstrap complete.");

  // Drain the microtask queue so the lines above flush before process.exit.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function main() {
  let exitCode = 0;
  try {
    await bootstrapFirstPlatformAdmin();
  } catch (error) {
    console.error(`First platform-admin bootstrap failed: ${error.message}`);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

main();
