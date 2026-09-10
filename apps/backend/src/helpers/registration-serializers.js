const { resolveCustomResponses } = require("./validate-custom-responses");

/*
 * How a registration is shaped for its owner. Shared by the read paths and by
 * whatever returns a registration after writing one, so a row looks the same
 * however the caller arrived at it.
 */
const DETAIL_POPULATE = [
  {
    path: "eventId",
    // customQuestions rides along so a read can name each answer's prompt without
    // a second query, and without the frontend joining back to the event itself.
    select:
      "eventName festId startsAt endsAt venue status category eventType scoringFormat customQuestions posterImageUrl",
    /*
     * The fest rides along, and so does ITS host college and banner.
     *
     * The participant hub groups registrations BY FEST — a student thinks "I am
     * going to Ignite and Alliance ONE", not "I have three upcoming and four
     * past". That grouping needs a fest header carrying the college and a
     * thumbnail, and both were missing: hostCollegeId came back as a bare
     * ObjectId string and bannerImageUrl was not selected at all, so the header
     * could only ever have shown a name and a date.
     *
     * Nesting the college populate here keeps it at ONE round trip for the
     * whole list. The alternative the client would otherwise be pushed into is
     * a fest lookup per section, which is an N+1 on the busiest screen a
     * participant opens.
     */
    populate: {
      path: "festId",
      /*
       * `sponsors` rides along too. The registration detail screen shows a
       * sponsor credit under the fest, the same co-production credit the fest
       * and event pages carry, and without this field it had nothing to render.
       * It is a small array of {sponsorName, logoUrl, tier} already public on
       * the fest page, so this exposes nothing new — it just saves the client a
       * second request for a fest it has already been given.
       */
      select: "festName festSlug startsOn endsOn bannerImageUrl hostCollegeId sponsors",
      populate: { path: "hostCollegeId", select: "commonName collegeName city" },
    },
  },
  {
    path: "teamId",
    select: "teamName leaderUserId memberUserIds inviteCode",
    populate: { path: "memberUserIds", select: "fullName emailAddress" },
  },
  /*
   * Only present on a row a contingent claim materialised. The claim itself
   * carries nothing the participant needs — the BUNDLE's name is what tells
   * them "this seat came from the Management Contingent", so the nested
   * populate is the point, and the select stays narrow to that.
   */
  {
    path: "contingentClaimId",
    select: "contingentId claimStatus",
    populate: { path: "contingentId", select: "contingentName", model: "Contingent" },
  },
];

/*
 * A populated registration, with each answer's prompt and type resolved from the
 * event it was populated with. A registration whose event was not populated (or
 * whose questions were since deleted) still reads back — the answers are history
 * and survive their questions.
 */
function toRegistrationJson(registration) {
  const plainRegistration = registration.toJSON();
  const event = registration.eventId;
  const customQuestions = event && event.customQuestions ? event.customQuestions : [];

  plainRegistration.customResponses = resolveCustomResponses(
    customQuestions,
    plainRegistration.customResponses
  );
  return plainRegistration;
}

/* Step 1 of every register call: the caller must exist, be unblocked, and have a complete profile. */

module.exports = { DETAIL_POPULATE, toRegistrationJson };
