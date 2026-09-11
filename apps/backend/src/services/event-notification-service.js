const mongoose = require("mongoose");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { UserModel } = require("../models/user-model");
const { FestModel } = require("../models/fest-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { recordAuditLog } = require("./audit-log-service");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");

/*
 * Coordinator → every confirmed registrant of one event. "Venue moved to Room
 * 204" is the whole use case, and without it a coordinator's only options are a
 * WhatsApp group nobody joined or nothing.
 *
 * THE RATE LIMIT IS THE FEATURE. This endpoint points a few hundred emails at
 * real inboxes on one authenticated request, so it is capped at three per event
 * per calendar day. Not a warning, not a soft nudge — a 409 that refuses the
 * send. An unbounded version of this is a spam cannon with our sending domain
 * on it, and the domain's reputation is shared by every OTP the platform sends.
 *
 * THE RESET IS LAZY, BY DESIGN. There is no midnight job. The count carries the
 * day it belongs to (lastBulkEmailSentAt), and a stamp from an earlier calendar
 * day is read as a tally of zero. A scheduled reset would be a second thing to
 * keep alive, and a server asleep at midnight would silently keep yesterday's
 * tally — locking a coordinator out on the morning of the fest.
 */

const MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY = 3;
const SUBJECT_MAXIMUM_LENGTH = 120;
const MESSAGE_MAXIMUM_LENGTH = 2000;

function isSameCalendarDay(firstDate, secondDate) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

/*
 * How many sends this event has already made TODAY. A stamp from any earlier
 * day means today's tally is zero, whatever the stored count says — this is
 * where the reset actually happens.
 */
function countSendsUsedToday(event, now) {
  if (!event.lastBulkEmailSentAt) {
    return 0;
  }
  return isSameCalendarDay(new Date(event.lastBulkEmailSentAt), now)
    ? event.dailyBulkEmailCount ?? 0
    : 0;
}

/*
 * WHICH CHANNELS THIS SEND USES.
 *
 * Two, and they answer different failure modes rather than duplicating each
 * other: the in-app row is still there when the participant next opens the app
 * even if the mail bounced or landed in spam, and the email reaches someone who
 * is not going to open the app again before the day of the event. An organiser
 * announcing a venue change needs both to have a chance of landing.
 *
 * Absent or empty defaults to BOTH. That default is the safe direction: the cost
 * of a redundant in-app row is nothing, and the cost of a silently
 * single-channel announcement is a queue of people at the wrong building.
 */
const NOTIFICATION_CHANNELS = { EMAIL: "email", INBOX: "inbox" };

function resolveChannels(rawChannels) {
  if (!Array.isArray(rawChannels) || rawChannels.length === 0) {
    return [NOTIFICATION_CHANNELS.EMAIL, NOTIFICATION_CHANNELS.INBOX];
  }
  const allowed = rawChannels.filter((channel) =>
    Object.values(NOTIFICATION_CHANNELS).includes(channel)
  );
  if (allowed.length === 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Choose at least one delivery channel.",
      { channels: `must include one of: ${Object.values(NOTIFICATION_CHANNELS).join(", ")}` }
    );
  }
  return [...new Set(allowed)];
}

function validateMessagePayload(payload) {
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const details = {};
  if (!subject) {
    details.subject = "is required";
  } else if (subject.length > SUBJECT_MAXIMUM_LENGTH) {
    details.subject = `must be at most ${SUBJECT_MAXIMUM_LENGTH} characters`;
  }
  if (!message) {
    details.message = "is required";
  } else if (message.length > MESSAGE_MAXIMUM_LENGTH) {
    details.message = `must be at most ${MESSAGE_MAXIMUM_LENGTH} characters`;
  }
  if (Object.keys(details).length > 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Check the message.", details);
  }
  return { subject, message };
}

/*
 * Confirmed registrants only. A pending-payment seat is not theirs yet and a
 * cancelled one is no longer theirs; contingent-materialised registrations are
 * included automatically because they are ordinary CONFIRMED rows.
 */
async function loadConfirmedRecipients(eventId) {
  const registrations = await RegistrationModel.find({
    eventId,
    status: REGISTRATION_STATUSES.CONFIRMED,
  })
    .select("userId")
    .lean();

  const userIds = [...new Set(registrations.map((registration) => String(registration.userId)))];
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("fullName emailAddress")
    .lean();
  /*
   * No email filter here any more. Broadcast now delivers in-app AS WELL AS by
   * mail, and a participant with no mailbox still has a feed — dropping them at
   * resolve time silently excluded them from both channels. The email pass
   * below skips empty addresses itself.
   */
  return users;
}

/*
 * What the modal needs before anyone types anything: how many people this will
 * reach, and how much of today's budget is left.
 */
async function getNotificationPreview(eventId, now = new Date()) {
  const event = await EventModel.findById(eventId).select(
    "eventName lastBulkEmailSentAt dailyBulkEmailCount"
  );
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const sendsUsedToday = countSendsUsedToday(event, now);
  const recipients = await loadConfirmedRecipients(event._id);
  return {
    eventName: event.eventName,
    recipientCount: recipients.length,
    sendsUsedToday,
    sendsRemainingToday: Math.max(0, MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY - sendsUsedToday),
    dailyLimit: MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY,
  };
}

async function notifyEventParticipants(actorUserId, eventId, payload, context = {}, now = new Date()) {
  const { subject, message } = validateMessagePayload(payload ?? {});

  const event = await EventModel.findById(eventId);
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }

  const channels = resolveChannels(payload?.channels);
  const sendsEmail = channels.includes(NOTIFICATION_CHANNELS.EMAIL);
  const sendsInbox = channels.includes(NOTIFICATION_CHANNELS.INBOX);

  /*
   * The daily budget is an EMAIL budget and is only spent when email is actually
   * being sent. An in-app-only notice costs nothing to deliver and must not
   * consume one of the day's mail sends — otherwise an organiser posting three
   * in-app updates would find themselves unable to email anyone about the venue
   * change that matters.
   */
  const sendsUsedToday = countSendsUsedToday(event, now);
  if (sendsEmail && sendsUsedToday >= MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY) {
    throw new ApplicationError(
      429,
      ERROR_CODES.BULK_EMAIL_LIMIT_REACHED,
      `This event has already sent ${MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY} bulk emails today. Try again tomorrow.`,
      { sendsUsedToday, dailyLimit: MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY }
    );
  }

  const recipients = await loadConfirmedRecipients(event._id);

  /*
   * The budget is spent BEFORE the sends, not after. A send that crashes
   * halfway has still put mail in inboxes, and a tally that only increments on
   * a clean finish would let a retry loop mail everyone repeatedly.
   */
  if (sendsEmail) {
    event.dailyBulkEmailCount = sendsUsedToday + 1;
    event.lastBulkEmailSentAt = now;
    await event.save();
  }

  const fest = await FestModel.findById(event.festId).select("festName bannerImageUrl").lean();

  // Late require, same reason as everywhere else: a test's email mock is
  // installed after this module first enters the require graph.
  const { sendEventParticipantNotificationEmail } = require("./email-service");

  /*
   * IN-APP FIRST, because it is the one that cannot half-succeed: one insertMany
   * against the recipient list, versus a loop of network calls to a mail
   * provider. Doing it first means a crash partway through the mail loop still
   * leaves everybody with the notice in their feed.
   */
  let inboxNotifiedCount = 0;
  if (sendsInbox && recipients.length > 0) {
    try {
      const notificationService = require("./notification-service");
      const { NOTIFICATION_TYPES } = require("../models/notification-model");
      inboxNotifiedCount = await notificationService.notifyUsers({
        userIds: recipients.map((recipient) => recipient.userId ?? recipient._id),
        notificationType: NOTIFICATION_TYPES.BROADCAST,
        title: subject,
        body: message,
        festId: event.festId,
        eventId: event._id,
        actorUserId,
      });
    } catch (inboxError) {
      // Never fatal: a feed write failing must not stop the email going out.
      console.error(`In-app notice failed for event ${event._id}: ${inboxError.message}`);
    }
  }

  let sentCount = 0;
  let failedCount = 0;
  for (const recipient of sendsEmail ? recipients : []) {
    /*
     * Fire-and-forget PER RECIPIENT. One dead address must not stop the other
     * two hundred people learning the venue moved, so a failure is counted and
     * logged rather than thrown.
     */
    try {
      const wasSent = await sendEventParticipantNotificationEmail({
        emailAddress: recipient.emailAddress,
        fullName: recipient.fullName,
        subject,
        message,
        eventName: event.eventName,
        festName: fest?.festName ?? "",
        festBannerImageUrl: fest?.bannerImageUrl ?? null,
      });
      if (wasSent) {
        sentCount += 1;
      } else {
        failedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      console.error(
        `Bulk email to ${recipient.emailAddress} for event ${event._id} failed: ${error.message}`
      );
    }
  }

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.BULK_EMAIL_SENT,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    // The subject is recorded, the body is not: the audit log answers "who
    // mailed whom, about what" without becoming a copy of every message sent.
    afterState: {
      eventId: String(event._id),
      subject,
      recipientCount: recipients.length,
      channels,
      sentCount,
      failedCount,
      inboxNotifiedCount,
    },
    ...context,
  });

  return {
    recipientCount: recipients.length,
    channels,
    sentCount,
    failedCount,
    inboxNotifiedCount,
    sendsUsedToday: event.dailyBulkEmailCount,
    sendsRemainingToday: MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY - event.dailyBulkEmailCount,
    dailyLimit: MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY,
  };
}

/* ---------------------------------------------------------------------------
 * Admin broadcast — one message to a chosen audience of an event.
 *
 * Separate from notifyEventParticipants on purpose: that endpoint is the
 * coordinator surface with its own daily budget, and this one is admin-only.
 * NOTE: the per-event daily rate limit above is NOT applied here — its tally
 * lives on the event document and is spent by the coordinator flow; sharing it
 * would let an admin broadcast silently exhaust the coordinator's budget (and
 * vice versa). Deliberately skipped rather than half-shared.
 * ------------------------------------------------------------------------- */

const BROADCAST_RECIPIENT_TYPES = ["participants", "coordinators", "volunteers", "all"];

/*
 * Staff of one role whose assignment covers this event: active rows for the
 * fest whose eventIds are empty (fest-wide) or include the event.
 */
async function loadStaffRecipients(festId, eventId, role) {
  const assignments = await StaffAssignmentModel.find({
    festId,
    role,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    $or: [{ eventIds: { $size: 0 } }, { eventIds: eventId }],
  })
    .select("userId")
    .lean();

  const userIds = [...new Set(assignments.map((assignment) => String(assignment.userId)))];
  if (userIds.length === 0) {
    return [];
  }
  const users = await UserModel.find({ _id: { $in: userIds } })
    .select("fullName emailAddress")
    .lean();
  return users.filter((user) => Boolean(user.emailAddress));
}

async function resolveBroadcastRecipients(festId, eventId, recipientType) {
  if (recipientType === "participants") {
    return loadConfirmedRecipients(eventId);
  }
  if (recipientType === "coordinators") {
    return loadStaffRecipients(festId, eventId, STAFF_ROLES.COORDINATOR);
  }
  if (recipientType === "volunteers") {
    return loadStaffRecipients(festId, eventId, STAFF_ROLES.VOLUNTEER);
  }
  // "all": union of the three, deduplicated by email address.
  const groups = await Promise.all([
    loadConfirmedRecipients(eventId),
    loadStaffRecipients(festId, eventId, STAFF_ROLES.COORDINATOR),
    loadStaffRecipients(festId, eventId, STAFF_ROLES.VOLUNTEER),
  ]);
  const byEmail = new Map();
  for (const recipient of groups.flat()) {
    if (!byEmail.has(recipient.emailAddress)) {
      byEmail.set(recipient.emailAddress, recipient);
    }
  }
  return [...byEmail.values()];
}

async function broadcastEventMessage(actorUserId, festId, eventId, payload, context = {}) {
  const recipientType =
    typeof payload?.recipientType === "string" ? payload.recipientType.trim() : "";
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";

  const details = {};
  if (!BROADCAST_RECIPIENT_TYPES.includes(recipientType)) {
    details.recipientType = `must be one of: ${BROADCAST_RECIPIENT_TYPES.join(", ")}`;
  }
  if (!message) {
    details.message = "is required";
  } else if (message.length > MESSAGE_MAXIMUM_LENGTH) {
    details.message = `must be at most ${MESSAGE_MAXIMUM_LENGTH} characters`;
  }
  if (Object.keys(details).length > 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Check the broadcast.", details);
  }

  const event = await EventModel.findById(eventId).select("eventName festId").lean();
  if (!event || String(event.festId) !== String(festId)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }

  const fest = await FestModel.findById(festId).select("festName bannerImageUrl").lean();
  const recipients = await resolveBroadcastRecipients(festId, eventId, recipientType);

  const title = `${event.eventName}${fest?.festName ? ` — ${fest.festName}` : ""}`;

  /*
   * Email stays as a BEST-EFFORT supplementary channel — only to recipients who
   * have an address, and never blocking or failing the broadcast on a transport
   * hiccup. The guaranteed channel is the in-app feed below, sent unconditionally
   * to every resolved recipient regardless of how this email pass goes.
   */
  // Late require, same reason as notifyEventParticipants: a test's email mock
  // is installed after this module first enters the require graph.
  const { sendEventParticipantNotificationEmail } = require("./email-service");

  const mailableRecipients = recipients.filter((recipient) => Boolean(recipient.emailAddress));
  const outcomes = await Promise.allSettled(
    mailableRecipients.map((recipient) =>
      sendEventParticipantNotificationEmail({
        emailAddress: recipient.emailAddress,
        fullName: recipient.fullName,
        subject: title,
        message,
        eventName: event.eventName,
        festName: fest?.festName ?? "",
        festBannerImageUrl: fest?.bannerImageUrl ?? null,
      })
    )
  );

  let sent = 0;
  let failed = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled" && outcome.value) {
      sent += 1;
    } else {
      failed += 1;
      const reason = outcome.status === "rejected" ? outcome.reason?.message : "transport refused";
      console.error(
        `Broadcast email to ${mailableRecipients[index].emailAddress} for event ${eventId} failed: ${reason}`
      );
    }
  });

  /*
   * In-app delivery, unconditionally, to EVERYONE resolved. Email is best-effort
   * (a transport hiccup or a missing address must not silence the announcement);
   * the feed row is the guaranteed channel. This is also why "broadcast not
   * arriving" reports happen: previously this path was mail-ONLY, so anyone who
   * missed the email — spam folder, no address — received nothing at all.
   */
  const { notifyUsers, NOTIFICATION_TYPES } = require("./notification-service");
  const inAppDelivered = await notifyUsers({
    userIds: [...new Set(recipients.map((recipient) => String(recipient._id)))],
    notificationType: NOTIFICATION_TYPES.BROADCAST,
    title: `${event.eventName}: announcement`,
    body: message,
    linkPath: null,
    festId: String(festId),
    eventId: String(eventId),
    actorUserId,
  });

  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTIONS.BULK_EMAIL_SENT,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: eventId,
    afterState: {
      eventId: String(eventId),
      recipientType,
      deliveryChannel: "in-app",
      recipientCount: recipients.length,
      sentCount: sent,
      failedCount: failed,
    },
    ...context,
  });

  return { sent, failed, recipientCount: recipients.length, inAppDelivered };
}

/* ---------------------------------------------------------------------------
 * FEST-WIDE BROADCAST
 *
 * WHY THIS EXISTS RATHER THAN "SELECT EVERY EVENT". The per-event broadcast
 * above is the right tool for "Battle of Bands moved to Room 204". It is the
 * wrong tool for "gates open at 9am" - an announcement that is about the fest,
 * not about any event in it. Sending that one meant an admin walking the event
 * list and firing the same message once per event, which is not merely tedious:
 *
 *   - A participant registered for four events received the SAME announcement
 *     four times, each one titled after a different event. That is how a
 *     platform teaches people to ignore its notifications.
 *   - Every send is a separate audit row, so "did the 9am notice go out" could
 *     not be answered without reconstructing the set by hand.
 *   - Miss one event and part of the fest never hears it, with nothing in the
 *     system that could tell you which part.
 *
 * So the audience is resolved ONCE, across the whole fest, and deduplicated by
 * user before anything is sent. Dedup is the entire reason the fest-wide path
 * cannot be implemented as a loop over the event-wide one.
 *
 * The title is the FEST's name, not an event's, because that is what the
 * message is from. Titling a fest announcement after whichever event happened
 * to be selected is part of the bug this replaces.
 * ------------------------------------------------------------------------- */

/* Every confirmed registrant of any event in the fest, each user once. */
async function loadFestConfirmedRecipients(eventIds) {
  if (eventIds.length === 0) {
    return [];
  }
  const registrations = await RegistrationModel.find({
    eventId: { $in: eventIds },
    status: REGISTRATION_STATUSES.CONFIRMED,
  })
    .select("userId")
    .lean();

  const userIds = [...new Set(registrations.map((registration) => String(registration.userId)))];
  if (userIds.length === 0) {
    return [];
  }
  /* Same policy as the per-event loader: no email filter at resolve time, so a
     participant without a mailbox still gets the in-app row. */
  return UserModel.find({ _id: { $in: userIds } })
    .select("fullName emailAddress")
    .lean();
}

/*
 * Staff of one role anywhere in the fest. No eventIds clause at all - unlike
 * the per-event loader, which narrows to assignments covering one event. A
 * fest-wide announcement goes to every coordinator of the fest, including ones
 * scoped to events the sender never thinks about.
 */
async function loadFestStaffRecipients(festId, role) {
  const assignments = await StaffAssignmentModel.find({
    festId,
    role,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("userId")
    .lean();

  const userIds = [...new Set(assignments.map((assignment) => String(assignment.userId)))];
  if (userIds.length === 0) {
    return [];
  }
  return UserModel.find({ _id: { $in: userIds } })
    .select("fullName emailAddress")
    .lean();
}

async function resolveFestBroadcastRecipients(festId, eventIds, recipientType) {
  const groups = [];
  if (recipientType === "participants" || recipientType === "all") {
    groups.push(await loadFestConfirmedRecipients(eventIds));
  }
  if (recipientType === "coordinators" || recipientType === "all") {
    groups.push(await loadFestStaffRecipients(festId, STAFF_ROLES.COORDINATOR));
  }
  if (recipientType === "volunteers" || recipientType === "all") {
    groups.push(await loadFestStaffRecipients(festId, STAFF_ROLES.VOLUNTEER));
  }

  /*
   * Deduplicated by USER ID, not by email address.
   *
   * The per-event "all" branch dedups on email, which is safe there because it
   * unions three small sets of staff and registrants. Here the participant set
   * alone can contain the same person reached through several events, and a
   * user with no email address would collapse every such user into a single
   * entry under the key undefined - silently dropping most of the fest. The id
   * is always present.
   */
  const byUserId = new Map();
  for (const recipient of groups.flat()) {
    const key = String(recipient._id);
    if (!byUserId.has(key)) {
      byUserId.set(key, recipient);
    }
  }
  return [...byUserId.values()];
}

async function broadcastFestMessage(actorUserId, festId, payload, context = {}) {
  const recipientType =
    typeof payload?.recipientType === "string" ? payload.recipientType.trim() : "";
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";

  const details = {};
  if (!BROADCAST_RECIPIENT_TYPES.includes(recipientType)) {
    details.recipientType = `must be one of: ${BROADCAST_RECIPIENT_TYPES.join(", ")}`;
  }
  if (!message) {
    details.message = "is required";
  } else if (message.length > MESSAGE_MAXIMUM_LENGTH) {
    details.message = `must be at most ${MESSAGE_MAXIMUM_LENGTH} characters`;
  }
  if (Object.keys(details).length > 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Check the broadcast.", details);
  }

  const fest = await FestModel.findById(festId).select("festName bannerImageUrl").lean();
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }

  /*
   * EVERY event, not just the registerable leaves. A container event carries no
   * registrations of its own, so including it costs one id inside an $in and
   * excluding it risks dropping a vertical that turns out to be registerable.
   */
  const events = await EventModel.find({ festId }).select("_id").lean();
  const eventIds = events.map((event) => event._id);

  const recipients = await resolveFestBroadcastRecipients(festId, eventIds, recipientType);

  /* Email is best-effort and the in-app feed is guaranteed - the same split the
     per-event broadcast documents, for the same reasons. */
  const { sendEventParticipantNotificationEmail } = require("./email-service");

  const mailableRecipients = recipients.filter((recipient) => Boolean(recipient.emailAddress));
  const outcomes = await Promise.allSettled(
    mailableRecipients.map((recipient) =>
      sendEventParticipantNotificationEmail({
        emailAddress: recipient.emailAddress,
        fullName: recipient.fullName,
        subject: fest.festName,
        message,
        eventName: fest.festName,
        festName: fest.festName,
        festBannerImageUrl: fest.bannerImageUrl ?? null,
      })
    )
  );

  let sent = 0;
  let failed = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled" && outcome.value) {
      sent += 1;
    } else {
      failed += 1;
      const reason = outcome.status === "rejected" ? outcome.reason?.message : "transport refused";
      console.error(
        `Fest broadcast email to ${mailableRecipients[index].emailAddress} for fest ${festId} failed: ${reason}`
      );
    }
  });

  const { notifyUsers, NOTIFICATION_TYPES } = require("./notification-service");
  const inAppDelivered = await notifyUsers({
    userIds: recipients.map((recipient) => String(recipient._id)),
    notificationType: NOTIFICATION_TYPES.BROADCAST,
    title: `${fest.festName}: announcement`,
    body: message,
    linkPath: null,
    festId: String(festId),
    /* No eventId: this notification is not about an event, and stamping one on
       would deep-link the reader into whichever event happened to be first. */
    eventId: null,
    actorUserId,
  });

  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTIONS.BULK_EMAIL_SENT,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: festId,
    afterState: {
      scope: "fest",
      recipientType,
      deliveryChannel: "in-app",
      eventCount: eventIds.length,
      recipientCount: recipients.length,
      sentCount: sent,
      failedCount: failed,
    },
    ...context,
  });

  return { sent, failed, recipientCount: recipients.length, inAppDelivered };
}

/*
 * The COORDINATOR's broadcast: in-app only, directory-scoped.
 *
 * Deliberately separate from broadcastEventMessage above (admin-only, resolves
 * a named audience type — participants/coordinators/volunteers/all — for the
 * whole fest). Two differences drove that split:
 *
 *  · Audience is resolved WITHOUT filtering on emailAddress — this was true
 *    even when broadcastEventMessage emailed, since a participant with no
 *    email still has a feed here.
 *  · Scope is one event and its own people (plus optional explicit recipient
 *    ids from the coordinator's directory), so a coordinator cannot reach the
 *    whole fest the way the admin action can.
 */
async function broadcastInAppMessage(actorUserId, festId, eventId, payload, context = {}) {
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  const audiences = Array.isArray(payload?.audiences) ? payload.audiences : [];
  /*
   * Directory mode: the coordinator tapped one card, so the recipients arrive
   * as explicit ids instead of an audience name. Either shape is valid; both
   * empty is not.
   */
  const explicitIds = Array.isArray(payload?.recipientUserIds)
    ? payload.recipientUserIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
    : [];

  const details = {};
  if (!message) {
    details.message = "is required";
  }
  const allowed = audiences.filter((a) => a === "participants" || a === "volunteers");
  if (allowed.length === 0 && explicitIds.length === 0) {
    details.audiences = "must include participants, volunteers, or explicit recipientUserIds";
  }
  if (Object.keys(details).length > 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid broadcast.", details);
  }

  const event = await EventModel.findById(eventId).select("_id eventName festId").lean();
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }

  const recipientIds = new Set();

  /*
   * Explicit ids are trusted only after checking they belong to this event —
   * either registered on it, or a volunteer of its fest. Without the check a
   * coordinator could message any user id they could guess.
   */
  if (explicitIds.length > 0) {
    const [registered, staffed] = await Promise.all([
      RegistrationModel.find({
        eventId: event._id,
        userId: { $in: explicitIds },
        status: REGISTRATION_STATUSES.CONFIRMED,
      })
        .select("userId")
        .lean(),
      StaffAssignmentModel.find({
        festId: event.festId,
        userId: { $in: explicitIds },
        status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
      })
        .select("userId")
        .lean(),
    ]);
    registered.forEach((r) => recipientIds.add(String(r.userId)));
    staffed.forEach((a) => recipientIds.add(String(a.userId)));
  }

  if (allowed.includes("participants")) {
    const registrations = await RegistrationModel.find({
      eventId: event._id,
      status: REGISTRATION_STATUSES.CONFIRMED,
    })
      .select("userId")
      .lean();
    registrations.forEach((r) => recipientIds.add(String(r.userId)));
  }

  if (allowed.includes("volunteers")) {
    const assignments = await StaffAssignmentModel.find({
      festId: event.festId,
      role: STAFF_ROLES.VOLUNTEER,
      status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    })
      .select("userId eventIds")
      .lean();
    assignments
      /* Empty eventIds means fest-wide, which covers this event too. */
      .filter(
        (a) =>
          (a.eventIds ?? []).length === 0 ||
          (a.eventIds ?? []).some((id) => String(id) === String(event._id))
      )
      .forEach((a) => recipientIds.add(String(a.userId)));
  }

  /* The sender does not need to be told what they just said. */
  recipientIds.delete(String(actorUserId));

  const { notifyUsers, NOTIFICATION_TYPES } = require("./notification-service");
  const notifiedCount = await notifyUsers({
    userIds: [...recipientIds],
    notificationType: NOTIFICATION_TYPES.BROADCAST,
    title: event.eventName,
    body: message,
    linkPath: `/events/${event._id}`,
    festId: event.festId,
    eventId: event._id,
    actorUserId,
  });

  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.EVENT_BROADCAST_SENT ?? "event.broadcastSent",
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { audiences: allowed, explicitCount: explicitIds.length, notifiedCount, channel: "inApp" },
    ...context,
  });

  return { notifiedCount, audiences: allowed };
}

module.exports = {
  broadcastInAppMessage,
  broadcastFestMessage,
  notifyEventParticipants,
  broadcastEventMessage,
  getNotificationPreview,
  countSendsUsedToday,
  MAXIMUM_BULK_EMAILS_PER_EVENT_PER_DAY,
  SUBJECT_MAXIMUM_LENGTH,
  MESSAGE_MAXIMUM_LENGTH,
};
