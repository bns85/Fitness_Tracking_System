const express = require("express");
const { getDashboardSummary } = require("../controllers/dashboardController");
const {
  logSleep,
  startWalk,
  stopWalk,
  logCalories,
  logWeight,
  getActiveWalk,
} = require("../controllers/activityController");

const router = express.Router();

// POLLING: Client periodically fetches dashboard data
router.get("/dashboard/:userId", getDashboardSummary);

// POLLING: Client periodically checks walk status
router.get("/walk/:userId/status", getActiveWalk);

// POLLING: Client submits user actions (POST) then polls for updated dashboard
router.post("/sleep/:userId", logSleep);
router.post("/walk/:userId/start", startWalk);
router.post("/walk/:userId/stop", stopWalk);
router.post("/steps/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const steps = parseInt(req.body.steps) || 500;
    const calories = parseFloat(req.body.calories) || 25;
    const distance = parseFloat(req.body.distance) || 0.35;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const FitnessData = require("../models/FitnessData");
    const cache = require("../utils/cache");

    await FitnessData.findOneAndUpdate(
      { userId, date: { $gte: today } },
      {
        $inc: { totalSteps: steps, calories, totalDistance: distance },
        $setOnInsert: { userId, date: today },
      },
      { upsert: true, new: true }
    );
    await cache.del(`dashboard:${userId}`);
    res.json({ success: true, steps, userId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post("/calories/:userId", logCalories);
router.post("/weight/:userId", logWeight);

module.exports = router;
