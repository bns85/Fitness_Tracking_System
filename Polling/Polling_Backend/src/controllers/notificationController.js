const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const config = require("../config");
const { pollResponses } = require("../metrics");
const { evaluateGoals } = require("../utils/goalProgress");
const { createGoalReachedNotification } = require("../utils/goalNotifications");
const cache = require("../utils/cache");

const QUIET = process.env.QUIET === "1";

// In-memory notifications store fallback when MongoDB is not connected
const memNotifications = [];

function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Check if user's active goals are reached (Polling-based goal evaluation)
 * Evaluates goals against real FitnessData for the correct daily/weekly period
 * and creates at most one GOAL_REACHED notification per goal per period.
 */
async function checkAndTriggerGoalNotifications(userId) {
  try {
    if (isDBConnected()) {
      let created = null;
      await evaluateGoals({
        userId,
        onReached: async (payload) => {
          const notif = await createGoalReachedNotification(payload);
          if (notif) {
            created = notif;
            await cache.del(`dashboard:${payload.userId}`);
            if (!QUIET) console.log(`[POLL ALERT] In-app notification created for ${payload.userId}: Goal reached (${payload.current}/${payload.target})`);
          }
        },
      });
      return created;
    }

    // Memory store fallback
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { memStore } = require("./dashboardController");
    const fit = memStore.fitnessData.find(
      (f) => f.userId === userId && new Date(f.date).getTime() >= today.getTime()
    );
    const currentSteps = fit ? fit.totalSteps || 0 : 0;

    const activeGoal = memStore.goals.find(
      (g) => g.userId === userId && g.type === "steps" && !g.achieved && g.active !== false
    );
    if (activeGoal && currentSteps >= activeGoal.target) {
      activeGoal.achieved = true;
      activeGoal.current = currentSteps;

      const notif = {
        _id: `mem_notif_${Date.now()}`,
        userId,
        type: "GOAL_REACHED",
        title: "🎉 Daily Steps Goal Achieved!",
        message: `Congratulations! You reached your daily goal of ${Number(activeGoal.target).toLocaleString()} steps.`,
        read: false,
        goalId: activeGoal._id ? String(activeGoal._id) : null,
        periodKey: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
        createdAt: new Date(),
      };
      memNotifications.unshift(notif);
      return notif;
    }
  } catch (err) {
    console.error("Error in checkAndTriggerGoalNotifications:", err.message);
  }
  return null;
}

// ============================================================================
// SPRINT 1 - STORY 1: NOTIFICATION API (SIDDHARTH)
// ============================================================================

/**
 * POST /api/notifications - Create a notification
 */
const createNotification = async (req, res) => {
  try {
    const { userId, type, title, message } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({ success: false, message: "userId, title, and message are required" });
    }

    if (isDBConnected()) {
      const notification = await Notification.create({
        userId,
        type: type || "GOAL_REACHED",
        title,
        message,
        read: false,
      });
      return res.status(201).json({ success: true, notification });
    }

    const notif = {
      _id: `mem_${Date.now()}`,
      userId,
      type: type || "GOAL_REACHED",
      title,
      message,
      read: false,
      createdAt: new Date(),
    };
    memNotifications.unshift(notif);
    res.status(201).json({ success: true, notification: notif });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/notifications/:userId - Get all notifications for user
 */
const getNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (isDBConnected()) {
      const notifications = await Notification.find({ userId }).sort({ createdAt: -1 });
      return res.json({ success: true, notifications });
    }

    const userNotifs = memNotifications.filter((n) => n.userId === userId);
    res.json({ success: true, notifications: userNotifs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/notifications/:userId/unread-count - Get unread count
 */
const getUnreadCount = async (req, res) => {
  try {
    const { userId } = req.params;

    if (isDBConnected()) {
      const count = await Notification.countDocuments({ userId, read: false });
      return res.json({ success: true, unreadCount: count });
    }

    const count = memNotifications.filter((n) => n.userId === userId && !n.read).length;
    res.json({ success: true, unreadCount: count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/notifications/:id/read - Mark notification as read
 */
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    if (isDBConnected()) {
      const notification = await Notification.findByIdAndUpdate(
        id,
        { read: true },
        { new: true }
      );
      if (!notification) {
        return res.status(404).json({ success: false, message: "Notification not found" });
      }
      return res.json({ success: true, notification });
    }

    const notif = memNotifications.find((n) => n._id === id);
    if (!notif) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    notif.read = true;
    res.json({ success: true, notification: notif });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// SPRINT 1 - STORY 2: IN-APP NOTIFICATION VIA POLLING (SIDDHARTH)
// ============================================================================

/**
 * GET /api/notifications/:userId/poll - Client periodically polls for in-app alerts
 * 
 * POLLING ARCHITECTURE MECHANISM:
 * 1. Client requests endpoint every pollIntervalMs (e.g. 5 seconds).
 * 2. Server checks active goals and triggers any reached alerts.
 * 3. Returns new/unread notifications + unread badge count.
 */
const pollNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { since } = req.query;

    // 1. Evaluate goal thresholds on each poll
    await checkAndTriggerGoalNotifications(userId);

    let query = { userId };
    if (since) {
      query.createdAt = { $gt: new Date(since) };
    } else {
      query.read = false;
    }

    let notifications = [];
    let unreadCount = 0;

    if (isDBConnected()) {
      notifications = await Notification.find(query).sort({ createdAt: -1 });
      unreadCount = await Notification.countDocuments({ userId, read: false });
    } else {
      notifications = memNotifications.filter((n) => {
        if (n.userId !== userId) return false;
        if (since && new Date(n.createdAt) <= new Date(since)) return false;
        if (!since && n.read) return false;
        return true;
      });
      unreadCount = memNotifications.filter((n) => n.userId === userId && !n.read).length;
    }

      const hasNew = notifications.length > 0;
      try {
        pollResponses.inc({ has_new: hasNew ? "true" : "false" });
      } catch (_) {
        /* metrics must never break requests */
      }
      res.json({
        architecture: "POLLING",
        pollIntervalMs: config.pollIntervalMs,
        hasNew,
        newCount: notifications.length,
        unreadCount,
        notifications,
        timestamp: new Date().toISOString(),
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/notifications/:userId/long-poll - Long polling mechanism
 * Holds the connection open until a new notification arrives or timeout occurs.
 */
const longPollNotifications = async (req, res) => {
  const { userId } = req.params;
  const timeoutMs = parseInt(req.query.timeout) || 15000;
  const startTime = Date.now();
  const pollIntervalCheckMs = 500;

  if (!QUIET) console.log(`[LONG-POLL] Client started waiting for alerts (User: ${userId}, Timeout: ${timeoutMs}ms)`);

  const timer = setInterval(async () => {
    try {
      await checkAndTriggerGoalNotifications(userId);

      let unread;
      if (isDBConnected()) {
        unread = await Notification.find({ userId, read: false }).sort({ createdAt: -1 });
      } else {
        unread = memNotifications.filter((n) => n.userId === userId && !n.read);
      }

      // If new unread alerts exist, respond immediately!
      if (unread.length > 0) {
        clearInterval(timer);
        return res.json({
          architecture: "LONG_POLLING",
          hasNew: true,
          notifications: unread,
          elapsedMs: Date.now() - startTime,
        });
      }

      // If timed out, return empty
      if (Date.now() - startTime >= timeoutMs) {
        clearInterval(timer);
        return res.json({
          architecture: "LONG_POLLING",
          hasNew: false,
          notifications: [],
          timeout: true,
          elapsedMs: Date.now() - startTime,
        });
      }
    } catch (e) {
      clearInterval(timer);
      res.status(500).json({ error: e.message });
    }
  }, pollIntervalCheckMs);

  req.on("close", () => {
    clearInterval(timer);
  });
};

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  pollNotifications,
  longPollNotifications,
  checkAndTriggerGoalNotifications,
};
