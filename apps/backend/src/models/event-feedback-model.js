const mongoose = require("mongoose");

/*
 * One participant's rating of one event they actually attended.
 *
 * WHY THE UNIQUE INDEX IS THE WHOLE DESIGN. Feedback is one-shot: a participant
 * rates an event once and cannot revise it. That is not laziness about an edit
 * screen — a rating that can be changed after the coordinator has seen it turns
 * the summary into a moving target, and the honest first reaction is the one
 * worth having. The unique { eventId, userId } index is what enforces it, so a
 * duplicate is refused by the database even if two requests race past the
 * service's own check.
 *
 * festId is DENORMALISED from the event. Feedback is read per event (the
 * coordinator panel) but exported per fest (data controls), and carrying the
 * fest here means the export is one query instead of a join through events.
 *
 * There is deliberately no `status`, no moderation queue and no reply. A
 * coordinator reads what participants wrote; they do not get to curate it.
 */
const eventFeedbackSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // 1–5 whole stars. No half stars, no emoji: a scale a participant can answer
    // in one tap is a scale they actually answer.
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },

    comment: { type: String, trim: true, maxlength: 500, default: null },
    submittedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

/* One feedback per participant per event — enforced by the database, not by hope. */
eventFeedbackSchema.index(
  { eventId: 1, userId: 1 },
  { name: "index_eventFeedbacks_eventId_userId", unique: true }
);

/* The export reads a whole fest's feedback in submission order. */
eventFeedbackSchema.index(
  { festId: 1, submittedAt: -1 },
  { name: "index_eventFeedbacks_festId_submittedAt" }
);

eventFeedbackSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const EventFeedbackModel = mongoose.model(
  "EventFeedback",
  eventFeedbackSchema,
  "eventFeedbacks"
);

module.exports = { EventFeedbackModel };
