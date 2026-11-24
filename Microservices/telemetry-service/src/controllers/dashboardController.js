const FitnessData = require("../models/FitnessData");
const HeartRate = require("../models/HeartRate");
const Sleep = require("../models/Sleep");
const cache = require("../utils/cache");
const { requestJson } = require("../../../shared/httpClient");

function internalGet(serviceUrl, to, requestId) {
  return requestJson(serviceUrl, {
    method: "GET",
    from: "telemetry",
    to,
    requestId,
  });
}

async function readTelemetrySummary(userId) {
  const [latestFitness, activityAverages, heartRateStats, sleepStats] = await Promise.all([
    FitnessData.findOne({ userId }).sort({ date: -1 }),
    FitnessData.aggregate([
      { $match: { userId } },
      { $sort: { date: -1 } },
      { $limit: 7 },
      {
        $group: {
          _id: null,
          avgSteps: { $avg: "$totalSteps" },
          avgCalories: { $avg: "$calories" },
          avgDistance: { $avg: "$totalDistance" },
          avgVeryActiveMinutes: { $avg: "$veryActiveMinutes" },
          avgSedentaryMinutes: { $avg: "$sedentaryMinutes" },
        },
      },
    ]),
    HeartRate.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          avgHeartRate: { $avg: "$value" },
          maxHeartRate: { $max: "$value" },
          minHeartRate: { $min: "$value" },
        },
      },
    ]),
    Sleep.aggregate([
      { $match: { userId } },
      { $sort: { date: -1 } },
      { $limit: 7 },
      {
        $group: {
          _id: null,
          avgMinutesAsleep: { $avg: "$totalMinutesAsleep" },
          avgTimeInBed: { $avg: "$totalTimeInBed" },
          latestMinutesAsleep: { $first: "$totalMinutesAsleep" },
        },
      },
    ]),
  ]);

  const activity = activityAverages[0] || {};
  const heartRate = heartRateStats[0] || {};
  const sleep = sleepStats[0] || {};

  return {
    userId,
    latestActivity: latestFitness
      ? {
          date: latestFitness.date,
          steps: latestFitness.totalSteps,
          distance: Math.round(latestFitness.totalDistance * 100) / 100,
          calories: latestFitness.calories,
          veryActiveMinutes: latestFitness.veryActiveMinutes,
          sedentaryMinutes: latestFitness.sedentaryMinutes,
        }
      : null,
    weeklyAverages: {
      steps: Math.round(activity.avgSteps || 0),
      calories: Math.round(activity.avgCalories || 0),
      distance: Math.round((activity.avgDistance || 0) * 100) / 100,
      activeMinutes: Math.round(activity.avgVeryActiveMinutes || 0),
      sedentaryMinutes: Math.round(activity.avgSedentaryMinutes || 0),
    },
    heartRate: {
      avg: Math.round(heartRate.avgHeartRate || 0),
      max: heartRate.maxHeartRate || 0,
      min: heartRate.minHeartRate || 0,
    },
    sleep: {
      avgMinutesAsleep: Math.round(sleep.avgMinutesAsleep || 0),
      avgTimeInBed: Math.round(sleep.avgTimeInBed || 0),
      latestMinutesAsleep: sleep.latestMinutesAsleep || 0,
    },
  };
}

async function getDashboardSummary(req, res) {
  const { userId } = req.params;
  try {
    const cacheKey = `dashboard:${userId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json({ source: "cache", data: cached });

    const data = await readTelemetrySummary(userId);
    const [goals, workouts] = await Promise.all([
      internalGet(`http://goal-service:5023/internal/goals/${encodeURIComponent(userId)}`, "goal", req.requestId),
      internalGet(`http://workout-service:5025/internal/workouts/recent/${encodeURIComponent(userId)}`, "workout", req.requestId),
    ]);
    data.goals = goals.goals;
    data.recentWorkouts = workouts.workouts;
    await cache.set(cacheKey, data);
    return res.json({ source: "database", data });
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId: req.requestId,
      service: "telemetry",
      variant: "micro",
      step: "dashboard_read",
      userId,
      msg: error.message,
    }));
    return res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
}

async function getInternalDashboard(req, res) {
  try {
    return res.json(await readTelemetrySummary(req.params.userId));
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { getDashboardSummary, getInternalDashboard, readTelemetrySummary };
