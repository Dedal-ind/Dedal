/*
 * One-shot migration: add the Karnataka universities and colleges to the
 * colleges collection. `npm run migrate:karnataka-colleges`.
 *
 * Insert-only and idempotent: an entry already present — matched by its full
 * or short name against any existing college's full or short name, ignoring
 * case, spacing, punctuation, "&" vs "and" and a leading "The" — is skipped,
 * so re-running changes nothing and only reports counts. Existing colleges
 * are never touched.
 *
 * Flags:
 *   --dry-run            report new vs existing without writing
 *   --database=<name>    the database to use (the connection string may not
 *                        name one, in which case the driver falls back to "test")
 */
require("dotenv").config();

const mongoose = require("mongoose");

const { CollegeModel } = require("../models/college-model");
const { karnatakaCollegeSeedData } = require("./college-seed-data/karnataka-colleges");

const STATE = "Karnataka";

const SEED_LIST = karnatakaCollegeSeedData;

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

function collegeTypeOf(name) {
  if (/\blaw\b/i.test(name)) return "law";
  if (/pharmacy|medical|health/i.test(name)) return "medical";
  if (/engineering|technology/i.test(name)) return "engineering";
  if (/management|business|b school|weschool|xime|ifim/i.test(name)) return "business";
  if (/commerce/i.test(name)) return "commerce";
  if (/arts|science|first grade|degree/i.test(name)) return "arts";
  return "other";
}

function readFlag(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function migrateKarnatakaColleges({ isDryRun = false } = {}) {
  const existingColleges = await CollegeModel.find({}).select("collegeName commonName").lean();
  const existingNames = new Set();
  for (const college of existingColleges) {
    existingNames.add(normalizeName(college.collegeName));
    existingNames.add(normalizeName(college.commonName));
  }

  const added = [];
  const alreadyExisted = [];

  for (const university of SEED_LIST) {
    const exists =
      existingNames.has(normalizeName(university.collegeName)) ||
      existingNames.has(normalizeName(university.commonName));
    if (exists) {
      alreadyExisted.push(university.collegeName);
      continue;
    }
    if (!isDryRun) {
      await CollegeModel.create({
        collegeName: university.collegeName,
        commonName: university.commonName,
        city: university.city,
        state: STATE,
        collegeType: collegeTypeOf(university.collegeName),
        status: "active",
        // Verified so the participant college picker offers it immediately.
        isVerified: true,
      });
    }
    // Guards against a duplicate inside the list itself on the same run.
    existingNames.add(normalizeName(university.collegeName));
    existingNames.add(normalizeName(university.commonName));
    added.push(university.collegeName);
  }

  return { total: SEED_LIST.length, added, alreadyExisted };
}

async function run() {
  const isDryRun = process.argv.includes("--dry-run");
  const databaseName = readFlag("database");
  await mongoose.connect(process.env.DATABASE_URI, databaseName ? { dbName: databaseName } : {});
  try {
    const result = await migrateKarnatakaColleges({ isDryRun });
    console.log(
      `Karnataka universities and colleges (${mongoose.connection.db.databaseName}${isDryRun ? ", dry run" : ""}): ` +
        `${result.total} listed, ${result.added.length} ${isDryRun ? "would be added" : "added"}, ` +
        `${result.alreadyExisted.length} already existed.`
    );
    if (result.alreadyExisted.length > 0) {
      console.log(`Already existed: ${result.alreadyExisted.join("; ")}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Karnataka college migration failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { migrateKarnatakaColleges };
