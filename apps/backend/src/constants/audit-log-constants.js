/*
 * The vocabulary of the append-only audit trail. Actions are namespaced by
 * entity so a query can prefix-match a family ("fest.*") later. Every action a
 * service records must be listed here, and every action maps to one entity type.
 */
const AUDIT_ACTIONS = {
  FEST_CREATED: "fest.created",
  FEST_UPDATED: "fest.updated",
  FEST_PUBLISHED: "fest.published",
  FEST_ARCHIVED: "fest.archived",
  FEST_UNARCHIVED: "fest.unarchived",
  /* The fest was called off: every event cascaded, everyone notified. One-way. */
  FEST_CANCELLED: "fest.cancelled",

  EVENT_CREATED: "event.created",
  EVENT_UPDATED: "event.updated",
  EVENT_PUBLISHED: "event.published",
  EVENT_CANCELLED: "event.cancelled",
  // Structure editor: a reparent/reorder, and the batched form of the same.
  EVENT_MOVED: "event.moved",
  EVENT_REORDERED: "event.reordered",
  CONTINGENT_VERTICAL_CODE_REDEEMED: "contingent.verticalCodeRedeemed",
  REGISTRATION_ADD_ONS_ADDED: "registration.addOnsAdded",
  TEAM_CAPTAIN_CLAIMED: "team.captainClaimed",
  TEAM_CAPTAIN_RESIGNED: "team.captainResigned",
  // A coordinator mailing every confirmed registrant of an event. Rate-limited
  // to three a day per event; the audit row is the record of who sent what.
  BULK_EMAIL_SENT: "event.bulkEmailSent",
  // A seat came back and the next person in the queue was given it, automatically.
  WAITLIST_PROMOTED: "registration.waitlistPromoted",

  STAFF_ASSIGNED: "staff.assigned",
  STAFF_REVOKED: "staff.revoked",

  // The coordinator's multi-round judging flow.
  ROUND_CREATED: "round.created",
  ROUND_UPDATED: "round.updated",
  ROUND_SCORES_SAVED: "round.scoresSaved",
  ROUND_PARTICIPANTS_ADVANCED: "round.participantsAdvanced",
  ROUND_PARTICIPANTS_RETRACTED: "round.participantsRetracted",
  // Platform-wide home-screen banners.
  PROMOTION_CREATED: "promotion.created",
  PROMOTION_UPDATED: "promotion.updated",
  PROMOTION_PUBLISHED: "promotion.published",
  PROMOTION_ARCHIVED: "promotion.archived",
  PROMOTION_DELETED: "promotion.deleted",
  PROMOTION_REORDERED: "promotion.reordered",
  // Promotions phase 2: promoter / campaign / creative / placement.
  PROMOTER_CREATED: "promoter.created",
  PROMOTER_UPDATED: "promoter.updated",
  PROMOTER_ARCHIVED: "promoter.archived",
  PROMOTER_RESTORED: "promoter.restored",
  CREATIVE_CREATED: "creative.created",
  CREATIVE_UPDATED: "creative.updated",
  CREATIVE_ARCHIVED: "creative.archived",
  CREATIVE_RESTORED: "creative.restored",
  CAMPAIGN_CREATED: "campaign.created",
  CAMPAIGN_UPDATED: "campaign.updated",
  CAMPAIGN_PUBLISHED: "campaign.published",
  CAMPAIGN_ARCHIVED: "campaign.archived",
  CAMPAIGN_DELETED: "campaign.deleted",
  CAMPAIGN_CREATIVE_ATTACHED: "campaign.creativeAttached",
  CAMPAIGN_CREATIVE_UPDATED: "campaign.creativeUpdated",
  CAMPAIGN_CREATIVE_DETACHED: "campaign.creativeDetached",
  CAMPAIGN_PAUSED: "campaign.paused",
  CAMPAIGN_RESUMED: "campaign.resumed",
  // A targeting / placement / tier / weight / pacing change on a LIVE campaign.
  CAMPAIGN_RETUNED_LIVE: "campaign.retunedLive",
  // Consent: every acceptance and withdrawal is a mutation, so it is audited;
  // publishing a legal text version likewise.
  CONSENT_ACCEPTED: "consent.accepted",
  CONSENT_WITHDRAWN: "consent.withdrawn",
  POLICY_VERSION_PUBLISHED: "policyVersion.published",
  CHECKPOINT_VOLUNTEERS_ALERTED: "checkpoint.volunteersAlerted",
  SHIFT_CREATED: "shift.created",
  // A default shift minted automatically alongside a volunteer assignment, so
  // "assigned but never scheduled" stops being a state an admin can forget in.
  AUTO_SHIFT_CREATED: "shift.autoCreated",
  SHIFT_UPDATED: "shift.updated",
  SHIFT_CANCELLED: "shift.cancelled",

  /* The leader closed their forming team's roster. */
  TEAM_LOCKED: "team.locked",

  REGISTRATION_CREATED: "registration.created",
  /*
   * REGISTRATION_CANCELLED is kept: rows written before this chunk carry it, and
   * an audit log is history that is never rewritten. New cancellations name the
   * actor's role instead, so a late cancellation can be traced to who forced it.
   */
  REGISTRATION_CANCELLED: "registration.cancelled",
  REGISTRATION_CANCELLED_BY_SELF: "registration.cancelled.bySelf",
  REGISTRATION_CANCELLED_BY_COORDINATOR: "registration.cancelled.byCoordinator",
  REGISTRATION_CANCELLED_BY_ADMIN: "registration.cancelled.byAdmin",

  /*
   * A Razorpay capture landed after the pending-payment hold had already been
   * expired and its seat released. The row is the operator's refund trail.
   */
  PAYMENT_CAPTURED_AFTER_EXPIRY: "payment.capturedAfterExpiry",

  CONTINGENT_CREATED: "contingent.created",
  CONTINGENT_UPDATED: "contingent.updated",
  CONTINGENT_PUBLISHED: "contingent.published",
  CONTINGENT_CANCELLED: "contingent.cancelled",
  /* One row per purchase (not per claim); afterState carries the claim count. */
  CONTINGENT_PURCHASED: "contingent.purchased",
  CONTINGENT_CLAIM_ACCEPTED: "contingentClaim.accepted",
  CONTINGENT_CLAIM_DECLINED: "contingentClaim.declined",
  /* The buyer (or an admin cancelling the contingent) unwound a purchase. */
  CONTINGENT_PURCHASE_CANCELLED: "contingent.purchaseCancelled",
  /*
   * A captured payment now owed back. The platform has no refund API — this row
   * plus the order's refundPending status is what the operator acts on.
   */
  PAYMENT_REFUND_PENDING: "payment.refundPending",

  BRACKET_GENERATED: "bracket.generated",
  /* A rebuild over a bracket nobody had touched: no results were lost. */
  BRACKET_REGENERATED_CLEAN: "bracket.regenerated.clean",
  /* An administrator overrode the activity guard. Results were archived. */
  BRACKET_FORCE_REGENERATED: "bracket.forceRegenerated",
  MATCH_RESULT_ENTERED: "match.resultEntered",
  MATCH_SCORESHEET_UPLOADED: "match.scoresheetUploaded",

  SCORES_INITIALIZED: "score.initialized",
  SCORE_UPDATED: "score.updated",
  SCORES_FINALIZED: "score.finalized",

  /*
   * An event moved, so every door window on it was re-cut. Recorded because a
   * participant whose scan window silently changed has no other way to find out
   * why, and because it is the one write nobody asked for by name.
   */
  ENTITLEMENT_WINDOWS_REFRESHED: "entitlement.windowsRefreshed",

  /*
   * PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
   * A test fest was hard-deleted in development/staging. Written BEFORE the
   * deletes and deliberately excluded from them, so it is the only surviving
   * record that the fest existed.
   */
  TEST_FEST_PURGED: "test.festPurged",

  /* A CSV export left the system — who took which data set, and how many rows. */
  DATA_EXPORTED: "data.exported",

  CERTIFICATES_GENERATED: "certificates.generated",
  CERTIFICATES_RELEASED: "certificates.released",
  // The results board's two explicit event-scoped pushes (generate + release
  // composed), split by certificate audience.
  CERTIFICATE_PUSHED_WINNERS: "certificates.pushedWinners",
  CERTIFICATE_PUSHED_PARTICIPATION: "certificates.pushedParticipation",

  ACHIEVEMENT_EVENT_RESULT_AWARDED: "achievement.eventResultAwarded",
  ACHIEVEMENT_BADGE_AWARDED: "achievement.badgeAwarded",
};

const AUDIT_ENTITY_TYPES = {
  FEST: "fest",
  EVENT: "event",
  STAFF_ASSIGNMENT: "staffAssignment",
  TEAM: "team",
  REGISTRATION: "registration",
  CONTINGENT: "contingent",
  CONTINGENT_CLAIM: "contingentClaim",
  CERTIFICATE: "certificate",
  MATCH: "match",
  SHIFT: "shift",
  EVENT_SCORE: "eventScore",
  ACHIEVEMENT: "achievement",
  PROMOTION: "promotion",
  PROMOTER: "promoter",
  CREATIVE: "creative",
  CAMPAIGN: "campaign",
  CAMPAIGN_CREATIVE: "campaignCreative",
  CONSENT_RECORD: "consentRecord",
  POLICY_DOCUMENT_VERSION: "policyDocumentVersion",
};

module.exports = { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES };
