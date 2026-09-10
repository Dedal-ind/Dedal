#!/usr/bin/env node
/*
 * Pre-release guard: FAILS if any PURGE_TEST_TOOL marker is still in the tree.
 *
 * The fest purge tool is deliberately marked at every attachment point so it can
 * be removed in one commit at handover. This script is what makes that promise
 * enforceable rather than aspirational — a production build that still carries the
 * tool exits non-zero here and never ships.
 *
 * Run it as a pre-release step, or wire it into CI on the release branch:
 *   npm run assert:no-test-tools
 *
 * It scans the SOURCE of both projects (not node_modules, not build output), and
 * prints every hit with its file so the removal list is the script's output.
 */
const fs = require("node:fs");
const path = require("node:path");

const MARKER = "PURGE_TEST_TOOL";
const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const SCAN_ROOTS = [
  path.join(REPOSITORY_ROOT, "Management-backend", "src"),
  path.join(REPOSITORY_ROOT, "Management-backend", "tests"),
  path.join(REPOSITORY_ROOT, "Manangement-frontend", "src"),
];
const SCANNED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
// This file names the marker by definition; it is not an attachment point.
const SELF_PATH = path.resolve(__filename);

function collectFiles(directoryPath, collected = []) {
  if (!fs.existsSync(directoryPath)) {
    return collected;
  }
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      collectFiles(entryPath, collected);
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      collected.push(entryPath);
    }
  }
  return collected;
}

function main() {
  const offendingFiles = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const filePath of collectFiles(scanRoot)) {
      if (path.resolve(filePath) === SELF_PATH) {
        continue;
      }
      const contents = fs.readFileSync(filePath, "utf8");
      if (contents.includes(MARKER)) {
        const hitCount = contents.split(MARKER).length - 1;
        offendingFiles.push({
          filePath: path.relative(REPOSITORY_ROOT, filePath),
          hitCount,
        });
      }
    }
  }

  if (offendingFiles.length === 0) {
    console.log(`OK: no ${MARKER} markers found. Safe to release.`);
    return 0;
  }

  console.error(
    `FAILED: ${MARKER} markers are still present in ${offendingFiles.length} file(s).\n` +
      "The dev-only fest purge tool must be removed before a production release.\n" +
      "Remove each attachment point below, then re-run this check:\n"
  );
  for (const offender of offendingFiles) {
    console.error(`  ${offender.filePath} (${offender.hitCount} marker${offender.hitCount === 1 ? "" : "s"})`);
  }
  return 1;
}

process.exit(main());
