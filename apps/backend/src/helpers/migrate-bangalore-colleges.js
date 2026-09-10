/*
 * One-off migration: seed curated Bangalore colleges into the colleges
 * collection so profile completion offers a real dropdown instead of
 * free text. `npm run migrate:colleges`.
 *
 * Insert-only and idempotent: a college already present (matched by aisheCode
 * when both sides have one, or by exact collegeName/commonName) is skipped, so
 * re-running never duplicates and never touches existing documents — user data
 * and self-registered colleges are left exactly as they are.
 *
 * Seeded colleges are inserted with isVerified: true so they appear in the
 * participant dropdown immediately. See docs/college-seed-migration.md.
 */
require("dotenv").config();

const mongoose = require("mongoose");

const { connectToDatabase } = require("../database/database-connection");
const { CollegeModel } = require("../models/college-model");
const { bangaloreCollegeSeedData } = require("./college-seed-data/bangalore-colleges");

// To seed another city later, add its data file here (see the docs).
const CITY_SEED_LISTS = [bangaloreCollegeSeedData];

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

async function migrateColleges() {
  await connectToDatabase();

  const existingColleges = await CollegeModel.find({})
    .select("collegeName commonName aisheCode")
    .lean();

  const existingNames = new Set();
  const existingAisheCodes = new Set();
  for (const college of existingColleges) {
    existingNames.add(normalizeName(college.collegeName));
    existingNames.add(normalizeName(college.commonName));
    if (college.aisheCode) {
      existingAisheCodes.add(college.aisheCode);
    }
  }

  let addedCount = 0;
  let skippedCount = 0;

  for (const seedCollege of CITY_SEED_LISTS.flat()) {
    const alreadyExists =
      (seedCollege.aisheCode && existingAisheCodes.has(seedCollege.aisheCode)) ||
      existingNames.has(normalizeName(seedCollege.collegeName)) ||
      existingNames.has(normalizeName(seedCollege.commonName));

    if (alreadyExists) {
      skippedCount += 1;
      continue;
    }

    await CollegeModel.create({
      collegeName: seedCollege.collegeName,
      commonName: seedCollege.commonName,
      city: seedCollege.city,
      state: seedCollege.state,
      // Undefined (not null) keeps the sparse unique aisheCode index happy.
      aisheCode: seedCollege.aisheCode || undefined,
      usnPrefix: seedCollege.usnPrefix,
      collegeType: seedCollege.collegeType,
      isVerified: true,
      // Directory entry, not a tenant: approval elevates it to "active".
      status: "reference",
    });

    existingNames.add(normalizeName(seedCollege.collegeName));
    existingNames.add(normalizeName(seedCollege.commonName));
    addedCount += 1;
  }

  const totalCount = await CollegeModel.countDocuments({});
  console.log(
    `Added ${addedCount} colleges. Skipped ${skippedCount} (already existed). Total ${totalCount}.`
  );

  // Drain the microtask queue so the line above flushes before process.exit.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function main() {
  let exitCode = 0;
  try {
    await migrateColleges();
  } catch (error) {
    console.error(`College seed migration failed: ${error.message}`);
    console.error(error.stack);
    exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
  process.exit(exitCode);
}

main();
