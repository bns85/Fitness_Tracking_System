const express = require("express");
const { recordSteps, updateWorkoutTotals, invalidateDashboard } = require("../controllers/telemetryController");
const { getDashboardSummary, getInternalDashboard } = require("../controllers/dashboardController");
const FitnessData = require("../models/FitnessData");

const router = express.Router();

router.post("/telemetry/steps", recordSteps);
router.get("/dashboard/:userId", getDashboardSummary);
router.post("/internal/workouts/totals", updateWorkoutTotals);
router.delete("/internal/dashboard/:userId/cache", invalidateDashboard);
router.get("/internal/dashboard/:userId", getInternalDashboard);
router.get("/internal/telemetry/activity/:userId", async (req, res) => {
  const { start, end } = req.query;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (!start || !end || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    res.status(400).json({ success: false, message: "start and end must be valid dates" });
    return;
  }

  try {
    const [totals = {}] = await FitnessData.aggregate([
      {
        $match: {
          userId: req.params.userId,
          date: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id: null,
          totalSteps: { $sum: "$totalSteps" },
          calories: { $sum: "$calories" },
          totalDistance: { $sum: "$totalDistance" },
        },
      },
    ]);
    res.json({
      totalSteps: totals.totalSteps || 0,
      calories: totals.calories || 0,
      totalDistance: totals.totalDistance || 0,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
