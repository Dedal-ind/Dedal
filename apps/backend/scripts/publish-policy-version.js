require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { applicationConfig } = require("../src/config/application-config");
const { publishPolicyVersion, bundledPolicyPath } = require("../src/services/consent-service");
const { POLICY_DOCUMENT_KINDS } = require("../src/constants/consent-constants");

/*
 * Operator-run: publish a new version of a legal document into the registry.
 *
 * The canonical text lives in THIS repository under backend/policies, and the
 * registry row stores the text AND its hash together, so what is served to a
 * participant and what a consent record hashes are the same bytes by
 * construction. --file defaults to the bundled file for the kind; pass another
 * only when publishing wording that has not yet been checked in (and then
 * check it in). Publishing changed wording is running this again with a new
 * label — never editing a row.
 *
 *   npm run publish:policy-version -- --kind termsOfService --label 2026-09 \
 *     --effective 2026-09-07
 */
function readArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key.startsWith("--")) {
      values[key.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return values;
}

async function main() {
  const { kind, label, effective, file } = readArguments(process.argv.slice(2));
  if (!Object.values(POLICY_DOCUMENT_KINDS).includes(kind)) {
    throw new Error(`--kind must be one of: ${Object.values(POLICY_DOCUMENT_KINDS).join(", ")}`);
  }
  if (!label) {
    throw new Error("--label is required.");
  }
  const text = fs.readFileSync(file ? path.resolve(file) : bundledPolicyPath(kind), "utf8");

  await mongoose.connect(applicationConfig.databaseUri);
  try {
    const version = await publishPolicyVersion({
      kind,
      versionLabel: label,
      effectiveAt: effective ?? new Date(),
      text,
    });
    console.log(
      `Published ${kind} ${version.versionLabel} effective ${version.effectiveAt.toISOString()} ` +
        `hash ${version.contentHash} (id ${version._id}).`
    );
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
