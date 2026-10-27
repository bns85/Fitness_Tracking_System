const express = require("express");
const {
  createNotification,
  getNotifications,
  streamNotifications,
  markAsRead,
  getUnreadCount,
} = require("../controllers/notificationController");

const router = express.Router();

// Create a notification
router.post("/notifications", createNotification);

// Get notifications for a user
router.get("/notifications/:userId", getNotifications);

// SSE Stream — Real-time notification push (Sprint 2 - Siddharth)
router.get("/notifications/:userId/stream", streamNotifications);

// Mark a notification as read (Sprint 2 - Siddharth)
router.put("/notifications/:id/read", markAsRead);

// Get unread notification count (Sprint 2 - Siddharth)
router.get("/notifications/:userId/unread-count", getUnreadCount);

module.exports = router;