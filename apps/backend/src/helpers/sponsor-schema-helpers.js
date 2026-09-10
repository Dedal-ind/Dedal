const mongoose = require("mongoose");
const { SPONSOR_TIERS, SPONSOR_NAME_MAX_LENGTH } = require("../constants/fest-constants");

/*
 * The ONE sponsor subdocument shape, shared by fest.sponsors and event.sponsors.
 *
 * It lives in helpers rather than in either model for the same reason
 * offer-schema-helpers.js does: both models embed it and neither owns it. A
 * fest-wide title sponsor and an event's own title sponsor are two different
 * sponsors, but they must never drift into two different SHAPES — the frontend
 * resolves sponsors across fest and event with a single code path, and a field
 * that exists at one level and not the other silently breaks that path.
 *
 * Building it through a factory (rather than sharing one Schema instance) keeps
 * each model's subdocument paths independent, which is what Mongoose expects
 * when the same shape is embedded twice.
 *
 * FIELD NAME NOTE: the logo field is `imageUrl` and stays `imageUrl`. It is
 * already in a live public payload that the participant app's sponsor strip
 * reads, so renaming it to something like `logoUrl` would invalidate every
 * stored subdocument and every existing reader for no gain.
 */
function buildSponsorSchema() {
  return new mongoose.Schema({
    // The logo itself — the one thing a sponsor entry cannot be rendered without.
    imageUrl: { type: String, required: true, trim: true },

    /*
     * SCHEMA AND PARSER DELIBERATELY DIFFER HERE.
     *
     * The write parser (parseSponsors) REQUIRES a non-empty sponsorName: new
     * data must be complete. The schema leaves it nullable because sponsor
     * subdocuments already stored in the database predate that rule, and a
     * schema-level `required` would make an unrelated future PATCH of a legacy
     * fest fail validation on a field the administrator never touched.
     */
    sponsorName: { type: String, trim: true, maxlength: SPONSOR_NAME_MAX_LENGTH, default: null },

    /*
     * The sponsor's billing rank, used by the frontend to size and order logos.
     *
     * NOT schema-`required`, for exactly the reason above: existing sponsor
     * subdocuments predate this field entirely, and making it required would
     * make an unrelated future PATCH of a legacy fest fail validation on a field
     * the administrator never touched. The default backfills those rows with the
     * lowest tier on their next save. On WRITE the parser requires it, because a
     * write is new data and the default exists only for rows already stored.
     */
    tier: {
      type: String,
      enum: Object.values(SPONSOR_TIERS),
      default: SPONSOR_TIERS.PARTNER,
    },

    // Optional click-through to the sponsor's own site.
    linkUrl: { type: String, trim: true, default: null },
  });
}

module.exports = { buildSponsorSchema };
