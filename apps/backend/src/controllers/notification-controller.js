const notificationService = require("../services/notification-service");

async function getMyNotifications(request, response) {
  const result = await notificationService.listMyNotifications(
    request.authenticatedUser.userId,
    { limit: request.query.limit, before: request.query.before }
  );
  return response.status(200).json({ data: result });
}

async function postMarkNotificationRead(request, response) {
  const result = await notificationService.markNotificationRead(
    request.authenticatedUser.userId,
    request.params.notificationId
  );
  return response.status(200).json({ data: result });
}

async function postMarkAllNotificationsRead(request, response) {
  const result = await notificationService.markAllNotificationsRead(
    request.authenticatedUser.userId
  );
  return response.status(200).json({ data: result });
}

async function deleteMyNotification(request, response) {
  const result = await notificationService.deleteMyNotification(
    request.authenticatedUser.userId,
    request.params.notificationId
  );
  return response.status(200).json({ data: result });
}

module.exports = {
  getMyNotifications,
  postMarkNotificationRead,
  postMarkAllNotificationsRead,
  deleteMyNotification,
};
