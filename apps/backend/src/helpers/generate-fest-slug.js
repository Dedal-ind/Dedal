/*
 * Pure. No database, no uniqueness concern — the caller owns collision retry.
 *
 * NFD splits an accented character into its base letter plus a combining mark,
 * so stripping the marks leaves ASCII behind: "Rāgā" becomes "raga" rather than
 * being discarded wholesale by the a-z0-9 filter.
 *
 * "Alliance ONE 2026" -> "alliance-one-2026"
 * "Rāgā Festival!!"   -> "raga-festival"
 * "----test----"      -> "test"
 * ""                  -> ""
 */
function generateFestSlug(festName) {
  if (typeof festName !== "string") {
    return "";
  }

  return festName
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = { generateFestSlug };
