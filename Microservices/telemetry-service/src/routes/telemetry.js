const express = require("express");
const { recordSteps, updateWorkoutTotals, invalidateDashboard } = require("../controllers/telemetryController");
const { getDashboardSummary, getInternalDashboard } = require("../controllers/dashboardController");
const FitnessData = require("../models/FitnessData");
const WorkoutContribution = require("../models/WorkoutContribution");

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
    const [fitnessTotals, workoutTotals] = await Promise.all([
      FitnessData.aggregate([
        { $match: { userId: req.params.userId, date: { $gte: startDate, $lt: endDate } } },
        {
          $group: {
            _id: null,
            totalSteps: { $sum: "$totalSteps" },
            calories: { $sum: "$calories" },
            totalDistance: { $sum: "$totalDistance" },
          },
        },
      ]),
      WorkoutContribution.aggregate([
        { $match: { userId: req.params.userId, date: { $gte: startDate, $lt: endDate } } },
        {
          $group: {
            _id: null,
            totalSteps: { $sum: "$totalSteps" },
            calories: { $sum: "$calories" },
            totalDistance: { $sum: "$totalDistance" },
          },
        },
      ]),
    ]);
    const fitness = fitnessTotals[0] || {};
    const workout = workoutTotals[0] || {};
    res.json({
      totalSteps: (fitness.totalSteps || 0) + (workout.totalSteps || 0),
      calories: (fitness.calories || 0) + (workout.calories || 0),
      totalDistance: (fitness.totalDistance || 0) + (workout.totalDistance || 0),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
