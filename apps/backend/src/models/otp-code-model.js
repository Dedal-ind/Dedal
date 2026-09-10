const mongoose = require("mongoose");
const { AUTHENTICATION_CONSTANTS } = require("../constants/authentication-constants");
const { UNKNOWN_IP_ADDRESS } = require("../constants/sign-in-constants");

const otpCodeSchema = new mongoose.Schema(
  {
    emailAddress: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // bcrypt digest of the 6-digit code. The plaintext is never persisted.
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    attemptCount: { type: Number, default: 0 },
    // The sending IP, so an aggregate over recent rows is the per-IP send count.
    ipAddress: { type: String, trim: true, default: UNKNOWN_IP_ADDRESS },
  },
  { timestamps: true }
);

// Serves the rate-limit lookup (newest row for an address) and verification.
otpCodeSchema.index(
  { emailAddress: 1, createdAt: -1 },
  { name: "index_otpCodes_emailAddress_createdAt" }
);

// Serves the per-IP send-rate aggregate (recent rows for one IP).
otpCodeSchema.index(
  { ipAddress: 1, createdAt: -1 },
  { name: "index_otpCodes_ipAddress_createdAt" }
);

/*
 * Mongo removes the document OTP_RETENTION_SECONDS after expiresAt, not at
 * expiresAt. The code stops verifying long before the row disappears.
 */
otpCodeSchema.index(
  { expiresAt: 1 },
  {
    name: "index_otpCodes_expiresAt",
    expireAfterSeconds: AUTHENTICATION_CONSTANTS.OTP_RETENTION_SECONDS,
  }
);

const OtpCodeModel = mongoose.model("OtpCode", otpCodeSchema, "otpCodes");

module.exports = { OtpCodeModel };
