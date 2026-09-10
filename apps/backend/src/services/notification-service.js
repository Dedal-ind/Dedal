const mongoose = require("mongoose");

const { NotificationModel, NOTIFICATION_TYPES } = require("../models/notification-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

/* One page of the feed. Enough to fill a long scroll without an unbounded read. */
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/*
 * Write one notification per recipient in a single round trip.
 *
 * Deliberately best-effort: a broadcast that reaches 199 of 200 people must not
 * roll back, and a notification failing must never fail the action that raised
 * it — nobody should lose a completed round because the feed write hiccupped.
 * Callers get a count and can log it; they do not get an exception.
 *
 * Duplicate userIds are collapsed, so someone who is both a volunteer and a
 * participant on the same event gets one row rather than two.
 */
async function notifyUsers({
  userIds,
  notificationType,
  title,
  body = null,
  linkPath = null,
  festId = null,
  eventId = null,
  actorUserId = null,
}) {
  const uniqueIds = [
    ...new Set(
      (userIds ?? [])
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => String(id))
    ),
  ];
  if (uniqueIds.length === 0 || !title) {
    return 0;
  }

  const rows = uniqueIds.map((id) => ({
    userId: new mongoose.Types.ObjectId(id),
    notificationType,
    title,
    body,
    linkPath,
    festId: festId ?? null,
    eventId: eventId ?? null,
    actorUserId: actorUserId ?? null,
  }));

  try {
    /* ordered:false so one bad row cannot abort the rest of the batch. */
    const inserted = await NotificationModel.insertMany(rows, { ordered: false });
    return inserted.length;
  } catch (insertError) {
    /* Partial success still counts — insertMany reports what did land. */
    const written = insertError?.result?.nInserted ?? 0;
    console.error(
      `Notification fan-out partially failed: ${written}/${rows.length} written.`,
      insertError?.message
    );
    return written;
  }
}

/*
 * The signed-in user's feed, newest first, with the unread count alongside so
 * the bell badge does not need a second request.
 */
async function listMyNotifications(userId, { limit, before } = {}) {
  const pageSize = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const query = { userId };
  if (before && !Number.isNaN(new Date(before).getTime())) {
    query.createdAt = { $lt: new Date(before) };
  }

  const notifications = await NotificationModel.find(query)
    .sort({ createdAt: -1 })
    .limit(pageSize)
    .lean();

  const unreadCount = await NotificationModel.countDocuments({ userId, readAt: null });

  return {
    notifications: notifications.map((row) => ({
      id: String(row._id),
      notificationType: row.notificationType,
      title: row.title,
      body: row.body ?? null,
      linkPath: row.linkPath ?? null,
      eventId: row.eventId ? String(row.eventId) : null,
      festId: row.festId ? String(row.festId) : null,
      isRead: Boolean(row.readAt),
      createdAt: row.createdAt,
    })),
    unreadCount,
    /* Tells the client whether to keep paginating without a count query. */
    hasMore: notifications.length === pageSize,
  };
}

async function markNotificationRead(userId, notificationId) {
  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid notification id.");
  }

  /* Scoped by userId as well as _id: the id alone would let anyone mark another
   * person's notification read by guessing it. */
  const updated = await NotificationModel.findOneAndUpdate(
    { _id: notificationId, userId, readAt: null },
    { $set: { readAt: new Date() } },
    { new: true }
  ).lean();

  /* Already-read is not an error — a double tap should be harmless. */
  if (!updated) {
    const exists = await NotificationModel.exists({ _id: notificationId, userId });
    if (!exists) {
      throw new ApplicationError(404, ERROR_CODES.ROUTE_NOT_FOUND, "Notification not found.");
    }
  }

  const unreadCount = await NotificationModel.countDocuments({ userId, readAt: null });
  return { unreadCount };
}

/*
 * Delete one row from the signed-in user's own feed — the swipe-to-delete on
 * the notifications screen.
 *
 * Scoped by userId as well as _id for the same reason markNotificationRead is:
 * the id alone would let anyone delete another person's notification by
 * guessing it. A miss is a 404 whether the row never existed or belongs to
 * somebody else, so the endpoint cannot be used to probe for valid ids.
 */
async function deleteMyNotification(userId, notificationId) {
  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Invalid notification id.");
  }

  const deleted = await NotificationModel.findOneAndDelete({
    _id: notificationId,
    userId,
  }).lean();

  if (!deleted) {
    throw new ApplicationError(404, ERROR_CODES.ROUTE_NOT_FOUND, "Notification not found.");
  }

  const unreadCount = await NotificationModel.countDocuments({ userId, readAt: null });
  return { deletedId: String(deleted._id), unreadCount };
}

async function markAllNotificationsRead(userId) {
  const result = await NotificationModel.updateMany(
    { userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return { markedCount: result.modifiedCount ?? 0, unreadCount: 0 };
}

module.exports = {
  notifyUsers,
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteMyNotification,
  NOTIFICATION_TYPES,
};
