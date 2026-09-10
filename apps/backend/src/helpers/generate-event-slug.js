/*
 * Pure. No database, no uniqueness concern — the caller owns collision retry,
 * and uniqueness is scoped to the parent fest rather than the collection.
 *
 * NFD splits an accented character into its base letter plus a combining mark,
 * so stripping the marks leaves ASCII behind: "Rāgā" becomes "raga" rather than
 * being discarded wholesale by the a-z0-9 filter.
 *
 * "Robowars 2027!" -> "robowars-2027"
 * "Rāgā Sangam"    -> "raga-sangam"
 * "  Code Off  "   -> "code-off"
 * "---test---"     -> "test"
 * ""               -> ""
 */
function generateEventSlug(eventName) {
  if (typeof eventName !== "string") {
    return "";
  }

  return eventName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = { generateEventSlug };
