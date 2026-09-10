const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  getMyNotifications,
  postMarkNotificationRead,
  postMarkAllNotificationsRead,
  deleteMyNotification,
} = require("../controllers/notification-controller");

/*
 * Every route here is scoped to the signed-in user by the service, which reads
 * the id from the token rather than the URL. There is deliberately no route for
 * reading someone else's feed, and no route for creating a notification — rows
 * are only ever written by the action that raised them.
 */
const notificationRouter = express.Router();

notificationRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyNotifications));

/*
 * "mark-all-read" is declared before the :notificationId route so the literal
 * path is matched by its own handler instead of being read as an id.
 */
notificationRouter.post(
  "/mine/mark-all-read",
  authenticationMiddleware,
  asyncHandler(postMarkAllNotificationsRead)
);

notificationRouter.post(
  "/mine/:notificationId/read",
  authenticationMiddleware,
  asyncHandler(postMarkNotificationRead)
);

/*
 * Removing a row from your own feed. Scoped to the token's user by the service,
 * like every other route here, so a guessed id deletes nothing.
 */
notificationRouter.delete(
  "/mine/:notificationId",
  authenticationMiddleware,
  asyncHandler(deleteMyNotification)
);

module.exports = { notificationRouter };
