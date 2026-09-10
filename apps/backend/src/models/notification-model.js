const mongoose = require("mongoose");

/*
 * What a notification is ABOUT. Drives the icon and accent colour in the feed,
 * and lets the client group or filter without parsing the title.
 */
const NOTIFICATION_TYPES = {
  BROADCAST: "broadcast",
  ROUND_STARTED: "roundStarted",
  ROUND_ADVANCED: "roundAdvanced",
  ROUND_ELIMINATED: "roundEliminated",
  CERTIFICATE_READY: "certificateReady",
  RESULTS_PUBLISHED: "resultsPublished",
  /*
   * An event was withdrawn from the listings (soft delete). Its own type rather
   * than BROADCAST because it is not a message an organiser wrote — the feed can
   * style it as a system notice, and a later "what happened to events I signed up
   * for" read can find these rows without parsing titles.
   */
  EVENT_REMOVED: "eventRemoved",
};

/*
 * One row per RECIPIENT, not per event.
 *
 * A broadcast to 200 people writes 200 rows. That is deliberate: read state,
 * deletion and the unread badge are all per-person, and a shared row with a
 * `readBy` array would grow unbounded and make "my unread count" an expensive
 * scan instead of a cheap indexed count.
 *
 * Rows are written by insertMany in one call, so the cost is one round trip
 * regardless of audience size.
 */
const notificationSchema = new mongoose.Schema(
  {
    /* Who sees this. Every query is scoped to it — a user can only ever read
     * their own rows, enforced by taking this from the token, never the URL. */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    notificationType: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 2000, default: null },

    /*
     * Where tapping the row should go — an in-app path, never an external URL.
     * Null means the notification is informational with nowhere to open.
     */
    linkPath: { type: String, trim: true, default: null },

    /* Context for grouping and for cleaning up if an event is deleted. */
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", default: null },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },

    /*
     * Who caused it. Kept for auditing a broadcast back to the coordinator who
     * sent it; null for anything the system raised on its own.
     */
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/*
 * The feed query: one user's rows, newest first. Compound rather than two
 * single-field indexes so the sort is served by the index instead of an
 * in-memory sort once someone accumulates a few hundred rows.
 */
notificationSchema.index(
  { userId: 1, createdAt: -1 },
  { name: "index_notifications_userId_createdAt" }
);

/*
 * The unread badge. Partial so the index only holds unread rows — read
 * notifications are the overwhelming majority over time and would otherwise
 * bloat an index that only ever answers "how many are unread".
 */
notificationSchema.index(
  { userId: 1, readAt: 1 },
  {
    name: "index_notifications_userId_unread",
    partialFilterExpression: { readAt: null },
  }
);

const NotificationModel = mongoose.model("Notification", notificationSchema);

module.exports = { NotificationModel, NOTIFICATION_TYPES };
