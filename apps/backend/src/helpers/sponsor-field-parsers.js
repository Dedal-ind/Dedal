const {
  FEST_SPONSORS_MAX,
  EVENT_SPONSORS_MAX,
  SPONSOR_TIERS,
  SPONSOR_TIERS_IN_PRIORITY_ORDER,
  SPONSOR_NAME_MAX_LENGTH,
} = require("../constants/fest-constants");

/*
 * The ONE sponsors parser, shared by the fest write path and the event write
 * path — sponsors have the same shape wherever they hang, so they have one
 * validator. Only the size cap differs, which is why this is a factory.
 *
 * Contract matches every other parser in this codebase: { value } on success,
 * { reason } on failure; nothing throws, and the caller turns a reason into one
 * 400 with a field-level detail.
 *
 * WHERE THIS DELIBERATELY DISAGREES WITH THE SCHEMA
 * (helpers/sponsor-schema-helpers.js): here `sponsorName` and `tier` are BOTH
 * required, there they are nullable with a default. A write is new data and must
 * be complete; the schema has to keep accepting the sponsor subdocuments already
 * stored, which predate both rules. Were the schema strict instead, an unrelated
 * future PATCH of a legacy fest would fail validation on a field the
 * administrator never touched.
 *
 * The ORDER of the array is stored exactly as sent. The frontend sorts by tier
 * for display; the backend does not re-sort, so a round trip returns the same
 * rows in the same order.
 */
function buildSponsorsParser(maximumSponsors) {
  return (rawValue) => {
    if (!Array.isArray(rawValue)) {
      return { reason: "must be an array" };
    }
    if (rawValue.length > maximumSponsors) {
      return { reason: `must not exceed ${maximumSponsors} sponsors` };
    }
    const parsedSponsors = [];
    for (const candidate of rawValue) {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
        return { reason: "every entry must be an object" };
      }
      if (typeof candidate.imageUrl !== "string" || candidate.imageUrl.trim().length === 0) {
        return { reason: "every entry needs a non-empty imageUrl" };
      }
      if (typeof candidate.sponsorName !== "string" || candidate.sponsorName.trim().length === 0) {
        return { reason: "every entry needs a non-empty sponsorName" };
      }
      if (candidate.sponsorName.trim().length > SPONSOR_NAME_MAX_LENGTH) {
        return { reason: `sponsorName must be at most ${SPONSOR_NAME_MAX_LENGTH} characters` };
      }
      if (!SPONSOR_TIERS_IN_PRIORITY_ORDER.includes(candidate.tier)) {
        return {
          reason: `every entry needs a tier, one of: ${SPONSOR_TIERS_IN_PRIORITY_ORDER.join(", ")}`,
        };
      }
      if (
        candidate.linkUrl !== undefined &&
        candidate.linkUrl !== null &&
        (typeof candidate.linkUrl !== "string" || candidate.linkUrl.trim().length === 0)
      ) {
        return { reason: "linkUrl must be a non-empty string or null" };
      }
      parsedSponsors.push({
        imageUrl: candidate.imageUrl.trim(),
        sponsorName: candidate.sponsorName.trim(),
        tier: candidate.tier,
        linkUrl: candidate.linkUrl?.trim?.() || null,
      });
    }
    return { value: parsedSponsors };
  };
}

// The two bound instances the write paths actually import.
const parseFestSponsors = buildSponsorsParser(FEST_SPONSORS_MAX);
const parseEventSponsors = buildSponsorsParser(EVENT_SPONSORS_MAX);

module.exports = {
  buildSponsorsParser,
  parseFestSponsors,
  parseEventSponsors,
  SPONSOR_TIERS,
};
