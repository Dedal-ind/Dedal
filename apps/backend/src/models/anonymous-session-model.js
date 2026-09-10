const mongoose = require("mongoose");

/*
 * AN ANONYMOUS SESSION KEY: the subject the frequency cap ledger is keyed to
 * for a participant who is under eighteen or whose age is unknown.
 *
 * WHY IT EXISTS. For such a participant we are permitted to limit how often
 * we show them the same thing — a frequency cap is a protection, not a
 * profile — and we are NOT permitted to build anything that recognises the
 * person across sessions. So the cap needs a subject that is stable for the
 * length of a browsing session and worthless after it.
 *
 * WHY IT MUST NOT OUTLIVE A SESSION. A key that persisted would, by its
 * stability alone, become a durable identifier of a child: not a name, but a
 * handle that links today's exposure to next week's. India's DPDP Act, 2023
 * prohibits tracking and behavioural monitoring of children with no consent
 * workaround. The row therefore carries a FIXED expiry from the moment it is
 * minted — not a sliding one, which would let continued use renew it forever
 * — and a TTL index removes it when that passes. After expiry a presented
 * key is simply unknown and a fresh one is minted.
 *
 * WHAT IT CONTAINS. Random bytes and an expiry. No user id, no hash of one,
 * nothing derived from the request. Two participants, or one participant
 * twice, get keys that share nothing.
 */
const anonymousSessionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

anonymousSessionSchema.index({ key: 1 }, { name: "index_anonymousSessions_key", unique: true });
anonymousSessionSchema.index(
  { expiresAt: 1 },
  { name: "index_anonymousSessions_expiresAt_ttl", expireAfterSeconds: 0 }
);

const AnonymousSessionModel = mongoose.model(
  "AnonymousSession",
  anonymousSessionSchema,
  "anonymousSessions"
);

module.exports = { AnonymousSessionModel };
