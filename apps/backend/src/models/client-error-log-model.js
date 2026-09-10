const mongoose = require("mongoose");

/*
 * Crash reports from the browser.
 *
 * This is a LOG, not an incident system. There is no assignee, no status, no
 * deduplication key — the question it answers is "is the scanner falling over
 * on someone's phone right now", and a coordinator finding that out from the
 * hygiene panel before a volunteer phones them is the whole return.
 *
 * IT EXPIRES ITSELF. A crash loop can write faster than anyone reads, and an
 * unbounded collection of stack traces is a slow-motion disk problem plus a pile
 * of URLs and user agents nobody consented to keep. The TTL index deletes rows
 * 30 days after they arrive, so retention needs no cron and no admin discipline.
 *
 * NOTHING HERE IS TRUSTED. Every field is attacker-controlled — the endpoint is
 * unauthenticated by necessity, because an error can happen before sign-in. So
 * the fields are capped at write time and the admin surface escapes them.
 */

const MESSAGE_MAXIMUM_LENGTH = 500;
const STACK_MAXIMUM_LENGTH = 4000;
const URL_MAXIMUM_LENGTH = 500;
const USER_AGENT_MAXIMUM_LENGTH = 300;

const RETENTION_SECONDS = 30 * 24 * 60 * 60;

const clientErrorLogSchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true, maxlength: MESSAGE_MAXIMUM_LENGTH },
    stack: { type: String, trim: true, maxlength: STACK_MAXIMUM_LENGTH, default: null },
    url: { type: String, trim: true, maxlength: URL_MAXIMUM_LENGTH, default: null },
    userAgent: { type: String, trim: true, maxlength: USER_AGENT_MAXIMUM_LENGTH, default: null },

    // The client's own clock, which may be wrong or absent; `createdAt` is the
    // one the server trusts and the one the TTL and the hygiene window use.
    reportedAt: { type: Date, default: null },

    /*
     * Set only when the request happened to carry a valid token. Never required:
     * the most valuable reports are the ones from a session that broke before
     * anyone signed in.
     */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/* Self-cleaning: rows vanish 30 days after they were written. */
clientErrorLogSchema.index(
  { createdAt: 1 },
  { name: "index_clientErrorLogs_createdAt_ttl", expireAfterSeconds: RETENTION_SECONDS }
);

clientErrorLogSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const ClientErrorLogModel = mongoose.model(
  "ClientErrorLog",
  clientErrorLogSchema,
  "clientErrorLogs"
);

module.exports = {
  ClientErrorLogModel,
  MESSAGE_MAXIMUM_LENGTH,
  STACK_MAXIMUM_LENGTH,
  URL_MAXIMUM_LENGTH,
  USER_AGENT_MAXIMUM_LENGTH,
  RETENTION_SECONDS,
};
