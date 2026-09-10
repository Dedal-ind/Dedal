/*
 * One-off backfill: stamp a `status` onto every college that predates the
 * reference/active separation. `npm run migrate:college-status`.
 *
 * A college with an ACTIVE administrator staff assignment is a real tenant —
 * "active". Everything else without a status is directory data — "reference".
 * Colleges that already carry a status are skipped, so re-running is a no-op.
 */
require("dotenv").config();

const mongoose = require("mongoose");

const { connectToDatabase } = require("../database/database-connection");
const { CollegeModel } = require("../models/college-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

async function backfillCollegeStatus() {
  await connectToDatabase();

  const unstampedColleges = await CollegeModel.find({
    $or: [{ status: { $exists: false } }, { status: null }],
  })
    .select("_id collegeName")
    .lean();

  const stampedCount = await CollegeModel.countDocuments({
    status: { $exists: true, $ne: null },
  });

  let referenceCount = 0;
  let activeCount = 0;

  for (const college of unstampedColleges) {
    const administratorAssignment = await StaffAssignmentModel.findOne({
      collegeId: college._id,
      role: STAFF_ROLES.ADMINISTRATOR,
      status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    })
      .select("_id")
      .lean();

    const collegeStatus = administratorAssignment ? "active" : "reference";
    // updateOne, not save(): the schema default would stamp "active" on load.
    await CollegeModel.updateOne({ _id: college._id }, { $set: { status: collegeStatus } });

    if (collegeStatus === "active") {
      activeCount += 1;
    } else {
      referenceCount += 1;
    }
  }

  console.log(
    `Marked ${referenceCount} colleges reference, ${activeCount} active. ` +
      `Skipped ${stampedCount} (already stamped).`
  );

  // Drain the microtask queue so the line above flushes before process.exit.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function main() {
  let exitCode = 0;
  try {
    await backfillCollegeStatus();
  } catch (error) {
    console.error(`College status backfill failed: ${error.message}`);
    console.error(error.stack);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

main();
