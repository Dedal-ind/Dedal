const { SignInLogModel } = require("../models/sign-in-log-model");
const { UserModel } = require("../models/user-model");
const { SIGN_IN_METHODS } = require("../constants/sign-in-constants");

// The IP is required on the log; a caller without request context still records something.
const UNKNOWN_IP_ADDRESS = "unknown";

/*
 * Records one sign-in and folds the same event into the user's mutable summary:
 * lastSignedInAt and signInCount always move; signedUpAt is stamped only the first
 * time, so it captures the moment the account came into being and never drifts.
 */
async function recordSignIn(userId, emailAddress, ipAddress, userAgent, signInMethod = SIGN_IN_METHODS.EMAIL_OTP) {
  const now = new Date();

  await SignInLogModel.create({
    userId,
    emailAddress,
    ipAddress: ipAddress || UNKNOWN_IP_ADDRESS,
    userAgent: userAgent || null,
    signInMethod,
    signedInAt: now,
  });

  // A single write moves the counters; signedUpAt is set below only when still null.
  await UserModel.updateOne(
    { _id: userId },
    { $set: { lastSignedInAt: now }, $inc: { signInCount: 1 } }
  );
  await UserModel.updateOne(
    { _id: userId, signedUpAt: null },
    { $set: { signedUpAt: now } }
  );
}

module.exports = { recordSignIn };
