const express = require("express");
const {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  pollNotifications,
  longPollNotifications,
} = require("../controllers/notificationController");
const FitnessData = require("../models/FitnessData");

const router = express.Router();

// ============================================================
// POLLING NOTIFICATION ENDPOINTS (SIDDHARTH SPRINT 2)
// ============================================================

// POLLING: Client periodically polls for new notifications
router.get("/notifications/:userId/poll", pollNotifications);

// LONG-POLLING: Client holds connection until an alert is triggered
router.get("/notifications/:userId/long-poll", longPollNotifications);

// ============================================================
// STANDARD NOTIFICATION CRUD ENDPOINTS (SIDDHARTH SPRINT 1)
// ============================================================

// Create a notification manually
router.post("/notifications", createNotification);

// Get unread notification count (for UI badge)
router.get("/notifications/:userId/unread-count", getUnreadCount);

// Get all notifications for user
router.get("/notifications/:userId", getNotifications);

// Mark a notification as read
router.put("/notifications/:id/read", markAsRead);

// ============================================================
// HELPER ROUTES FOR TESTING STEPS UNDER POLLING
// (Goal CRUD lives in routes/goal.js — POST /api/goals etc.)
// ============================================================

// Ingest or add steps for user
router.post("/steps/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { steps } = req.body;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fitness = await FitnessData.findOneAndUpdate(
      { userId, date: { $gte: today } },
      {
        $inc: { totalSteps: steps },
        $setOnInsert: { userId, date: today },
      },
      { upsert: true, new: true }
    );

    res.json({
      success: true,
      message: `Steps logged for user ${userId}: +${steps} steps`,
      totalSteps: fitness.totalSteps,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
