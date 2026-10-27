const Notification = require("../models/Notification");
const { eventBus, EVENTS } = require("../utils/eventBus");

// ============================================================
// 1. Create a notification (existing from Sprint 1)
// ============================================================
const createNotification = async (req, res) => {
  try {
    const { userId, type, title, message } = req.body;

    const notification = await Notification.create({
      userId,
      type,
      title,
      message,
    });

    res.status(201).json({
      success: true,
      notification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// 2. Get notifications for a user (existing from Sprint 1)
// ============================================================
const getNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      notifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// 3. SSE Stream — Real-time notification push (Sprint 2 - Siddharth)
// ============================================================
const streamNotifications = (req, res) => {
  const { userId } = req.params;

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  console.log(`📡 [SSE] Client connected for user ${userId}`);

  // Send a heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30000);

  // Listen for NOTIFICATION_CREATED events on the EventBus
  const onNotification = (data) => {
    if (data.userId === userId) {
      console.log(`📤 [SSE] Pushing notification to user ${userId}`);
      res.write(`event: notification\n`);
      res.write(`data: ${JSON.stringify(data.notification)}\n\n`);
    }
  };

  eventBus.on(EVENTS.NOTIFICATION_CREATED, onNotification);

  // Cleanup when client disconnects
  req.on("close", () => {
    console.log(`🔌 [SSE] Client disconnected for user ${userId}`);
    clearInterval(heartbeat);
    eventBus.removeListener(EVENTS.NOTIFICATION_CREATED, onNotification);
    res.end();
  });
};

// ============================================================
// 4. Mark notification as read (Sprint 2 - Siddharth)
// ============================================================
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      id,
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.json({
      success: true,
      notification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================================================
// 5. Get unread notification count (Sprint 2 - Siddharth)
// ============================================================
const getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;

    const count = await Notification.countDocuments({ userId, read: false });

    res.json({
      success: true,
      unreadCount: count,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createNotification,
  getNotifications,
  streamNotifications,
  markAsRead,
  getUnreadCount,
};