const AUTHENTICATION_CONSTANTS = {
  OTP_CODE_LENGTH: 6,
  OTP_EXPIRY_MINUTES: 15,

  /*
   * The row outlives the code by a wide margin. The code stops verifying after
   * OTP_EXPIRY_MINUTES, but the document survives so the rate-limit lookup and
   * any audit still see it. Mongo's TTL monitor removes it this many seconds
   * after expiresAt.
   */
  OTP_RETENTION_SECONDS: 86400,

  OTP_RESEND_COOLDOWN_SECONDS: 60,
  OTP_MAXIMUM_VERIFY_ATTEMPTS: 5,

  /*
   * The per-code cap above is reset by requesting a new code. These bound the
   * guesses an address may spend across every code it holds in the window, so
   * request-then-guess-five in a loop no longer buys unlimited attempts.
   */
  OTP_ROLLING_ATTEMPT_WINDOW_MINUTES: 60,
  OTP_ROLLING_MAXIMUM_ATTEMPTS: 10,

  /*
   * Per-IP send throttle. The per-address controls never see one IP spraying
   * codes at many distinct addresses, so an IP-side limit is needed too.
   *
   * The ceilings are sized for SHARED NAT, not for one person per IP. A college
   * campus puts hundreds of students behind a single public address, so the
   * industry default (a mid-teens hourly cap) would lock out an entire venue
   * partway through a fest. These are deliberately generous: the per-address
   * limits below are what actually protect a given person's inbox, and this
   * bucket exists only to bound a wide spray.
   */
  OTP_IP_ROLLING_WINDOW_MINUTES: 60,
  OTP_IP_ROLLING_MAXIMUM_SENDS: 50,
  OTP_IP_BURST_WINDOW_SECONDS: 60,
  OTP_IP_BURST_MAXIMUM_SENDS: 10,

  /*
   * Per-address send ceiling. The 60-second cooldown below only spaces requests
   * out; across an hour it still permits sixty codes to one inbox. This bounds
   * the total. Keyed on the address alone, so it is unaffected by how many
   * people share the requester's IP — the NAT-safe half of the send controls.
   */
  OTP_ADDRESS_ROLLING_SEND_WINDOW_MINUTES: 60,
  OTP_ADDRESS_ROLLING_MAXIMUM_SENDS: 10,

  OTP_HASH_SALT_ROUNDS: 10,

  /*
   * Accepted in place of the real code when the environment is development.
   * There is no env var to enable it: the environment is the only gate, so a
   * misconfigured flag cannot switch it on in production.
   */
  DEVELOPMENT_MASTER_OTP_CODE: "000000",
};

module.exports = { AUTHENTICATION_CONSTANTS };
