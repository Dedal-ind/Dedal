const SIGN_IN_METHODS = {
  EMAIL_OTP: "emailOtp",
  GOOGLE: "google",
};

// A user-agent string is stored as-is but capped, so a hostile client cannot bloat the log.
const USER_AGENT_MAX_LENGTH = 500;

// Written when a caller arrives with no request context, so an IP-grouped read
// still has a bucket to fall into. Rate limiting deliberately skips this bucket.
const UNKNOWN_IP_ADDRESS = "unknown";

module.exports = { SIGN_IN_METHODS, USER_AGENT_MAX_LENGTH, UNKNOWN_IP_ADDRESS };
