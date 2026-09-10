const { UserModel } = require("../models/user-model");
const { createOtpCode, consumeOtpCode } = require("./otp-service");
const { sendOtpEmail } = require("./email-service");
const { recordSignIn } = require("./sign-in-log-service");
const { createAuthenticationToken } = require("../helpers/token-helpers");
const { verifyGoogleIdToken } = require("../helpers/google-auth-helpers");
const { SIGN_IN_METHODS } = require("../constants/sign-in-constants");

/*
 * The response shape is identical whether or not a user exists for this address.
 * Any branch on existence here would turn the endpoint into an account oracle.
 */
async function requestOtp(emailAddress, context = {}) {
  const otpCode = await createOtpCode(emailAddress, context.ipAddress);
  const wasEmailSent = await sendOtpEmail(emailAddress, otpCode);

  const responseData = { sent: wasEmailSent };
  if (!wasEmailSent) {
    responseData.warning = "email_delivery_failed";
  }
  return responseData;
}

/*
 * Turn a proven-owned email address into a session. Shared by both sign-in paths
 * — OTP and Google — because everything downstream of "we trust this address" is
 * the same: upsert the user, stamp verification, record the sign-in, mint a
 * token. Only the proof differs (a consumed code vs a verified Google token), and
 * that lives in the callers.
 *
 * `defaults.fullName` is applied ONLY when the account has no name yet — a
 * first-time Google user gets their name prefilled, but a returning user who set
 * a different name keeps it; a sign-in must never rewrite the profile.
 */
/*
 * The shared tail of every sign-in, once the account row is in hand: stamp email
 * verification and a first-time name, persist (which also writes any googleId a
 * caller linked), record the sign-in, and mint the token. Never overwrites a name
 * the user already set — a sign-in must not rewrite the profile.
 */
async function finalizeSession(user, context, defaults, signInMethod, isNewUser) {
  if (!user.emailVerifiedAt) {
    user.emailVerifiedAt = new Date();
  }
  if (!user.fullName && defaults.fullName) {
    user.fullName = defaults.fullName;
  }

  /*
   * isProfileComplete is deliberately NOT recomputed here. Signing in changes no
   * profile field, so re-deriving the flag can only demote an already-complete
   * account — which is exactly what happened to users whose completeness was set
   * without every field recompute demands (e.g. a usn). The flag is owned solely
   * by the profile-update path (user-service), which recomputes it whenever the
   * fields actually change; a brand-new account is already false by schema default.
   */
  await user.save();

  // Sign-in history must never break the sign-in itself.
  try {
    await recordSignIn(user._id, user.emailAddress, context.ipAddress, context.userAgent, signInMethod);
  } catch (error) {
    /*
     * The id, not the address. Whoever is debugging this can look the user up in
     * a second; a log aggregator that has quietly accumulated every sign-in
     * failure's email address cannot un-know them.
     */
    console.error(`Sign-in log write failed for user ${user._id}: ${error.message}`);
  }

  return {
    authenticationToken: createAuthenticationToken(user),
    user: user.toJSON(),
    isNewUser,
  };
}

/*
 * Turn a proven-owned email address into a session (the OTP path).
 *
 * An atomic upsert rather than findOne-then-create: two sign-ins racing on the
 * same new address would otherwise both insert, and the second would hit the
 * unique index and surface as a 500. includeResultMetadata tells us which call
 * did the insert, which is what isNewUser reports.
 */
async function establishSession(emailAddress, context = {}, defaults = {}, signInMethod = SIGN_IN_METHODS.EMAIL_OTP) {
  const updateResult = await UserModel.findOneAndUpdate(
    { emailAddress },
    { $setOnInsert: { emailAddress } },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      includeResultMetadata: true,
    }
  );

  return finalizeSession(
    updateResult.value,
    context,
    defaults,
    signInMethod,
    Boolean(updateResult.lastErrorObject?.upserted)
  );
}

async function verifyOtp(emailAddress, submittedCode, context = {}) {
  await consumeOtpCode(emailAddress, submittedCode);
  return establishSession(emailAddress, context, {}, SIGN_IN_METHODS.EMAIL_OTP);
}

/*
 * Google Sign-In. The ID token is verified against Google's keys and our Client
 * ID (see google-auth-helpers) before we trust a single field of it. The verified
 * identity then resolves to an account in three ordered steps:
 *
 *   (a) googleId already linked  → that account, signed straight in.
 *   (b) no googleId, email known → the EXISTING email account, with the Google
 *       subject linked onto it. This is the account-merge case: an OTP user and a
 *       Google user with the same verified email are the same person, so their
 *       participantId, registrations, passes and profile are all preserved — we
 *       never mint a second account for them.
 *   (c) neither                  → a brand-new account, name prefilled from Google.
 *
 * (b)/(c) share one atomic upsert-by-email (same race safety as the OTP path); the
 * googleId is stamped on afterwards, idempotently, and persisted by finalizeSession.
 */
/*
 * The photo is the one profile field a Google sign-in DOES keep in step with
 * Google — unlike the name, which is a first-time default the user may override.
 * We hold no other copy of it and offer no way to set one, so Google's is always
 * the truth; a user who changes their Google photo sees the new one here.
 *
 * A missing claim leaves the stored value alone rather than clearing it: "Google
 * sent no picture this time" is not the same as "this user has no picture", and
 * the second reading would blank a working avatar. The equality check keeps the
 * common case — an unchanged photo — from marking the document dirty.
 */
function applyGooglePicture(user, profilePictureUrl) {
  if (profilePictureUrl && user.profilePictureUrl !== profilePictureUrl) {
    user.profilePictureUrl = profilePictureUrl;
  }
}

async function signInWithGoogle(idToken, context = {}) {
  const identity = await verifyGoogleIdToken(idToken);
  const googleId = identity.googleSubject;

  // (a) A Google account we have already linked.
  const linkedUser = await UserModel.findOne({ googleId });
  if (linkedUser) {
    applyGooglePicture(linkedUser, identity.profilePictureUrl);
    return finalizeSession(linkedUser, context, { fullName: identity.fullName }, SIGN_IN_METHODS.GOOGLE, false);
  }

  // (b)/(c) Link to the existing email account, or create one.
  const updateResult = await UserModel.findOneAndUpdate(
    { emailAddress: identity.emailAddress },
    { $setOnInsert: { emailAddress: identity.emailAddress } },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      includeResultMetadata: true,
    }
  );
  const user = updateResult.value;
  user.googleId = googleId;
  applyGooglePicture(user, identity.profilePictureUrl);
  return finalizeSession(
    user,
    context,
    { fullName: identity.fullName },
    SIGN_IN_METHODS.GOOGLE,
    Boolean(updateResult.lastErrorObject?.upserted)
  );
}

module.exports = { requestOtp, verifyOtp, signInWithGoogle };
