const mongoose = require("mongoose");
const validator = require("validator");
const { isUnderEighteen } = require("../helpers/age-helpers");

const userSchema = new mongoose.Schema(
  {
    /*
     * Uniqueness is declared once, on the named index below. Adding
     * `unique: true` here as well would make Mongoose register a second,
     * auto-named index (emailAddress_1) over the same key.
     */
    emailAddress: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (value) => validator.isEmail(value),
        message: "Email address is not valid.",
      },
    },
    fullName: { type: String, trim: true, default: null },
    collegeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    usn: { type: String, trim: true, uppercase: true, default: null },
    yearOfStudy: { type: Number, min: 1, max: 6, default: null },
    department: { type: String, trim: true, default: null },

    // Optional student ID card image, uploaded through POST /uploads. Stored as
    // the returned URL; used for on-desk identity checks.
    studentIdUrl: { type: String, trim: true, default: null },
    /*
     * An institutional address, kept ALONGSIDE emailAddress rather than replacing
     * it: emailAddress is the sign-in identity and must not move, while this is a
     * contact detail an organiser can use to reach someone officially. Optional —
     * plenty of participants have no institutional address at all.
     */
    professionalEmail: { type: String, trim: true, lowercase: true, default: null },
    /*
     * The participant's own contact number, collected at profile completion.
     * Free text: regional and international formats vary too widely to validate,
     * and a rejected real number is worse than an odd-looking one.
     *
     * select: false — it never travels unless a query asks for it by name with a
     * leading +. Every reader that should have it does; the point is what happens
     * to the next one. The default was to include it, so a populate written
     * without a select — one line, easily reviewed past — shipped it to whoever
     * was reading. That is not hypothetical: the bracket endpoint leaked
     * competitor emails exactly that way for weeks. (The emergency contact
     * fields that used to sit here under the same rule were removed outright —
     * per-registration next-of-kin for risky events is a separate feature.)
     */
    phoneNumber: { type: String, trim: true, default: null, select: false },

    /*
     * Password sign-in, alongside OTP and Google. select:false so it can never
     * ride out on an ordinary user read — every verification names it explicitly.
     */
    passwordHash: { type: String, default: null, select: false },
    /*
     * Stamped on every set/change. authentication-middleware compares it against
     * the JWT's iat: a token issued BEFORE the last password change is refused,
     * which is what makes a password change revoke stolen sessions on a
     * stateless JWT.
     */
    passwordChangedAt: { type: Date, default: null },

    /*
     * A human-readable participant identifier (e.g. RAHULK3210), generated once
     * when the profile is first completed and never changed. Uppercase and unique
     * via the sparse index below; like aisheCode on the college model it has no
     * default, so the index skips placeholder users that never completed a profile.
     * Not sensitive — meant to be visible on passes, certificates and rosters.
     */
    participantId: { type: String, trim: true, uppercase: true },

    emailVerifiedAt: { type: Date, default: null },
    /*
     * The Google account's stable subject id, set once a user signs in with Google
     * (or has Google linked to their existing email account). Null for OTP-only
     * users. Uniqueness is enforced by a partial index — see below — so one Google
     * account maps to at most one Dedal account.
     */
    googleId: { type: String, default: null },
    /*
     * The user's photo, taken from the Google `picture` claim when they sign in
     * with Google and refreshed whenever Google's copy changes. Null for OTP-only
     * users and for Google accounts with no photo — the clients fall back to the
     * initials monogram, so null is a supported state, not a missing one. We store
     * the URL rather than the bytes: there is no upload infrastructure yet, and a
     * user-set photo is not a feature we offer.
     */
    profilePictureUrl: { type: String, default: null },

    /*
     * Events this user bookmarked. Stored on the user rather than as its own
     * collection: the list is small, always read whole, and only ever read by
     * its owner.
     *
     * This used to live in browser localStorage, which tied saves to a device
     * rather than an account, and — because the key was never scoped to a user
     * — let two people on the same phone see each other's saves.
     */
    savedEventIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Event" }],
      default: [],
    },
    isProfileComplete: { type: Boolean, default: false },
    // Set by moderation; a blocked user cannot register for or be added to events.
    isBlocked: { type: Boolean, default: false },

    /*
     * Set on the first OTP verify and never again, so it marks when the account
     * came into being. lastSignedInAt and signInCount are the mutable running
     * summary of sign-in activity, maintained beside the append-only signInLogs.
     */
    signedUpAt: { type: Date, default: null },
    lastSignedInAt: { type: Date, default: null },
    signInCount: { type: Number, min: 0, default: 0 },

    /*
     * DEPRECATED — READ-ONLY REMNANTS, kept for one release. Consent is now a
     * provable, append-only ConsentRecord naming the policy version and its
     * content hash (see consent-record-model.js and consent-service.js); the
     * backfill (migrate:consent-records) has turned every stamp here into such
     * a record. Nothing writes these any more. Delete them, and this comment,
     * next release, after the frontend's settings screens read consent
     * standing from GET /users/me/consents instead.
     */
    privacyPolicyConsentedAt: { type: Date, default: null },
    termsOfServiceConsentedAt: { type: Date, default: null },

    /*
     * Date of birth: the ONLY age fact stored. Age and "is a minor" are
     * derived at read time (age-helpers.js, and the isUnderEighteen virtual
     * below) because a stored age or flag is wrong the morning after a
     * birthday and nothing would recompute it.
     *
     * Optional, and never a gate: existing users have none, and a missing
     * date must not lock anyone out. Where it is absent the predicate returns
     * null — UNKNOWN — and callers must treat unknown as "may be a child".
     * Stored as a UTC-midnight Date; only the calendar date is meaningful.
     */
    dateOfBirth: { type: Date, default: null },
  },
  { timestamps: true }
);

/*
 * true: under eighteen — a child under India's DPDP Act, 2023, for whom
 * tracking, profiling and targeted advertising are prohibited outright.
 * false: an adult. null: unknown (no date of birth) — treat as a child.
 *
 * KNOWN OUTSTANDING OBLIGATION: verifiable parental consent for under-18s
 * does not exist yet. Until it does, anyone for whom this is true or null
 * must receive only non-personalised, non-tracked promotions. Nothing
 * consumes this predicate yet; it exists so the later phase has one switch.
 */
userSchema.virtual("isUnderEighteen").get(function deriveIsUnderEighteen() {
  return isUnderEighteen(this.dateOfBirth);
});

userSchema.index(
  { emailAddress: 1 },
  { unique: true, name: "index_users_emailAddress" }
);
userSchema.index(
  { participantId: 1 },
  { unique: true, sparse: true, name: "index_users_participantId" }
);
/*
 * Unique per linked Google account. A PARTIAL index over just the string values,
 * not a sparse one: googleId defaults to null, so every OTP-only user carries the
 * field as a present null, and a sparse unique index — which only skips ABSENT
 * fields — would collide on the second null. Partial-on-$type:string indexes only
 * the accounts that actually have a Google id.
 */
userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: { googleId: { $type: "string" } },
    name: "index_users_googleId",
  }
);

/*
 * The one place that decides what "complete" means, so the flag can never drift
 * from the fields it summarises.
 */
userSchema.methods.recomputeIsProfileComplete = function recomputeIsProfileComplete() {
  this.isProfileComplete = Boolean(this.fullName && this.collegeId && this.usn && this.phoneNumber);
  return this.isProfileComplete;
};

userSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    // An internal identity link, not profile data the client needs.
    delete plainObject.googleId;
    return plainObject;
  },
});

const UserModel = mongoose.model("User", userSchema);

module.exports = { UserModel };
