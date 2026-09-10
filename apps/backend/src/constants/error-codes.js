const ERROR_CODES = {
  INTERNAL_ERROR: "INTERNAL_ERROR",
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  VALIDATION_FAILED: "VALIDATION_FAILED",

  /*
   * There is deliberately no OTP_NOT_FOUND. A never-requested code and a wrong
   * code both return OTP_INVALID, so the endpoint cannot be used to learn
   * whether an address has an outstanding code.
   */
  OTP_SEND_RATE_LIMITED: "OTP_SEND_RATE_LIMITED",
  OTP_EXPIRED: "OTP_EXPIRED",
  OTP_INVALID: "OTP_INVALID",
  OTP_ATTEMPTS_EXCEEDED: "OTP_ATTEMPTS_EXCEEDED",
  /*
   * OTP_ATTEMPTS_EXCEEDED caps guesses against one code. This caps them against
   * one address across a rolling window, so requesting a fresh code cannot reset
   * the budget.
   */
  OTP_ATTEMPT_LIMIT_EXCEEDED: "OTP_ATTEMPT_LIMIT_EXCEEDED",

  /*
   * College onboarding applications. RATE_LIMITED caps public submissions per
   * IP; ALREADY_PENDING refuses a second open application for one address;
   * COLLEGE_ALREADY_REGISTERED refuses an application for a college that is
   * already live; ALREADY_REVIEWED refuses a second review decision.
   */
  APPLICATION_RATE_LIMITED: "APPLICATION_RATE_LIMITED",
  APPLICATION_ALREADY_PENDING: "APPLICATION_ALREADY_PENDING",
  APPLICATION_NOT_FOUND: "APPLICATION_NOT_FOUND",
  APPLICATION_ALREADY_REVIEWED: "APPLICATION_ALREADY_REVIEWED",
  COLLEGE_ALREADY_REGISTERED: "COLLEGE_ALREADY_REGISTERED",

  FEST_NOT_FOUND: "FEST_NOT_FOUND",
  COLLEGE_NOT_FOUND: "COLLEGE_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  // The shift endpoints return FORBIDDEN (the frontend maps it) for a coordinator
  // acting outside their covered checkpoints; the middleware still uses PERMISSION_DENIED.
  FORBIDDEN: "FORBIDDEN",
  INVALID_FEST_STATE: "INVALID_FEST_STATE",

  EVENT_NOT_FOUND: "EVENT_NOT_FOUND",
  INVALID_EVENT_STATE: "INVALID_EVENT_STATE",

  /*
   * Defining a question, on the event write path. QUESTION_INVALID is the
   * umbrella for a malformed shape with no more specific cause (a question that
   * is not an object, too many options); the rest name the cause, because an
   * organiser fixing their form needs to know which field is wrong.
   */
  QUESTION_INVALID: "QUESTION_INVALID",
  QUESTION_TEXT_REQUIRED: "QUESTION_TEXT_REQUIRED",
  QUESTION_TYPE_INVALID: "QUESTION_TYPE_INVALID",
  QUESTION_OPTIONS_REQUIRED: "QUESTION_OPTIONS_REQUIRED",
  QUESTION_DUPLICATE_ID: "QUESTION_DUPLICATE_ID",

  /* Answering a question, on the registration create path. */
  QUESTION_REQUIRED_MISSING: "QUESTION_REQUIRED_MISSING",
  QUESTION_ANSWER_INVALID: "QUESTION_ANSWER_INVALID",
  QUESTION_ANSWER_TOO_LONG: "QUESTION_ANSWER_TOO_LONG",

  /*
   * A physical event's liability declaration was not accepted. The declaration
   * text itself is the frontend's — one canonical string, not per-event — so this
   * only reports that acceptance is missing.
   */
  MEDICAL_DECLARATION_REQUIRED: "MEDICAL_DECLARATION_REQUIRED",
  // A fest offering food/accommodation demands the participant answer during
  // registration; the answer is missing or not a valid value.
  FOOD_PREFERENCE_REQUIRED: "FOOD_PREFERENCE_REQUIRED",
  // A food-order quantity outside the allowed range; details carry minimum/maximum.
  FOOD_ORDER_COUNT_INVALID: "FOOD_ORDER_COUNT_INVALID",
  // A non-reserved offer selection with a bad quantity; details name the offer.
  OFFER_SELECTION_INVALID: "OFFER_SELECTION_INVALID",
  ACCOMMODATION_PREFERENCE_REQUIRED: "ACCOMMODATION_PREFERENCE_REQUIRED",
  EVENT_ALREADY_CANCELLED: "EVENT_ALREADY_CANCELLED",
  // Reserved for a future double-publish guard; nothing throws it yet.
  EVENT_ALREADY_PUBLISHED: "EVENT_ALREADY_PUBLISHED",

  ASSIGNMENT_ALREADY_EXISTS: "ASSIGNMENT_ALREADY_EXISTS",
  ASSIGNMENT_NOT_FOUND: "ASSIGNMENT_NOT_FOUND",
  CANNOT_ASSIGN_SELF: "CANNOT_ASSIGN_SELF",
  // Access-expiry: a coordinator's window has ended, or their assignment was revoked.
  // Both are 403 on write endpoints; admins are exempt and reads stay open.
  ASSIGNMENT_EXPIRED: "ASSIGNMENT_EXPIRED",
  ASSIGNMENT_REVOKED: "ASSIGNMENT_REVOKED",

  USER_NOT_FOUND: "USER_NOT_FOUND",
  /* The caller's own account is blocked: they are the subject of the refusal. */
  USER_BLOCKED: "USER_BLOCKED",
  /*
   * Someone ELSE on the caller's team roster is blocked. A separate code because
   * the subject is different, and a message about "this account" would tell a
   * team leader their own account is barred when the truth is that a teammate's
   * is. The refused email travels in details so the copy can name them.
   */
  TEAM_MEMBER_BLOCKED: "TEAM_MEMBER_BLOCKED",
  PROFILE_INCOMPLETE: "PROFILE_INCOMPLETE",
  PROFILE_COLLEGE_NOT_FOUND: "PROFILE_COLLEGE_NOT_FOUND",

  EVENT_NOT_REGISTERABLE: "EVENT_NOT_REGISTERABLE",
  FEST_NOT_REGISTERABLE: "FEST_NOT_REGISTERABLE",
  // A named parent event is under a different fest than the child being created.
  PARENT_EVENT_WRONG_FEST: "PARENT_EVENT_WRONG_FEST",
  // Structure editor: the move would put an event inside its own subtree.
  EVENT_CIRCULAR_PARENT: "EVENT_CIRCULAR_PARENT",
  /*
   * Structure editor: a drop named a neighbour that no longer exists or has
   * since moved to another level, so the server cannot tell which gap the admin
   * meant. 409 — the client reloads the tree and retries from a fresh view.
   */
  EVENT_SIBLING_CONFLICT: "EVENT_SIBLING_CONFLICT",
  // Registration was attempted on a grouping (container) event that has children.
  REGISTRATION_ON_PARENT_EVENT: "REGISTRATION_ON_PARENT_EVENT",
  // Registration was attempted on an event with no category set yet.
  REGISTRATION_EVENT_NOT_CATEGORIZED: "REGISTRATION_EVENT_NOT_CATEGORIZED",
  // confirm-payment named a paymentGroupId with no pending rows to confirm.
  PAYMENT_GROUP_NOT_FOUND: "PAYMENT_GROUP_NOT_FOUND",
  /*
   * Razorpay captured the money AFTER the pending-payment hold lapsed and the
   * seat was released (409). Distinct from PAYMENT_GROUP_NOT_FOUND so the
   * participant gets an honest "you were charged, a refund is coming" message
   * and the operator has an audit trail to act on.
   */
  PAYMENT_CAPTURED_AFTER_EXPIRY: "PAYMENT_CAPTURED_AFTER_EXPIRY",
  // The Razorpay keys are absent, so payment features are off (503).
  PAYMENT_NOT_CONFIGURED: "PAYMENT_NOT_CONFIGURED",
  // A payment signature (checkout callback or webhook) did not verify (400).
  PAYMENT_VERIFICATION_FAILED: "PAYMENT_VERIFICATION_FAILED",
  REGISTRATION_NOT_OPEN_YET: "REGISTRATION_NOT_OPEN_YET",
  REGISTRATION_CLOSED: "REGISTRATION_CLOSED",
  REGISTRATION_NOT_FOUND: "REGISTRATION_NOT_FOUND",
  ALREADY_REGISTERED: "ALREADY_REGISTERED",
  // A prior paid attempt left a pending-payment hold with a real Razorpay order
  // still open. The retry is refused so the client can offer resume-or-cancel
  // rather than silently opening a second order. details.paymentGroupId points at
  // the checkout to resume.
  PENDING_PAYMENT_EXISTS: "PENDING_PAYMENT_EXISTS",
  EVENT_FULL: "EVENT_FULL",
  WRONG_COLLEGE: "WRONG_COLLEGE",
  TEAM_REGISTRATION_REQUIRED: "TEAM_REGISTRATION_REQUIRED",
  SOLO_REGISTRATION_REQUIRED: "SOLO_REGISTRATION_REQUIRED",
  INVALID_TEAM_SIZE: "INVALID_TEAM_SIZE",
  MEMBER_ALREADY_IN_TEAM: "MEMBER_ALREADY_IN_TEAM",
  TEAM_CANCEL_LEADER_ONLY: "TEAM_CANCEL_LEADER_ONLY",
  // A forming team joined by invite code: the code matched nothing, the team has
  // stopped accepting members (locked/disqualified), or its roster is already full.
  TEAM_NOT_FOUND: "TEAM_NOT_FOUND",
  TEAM_NOT_ACCEPTING_MEMBERS: "TEAM_NOT_ACCEPTING_MEMBERS",
  TEAM_FULL: "TEAM_FULL",
  // Locking a team is the leader's act alone — sibling of TEAM_CANCEL_LEADER_ONLY.
  TEAM_LOCK_LEADER_ONLY: "TEAM_LOCK_LEADER_ONLY",
  // A lock attempted below the event's minimumTeamSize; details carry
  // minimumTeamSize and currentSize so the client can say how many are missing.
  TEAM_BELOW_MINIMUM_SIZE: "TEAM_BELOW_MINIMUM_SIZE",

  /*
   * Cancellation is bounded for the participant and unbounded for staff: a
   * coordinator cannot run an event whose roster changes under them, but must be
   * able to strike a no-show at any point. Staff must state why; a participant
   * cancelling inside their own window owes no explanation.
   */
  REGISTRATION_CANCELLATION_WINDOW_CLOSED: "REGISTRATION_CANCELLATION_WINDOW_CLOSED",
  REGISTRATION_CANCELLATION_STATUS_LOCKED: "REGISTRATION_CANCELLATION_STATUS_LOCKED",
  CANCELLATION_REASON_REQUIRED: "CANCELLATION_REASON_REQUIRED",

  /*
   * An administrator may not hold a registration. Enforced in the service rather
   * than a route middleware: it is a rule about who may take a seat, not about
   * who may reach the route, and it covers the whole team roster — a member is
   * registered by the leader's call, not their own.
   */
  ADMIN_CANNOT_REGISTER: "ADMIN_CANNOT_REGISTER",


  /*
   * Someone has entered a result, so regenerating would destroy it. Refused for
   * everyone including administrators: an admin who really means it goes through
   * force-regenerate, which archives rather than overwrites and demands a reason.
   */
  BRACKET_HAS_ACTIVITY: "BRACKET_HAS_ACTIVITY",
  REGENERATION_REASON_REQUIRED: "REGENERATION_REASON_REQUIRED",
  MATCH_ALREADY_FINALIZED: "MATCH_ALREADY_FINALIZED",
  MATCH_NOT_FOUND: "MATCH_NOT_FOUND",

  /*
   * The caller's expectedVersion did not match the stored one: someone else
   * wrote to this match since the caller last read it. The error details carry
   * the current match so the client can show what changed instead of guessing.
   */
  MATCH_CONCURRENT_UPDATE: "MATCH_CONCURRENT_UPDATE",
  INVALID_WINNER: "INVALID_WINNER",
  SCORESHEET_ALREADY_SET: "SCORESHEET_ALREADY_SET",
  NOT_A_BRACKET_EVENT: "NOT_A_BRACKET_EVENT",
  INSUFFICIENT_PARTICIPANTS: "INSUFFICIENT_PARTICIPANTS",
  // Scoring/leaderboard is for non-bracket events; a bracket event uses the match system.
  LEADERBOARD_NOT_AVAILABLE: "LEADERBOARD_NOT_AVAILABLE",
  SCORE_NOT_FOUND: "SCORE_NOT_FOUND",

  CERTIFICATE_NOT_FOUND: "CERTIFICATE_NOT_FOUND",
  CERTIFICATES_ALREADY_RELEASED: "CERTIFICATES_ALREADY_RELEASED",
  // A fresh verification code collided on every retry — vanishingly rare.
  CERTIFICATE_CODE_COLLISION: "CERTIFICATE_CODE_COLLISION",

  // The pass exists and is valid; only its email could not be delivered.
  EMAIL_DELIVERY_FAILED: "EMAIL_DELIVERY_FAILED",
  // Upload guards for round briefs and coordinator certificates.
  FILE_TYPE_NOT_ALLOWED: "FILE_TYPE_NOT_ALLOWED",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  ROUND_NOT_FOUND: "ROUND_NOT_FOUND",
  ROUND_ALREADY_COMPLETED: "ROUND_ALREADY_COMPLETED",
  ROUND_CONCURRENT_UPDATE: "ROUND_CONCURRENT_UPDATE",
  // Home-screen promotions (platform-admin owned).
  PROMOTION_NOT_FOUND: "PROMOTION_NOT_FOUND",
  INVALID_PROMOTION_STATE: "INVALID_PROMOTION_STATE",
  PROMOTION_PUBLISH_LIMIT_REACHED: "PROMOTION_PUBLISH_LIMIT_REACHED",
  // A reorder named an id belonging to the other promotion type. Ordering is
  // per-type, so mixing them would silently renumber the wrong section.
  PROMOTION_TYPE_MISMATCH: "PROMOTION_TYPE_MISMATCH",
  // Promotions phase 2 (promoter / campaign / creative / placement).
  PROMOTER_NOT_FOUND: "PROMOTER_NOT_FOUND",
  CREATIVE_NOT_FOUND: "CREATIVE_NOT_FOUND",
  CAMPAIGN_NOT_FOUND: "CAMPAIGN_NOT_FOUND",
  INVALID_CAMPAIGN_STATE: "INVALID_CAMPAIGN_STATE",
  // Publish refused: no placement, or no active creative association.
  CAMPAIGN_NOT_PUBLISHABLE: "CAMPAIGN_NOT_PUBLISHABLE",
  // The per-placement publish cap; this campaign would exceed it.
  CAMPAIGN_PLACEMENT_CAP_REACHED: "CAMPAIGN_PLACEMENT_CAP_REACHED",
  PLACEMENT_INACTIVE: "PLACEMENT_INACTIVE",
  // A campaign may only run creatives owned by its own promoter.
  CREATIVE_PROMOTER_MISMATCH: "CREATIVE_PROMOTER_MISMATCH",
  // Phase 5 admin API. A name collision names the existing promoter.
  PROMOTER_NAME_TAKEN: "PROMOTER_NAME_TAKEN",
  // Archive refused: the promoter has published campaigns (named in details).
  PROMOTER_HAS_PUBLISHED_CAMPAIGNS: "PROMOTER_HAS_PUBLISHED_CAMPAIGNS",
  INVALID_PROMOTER_STATE: "INVALID_PROMOTER_STATE",
  // Archive refused: a published campaign runs this creative (named in details).
  CREATIVE_IN_PUBLISHED_CAMPAIGN: "CREATIVE_IN_PUBLISHED_CAMPAIGN",
  INVALID_CREATIVE_STATE: "INVALID_CREATIVE_STATE",
  // A live (published or paused) campaign refused an edit that would rewrite
  // what it is or what already happened; details names each field.
  CAMPAIGN_EDIT_REFUSED_WHILE_LIVE: "CAMPAIGN_EDIT_REFUSED_WHILE_LIVE",
  // The only active creative on a published campaign cannot be detached or paused.
  CAMPAIGN_LAST_ACTIVE_CREATIVE: "CAMPAIGN_LAST_ACTIVE_CREATIVE",
  // A decision token that is unknown, already consumed, or expired.
  DECISION_TOKEN_INVALID: "DECISION_TOKEN_INVALID",
  PASS_NOT_FOUND: "PASS_NOT_FOUND",

  /*
   * award-results was called on an event whose bracket final is not finalized and
   * whose scores are not finalized — there is no result to award yet.
   */
  RESULTS_NOT_FINALIZED: "RESULTS_NOT_FINALIZED",
  // A self-declared achievement was not found, or is not owned by the caller.
  ACHIEVEMENT_NOT_FOUND: "ACHIEVEMENT_NOT_FOUND",
  // A self-declared achievement's title/description failed the length or presence guard.
  ACHIEVEMENT_INVALID: "ACHIEVEMENT_INVALID",

  INVALID_CHECKPOINT: "INVALID_CHECKPOINT",
  CHECKPOINT_NOT_FOUND: "CHECKPOINT_NOT_FOUND",
  // A new offer checkpoint named an offerId that is not on this fest.
  CHECKPOINT_OFFER_MISMATCH: "CHECKPOINT_OFFER_MISMATCH",
  // The offers dashboard was asked about an offer that is on neither the fest
  // nor any of its events.
  OFFER_NOT_FOUND: "OFFER_NOT_FOUND",
  // A PATCH tried to move a checkpoint to another offer/fest. Its identity is
  // frozen: every logged scan carries this checkpointId, and re-pointing it
  // would silently relabel that history.
  CHECKPOINT_IDENTITY_FROZEN: "CHECKPOINT_IDENTITY_FROZEN",

  /* Volunteer shifts (12.1 frontend contract). */
  SHIFT_NOT_FOUND: "SHIFT_NOT_FOUND",
  SHIFT_INVALID_WINDOW: "SHIFT_INVALID_WINDOW",
  SHIFT_USER_NOT_VOLUNTEER: "SHIFT_USER_NOT_VOLUNTEER",
  SHIFT_CHECKPOINT_NOT_IN_FEST: "SHIFT_CHECKPOINT_NOT_IN_FEST",
  SHIFT_ALREADY_CANCELLED: "SHIFT_ALREADY_CANCELLED",

  // A caller with a valid session hit a login entry point. Login endpoints
  // refuse an already-authenticated request rather than mint a second session.
  USER_ALREADY_SIGNED_IN: "USER_ALREADY_SIGNED_IN",

  AUTHENTICATION_TOKEN_MISSING: "AUTHENTICATION_TOKEN_MISSING",
  AUTHENTICATION_TOKEN_INVALID: "AUTHENTICATION_TOKEN_INVALID",
  AUTHENTICATION_TOKEN_EXPIRED: "AUTHENTICATION_TOKEN_EXPIRED",

  /*
   * Contingent registration (priced bundles of solo sub-events).
   * NOT_FOUND doubles for a contingent under the wrong fest, so the endpoint
   * cannot be used to probe which contingent ids exist elsewhere.
   */
  CONTINGENT_NOT_FOUND: "CONTINGENT_NOT_FOUND",
  // A sub-event already sits inside another PUBLISHED contingent under the same
  // parent; details name the conflicting contingent so the admin can act.
  CONTINGENT_EVENT_CONFLICT: "CONTINGENT_EVENT_CONFLICT",
  // The parent event carries its own registration fee — a bundle under it would
  // double-charge.
  CONTINGENT_PARENT_HAS_FEE: "CONTINGENT_PARENT_HAS_FEE",
  // includedEventIds/pricePaise edit attempted after the first purchase (or off
  // DRAFT); name and description stay editable.
  CONTINGENT_IMMUTABLE_AFTER_PURCHASE: "CONTINGENT_IMMUTABLE_AFTER_PURCHASE",
  // Purchase attempted on a contingent that is not PUBLISHED.
  CONTINGENT_NOT_PURCHASABLE: "CONTINGENT_NOT_PURCHASABLE",
  // maximumBundleClaims reached — the bundle itself is sold out.
  CONTINGENT_SOLD_OUT: "CONTINGENT_SOLD_OUT",
  // All-or-nothing seat claim failed; details name the full sub-event.
  CONTINGENT_SEAT_UNAVAILABLE: "CONTINGENT_SEAT_UNAVAILABLE",
  // An attendee already holds an individual seat in an included sub-event.
  INDIVIDUAL_REGISTRATION_EXISTS: "INDIVIDUAL_REGISTRATION_EXISTS",
  // An attendee already has a live (invited/accepted) claim for that sub-event.
  CONTINGENT_CLAIM_EXISTS: "CONTINGENT_CLAIM_EXISTS",
  CONTINGENT_CLAIM_NOT_FOUND: "CONTINGENT_CLAIM_NOT_FOUND",
  // Per-vertical contingent codes.
  INVITE_CODE_NOT_FOUND: "INVITE_CODE_NOT_FOUND",
  INVITE_CODE_EXHAUSTED: "INVITE_CODE_EXHAUSTED",
  CAPTAIN_ALREADY_CLAIMED: "CAPTAIN_ALREADY_CLAIMED",
  // Add-ons may only be bought against a confirmed registration.
  REGISTRATION_NOT_CONFIRMED: "REGISTRATION_NOT_CONFIRMED",
  // Accept refused: the claim is not in an acceptable state, or its event/fest
  // has since closed or been cancelled. details.reason says which.
  CONTINGENT_CLAIM_NOT_ACCEPTABLE: "CONTINGENT_CLAIM_NOT_ACCEPTABLE",
  // Buyer cancellation refused because an attendee has already scanned in.
  CONTINGENT_CANCEL_BLOCKED_BY_SCANS: "CONTINGENT_CANCEL_BLOCKED_BY_SCANS",
  // Cancelling a sub-event that a live contingent includes; details name the
  // contingent the admin must unwind first.
  CONTINGENT_LOCKS_EVENT: "CONTINGENT_LOCKS_EVENT",

  /*
   * PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
   * The environment gate on the dev/staging-only fest purge, and its rate limit.
   */
  PURGE_NOT_ALLOWED_IN_ENVIRONMENT: "PURGE_NOT_ALLOWED_IN_ENVIRONMENT",
  PURGE_RATE_LIMITED: "PURGE_RATE_LIMITED",

  // Google Sign-In. NOT_CONFIGURED is the server having no GOOGLE_CLIENT_ID;
  // TOKEN_INVALID covers a token that fails Google's verification or whose email
  // Google has not verified; EMAIL_MISSING is a verified token that carries no
  // email claim at all (defensive — Google's ID tokens normally always have one).
  GOOGLE_SIGN_IN_NOT_CONFIGURED: "GOOGLE_SIGN_IN_NOT_CONFIGURED",
  GOOGLE_TOKEN_INVALID: "GOOGLE_TOKEN_INVALID",
  GOOGLE_EMAIL_MISSING: "GOOGLE_EMAIL_MISSING",

  // Post-event feedback. NOT_ATTENDED is the "no armchair reviews" gate: a
  // participant with no accepted scan for the event has no basis to rate it.
  // ALREADY_SUBMITTED is the one-shot rule — feedback cannot be revised.
  FEEDBACK_NOT_ATTENDED: "FEEDBACK_NOT_ATTENDED",
  FEEDBACK_ALREADY_SUBMITTED: "FEEDBACK_ALREADY_SUBMITTED",

  // The bulk-email throttle: three sends per event per calendar day.
  BULK_EMAIL_LIMIT_REACHED: "BULK_EMAIL_LIMIT_REACHED",

  // The public-surface rate limiter (429). Distinct from the OTP and
  // application limiters, which cap one specific action rather than traffic.
  RATE_LIMITED: "RATE_LIMITED",

  // A waitlist that has reached its own cap; the event is full AND the queue is.
  WAITLIST_FULL: "WAITLIST_FULL",

  /*
   * The policy registry has no effective, hashed version of a document kind.
   * At boot this stops the process; at runtime (a version removed by hand) it
   * fails the consent write rather than recording an unprovable consent.
   */
  POLICY_VERSION_MISSING: "POLICY_VERSION_MISSING",
  POLICY_VERSION_NOT_FOUND: "POLICY_VERSION_NOT_FOUND",
  /*
   * The policy changed while the form was open: the tick names a version that
   * is no longer the effective one for its kind. An ordinary, expected outcome
   * (409), not a fault — the honest answer is to show the new text and ask
   * again. details names the document, the submitted version and the current
   * one so the client can do exactly that.
   */
  POLICY_VERSION_STALE: "POLICY_VERSION_STALE",
};

module.exports = { ERROR_CODES };
