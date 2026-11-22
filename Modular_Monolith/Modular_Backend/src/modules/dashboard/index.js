const express = require("express");
const cache = require("../../utils/cache");

let telemetryModule = null;
let goalsModule = null;
let workoutsModule = null;

function setDependencies({ telemetry, goals, workouts }) {
  if (telemetry) telemetryModule = telemetry;
  if (goals) goalsModule = goals;
  if (workouts) workoutsModule = workouts;
}

/**
 * Public Facade API for Dashboard Module
 * Owns no data itself; queries facades of telemetry, goals, and workouts.
 */
async function getDashboardSummary(userId) {
  const cacheKey = `dashboard:${userId}`;
  const cached = await cache.get(cacheKey);
  if (cached) {
    return { source: "cache", data: cached };
  }

  const telemetry = telemetryModule || require("../telemetry");
  const goals = goalsModule || require("../goals");
  const workouts = workoutsModule || require("../workouts");

  const [latestFitness, weeklyAvg, goalViews, recentWorkouts] = await Promise.all([
    telemetry.getLatestActivity(userId),
    telemetry.getWeeklyAverages(userId),
    goals.getGoalViewsForUser(userId),
    workouts.getRecentWorkouts(userId, 5),
  ]);

  const dashboardData = {
    userId,
    latestActivity: latestFitness
      ? {
          date: latestFitness.date,
          steps: latestFitness.totalSteps || 0,
          distance: Math.round((latestFitness.totalDistance || 0) * 100) / 100,
          calories: latestFitness.calories || 0,
          veryActiveMinutes: latestFitness.veryActiveMinutes || 0,
          sedentaryMinutes: latestFitness.sedentaryMinutes || 0,
        }
      : null,
    weeklyAverages: {
      steps: Math.round(weeklyAvg.avgSteps || 0),
      calories: Math.round(weeklyAvg.avgCalories || 0),
      distance: Math.round((weeklyAvg.avgDistance || 0) * 100) / 100,
      activeMinutes: Math.round(weeklyAvg.avgVeryActiveMinutes || 0),
      sedentaryMinutes: Math.round(weeklyAvg.avgSedentaryMinutes || 0),
    },
    heartRate: {
      avg: 0,
      max: 0,
      min: 0,
    },
    sleep: {
      avgMinutesAsleep: 0,
      avgTimeInBed: 0,
      latestMinutesAsleep: 0,
    },
    goals: goalViews,
    recentWorkouts,
  };

  await cache.set(cacheKey, dashboardData);

  return { source: "database", data: dashboardData };
}

// ----------------------------------------------------
// Express Routes
// ----------------------------------------------------
const router = express.Router();

router.get("/dashboard/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await getDashboardSummary(userId);
    res.json(result);
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
});

module.exports = {
  getDashboardSummary,
  setDependencies,
  routes: router,
};
