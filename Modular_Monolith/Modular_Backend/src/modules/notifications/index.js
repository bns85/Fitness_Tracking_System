const express = require("express");
const notificationRepository = require("./notificationRepository");
const { createNotificationHub } = require("../../notifications/NotificationHub");
const { logJourneyStep } = require("../../utils/logger");
const config = require("../../config");

const hub = createNotificationHub();

/**
 * Public Facade API for Notifications Module
 */
async function createNotification({
  userId,
  type,
  title,
  message,
  goalId,
  periodKey,
  requestId,
}) {
  // E3 Fault injection: honour FAULT_NOTIFICATIONS=1
  if (config.faultNotifications) {
    throw new Error("Simulated fault: FAULT_NOTIFICATIONS=1 triggered");
  }

  const notification = await notificationRepository.create({
    userId,
    type,
    title,
    message,
    goalId,
    periodKey,
  });

  logJourneyStep({
    level: "info",
    requestId: requestId || null,
    service: config.serviceName,
    variant: config.variant,
    step: "notification_created",
    userId,
    msg: `Notification created: ${title}`,
  });

  // Fan out via NotificationHub (SSE delivery / Redis Pub/Sub)
  await hub.publish(userId, notification, requestId);

  return notification;
}

async function getNotifications(userId) {
  return await notificationRepository.findByUserId(userId);
}

async function markAsRead(id) {
  return await notificationRepository.markAsRead(id);
}

async function getUnreadCount(userId) {
  return await notificationRepository.countUnread(userId);
}

function registerStream(userId, res) {
  hub.register(userId, res);
}

// ----------------------------------------------------
// Express Routes
// ----------------------------------------------------
const router = express.Router();

router.post("/notifications", async (req, res) => {
  try {
    const { userId, type, title, message } = req.body;
    const notification = await createNotification({
      userId,
      type,
      title,
      message,
      requestId: req.requestId,
    });
    res.status(201).json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/notifications/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const notifications = await getNotifications(userId);
    res.json({ success: true, notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/notifications/:userId/stream", (req, res) => {
  const { userId } = req.params;
  registerStream(userId, res);
});

router.put("/notifications/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await markAsRead(id);
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/notifications/:userId/unread-count", async (req, res) => {
  try {
    const { userId } = req.params;
    const unreadCount = await getUnreadCount(userId);
    res.json({ success: true, unreadCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = {
  createNotification,
  getNotifications,
  markAsRead,
  getUnreadCount,
  registerStream,
  hub,
  routes: router,
};
