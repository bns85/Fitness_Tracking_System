const express = require("express");
const createNotificationController = require("../controllers/notificationController");

function createNotificationRouter(hub) {
  const controller = createNotificationController(hub);
  const router = express.Router();

  router.post("/notifications", controller.createNotification);
  router.get("/notifications/:userId", controller.getNotifications);
  router.get("/notifications/:userId/stream", controller.streamNotifications);
  router.put("/notifications/:id/read", controller.markAsRead);
  router.get("/notifications/:userId/unread-count", controller.getUnreadCount);
  router.post("/internal/notifications", controller.createFromGoal);

  return router;
}

module.exports = createNotificationRouter;
