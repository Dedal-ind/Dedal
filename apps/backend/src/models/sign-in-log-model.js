const mongoose = require("mongoose");
const { SIGN_IN_METHODS } = require("../constants/sign-in-constants");

/*
 * Append-only: one row per successful sign-in, written once and never edited or
 * deleted. It is the queryable history behind "where has this account signed in
 * from", separate from the mutable per-user lastSignedInAt summary on the user.
 */
const signInLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    emailAddress: { type: String, required: true, trim: true, lowercase: true },
    ipAddress: { type: String, required: true },
    userAgent: { type: String, default: null },
    signInMethod: {
      type: String,
      required: true,
      enum: Object.values(SIGN_IN_METHODS),
      default: SIGN_IN_METHODS.EMAIL_OTP,
    },
    signedInAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

signInLogSchema.index({ userId: 1, signedInAt: -1 }, { name: "index_signInLogs_userId_signedInAt" });
signInLogSchema.index({ signedInAt: -1 }, { name: "index_signInLogs_signedInAt" });

signInLogSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const SignInLogModel = mongoose.model("SignInLog", signInLogSchema, "signInLogs");

module.exports = { SignInLogModel };
