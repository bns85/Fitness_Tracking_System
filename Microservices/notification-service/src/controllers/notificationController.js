const Notification = require("../models/Notification");
const { journeyFailures } = require("../../../shared/metrics");
const { logJourneyStep } = require("../../../shared/logger");
const workoutNotificationId = require("../utils/workoutNotificationId");

function failure(req, step, message) {
  journeyFailures.inc({ step });
  logJourneyStep({
    level: "error",
    requestId: req.requestId,
    service: "notification",
    step,
    userId: req.body && req.body.userId,
    msg: message,
  });
}

function createNotificationController(hub) {
  async function createNotification(req, res) {
    try {
      const notification = await Notification.create(req.body || {});
      return res.status(201).json({ success: true, notification });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async function createFromGoal(req, res) {
    let notification;
    try {
      const body = req.body || {};
      if (body.type === "WORKOUT_COMPLETED" && body.workoutId) {
        const _id = workoutNotificationId(body.userId, body.workoutId);
        notification = await Notification.findById(_id);
        if (!notification) {
          try {
            notification = await Notification.create({ ...body, _id });
          } catch (error) {
            if (error.code !== 11000) throw error;
            notification = await Notification.findById(_id);
            if (!notification) throw error;
          }
        }
      }
      if (body.goalId && body.periodKey) {
        notification = notification || await Notification.findOne({
          userId: body.userId,
          type: "GOAL_REACHED",
          goalId: body.goalId,
          periodKey: body.periodKey,
        });
      }
      if (!notification && !(body.type === "WORKOUT_COMPLETED" && body.workoutId)) {
        try {
          notification = await Notification.create(body);
        } catch (error) {
          if (error.code !== 11000 || !body.goalId || !body.periodKey) throw error;
          notification = await Notification.findOne({
            userId: body.userId,
            type: "GOAL_REACHED",
            goalId: body.goalId,
            periodKey: body.periodKey,
          });
          if (!notification) throw error;
        }
      }
    } catch (error) {
      failure(req, "notification_created", `Notification save failed: ${error.message}`);
      return res.status(500).json({ success: false, message: error.message });
    }

    logJourneyStep({
      requestId: req.requestId,
      service: "notification",
      step: "notification_created",
      userId: notification.userId,
      msg: "Notification saved",
    });

    try {
      await hub.publish(notification.userId, notification, req.requestId);
    } catch (error) {
      journeyFailures.inc({ step: "sse_sent" });
      logJourneyStep({
        level: "error",
        requestId: req.requestId,
        service: "notification",
        step: "sse_sent",
        userId: notification.userId,
        msg: `SSE publish failed: ${error.message}`,
      });
    }
    return res.status(201).json({ success: true, notification });
  }

  async function getNotifications(req, res) {
    try {
      const notifications = await Notification.find({ userId: req.params.userId }).sort({ createdAt: -1 });
      return res.json({ success: true, notifications });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  function streamNotifications(req, res) {
    hub.register(req.params.userId, res);
  }

  async function markAsRead(req, res) {
    try {
      const notification = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
      if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });
      return res.json({ success: true, notification });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async function getUnreadCount(req, res) {
    try {
      const unreadCount = await Notification.countDocuments({ userId: req.params.userId, read: false });
      return res.json({ success: true, unreadCount });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  return { createNotification, createFromGoal, getNotifications, streamNotifications, markAsRead, getUnreadCount };
}

module.exports = createNotificationController;
