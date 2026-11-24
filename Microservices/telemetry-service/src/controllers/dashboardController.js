const FitnessData = require("../models/FitnessData");
const HeartRate = require("../models/HeartRate");
const Sleep = require("../models/Sleep");
const WorkoutContribution = require("../models/WorkoutContribution");
const cache = require("../utils/cache");
const { requestJson } = require("../../../shared/httpClient");
const { mergeActivityDays, averageField } = require("../utils/activityReadModel");

function internalGet(serviceUrl, to, requestId) {
  return requestJson(serviceUrl, {
    method: "GET",
    from: "telemetry",
    to,
    requestId,
  });
}

async function readTelemetrySummary(userId) {
  const [fitnessDays, workoutDays, heartRateStats, sleepStats] = await Promise.all([
    FitnessData.find({ userId }).sort({ date: -1 }).limit(7).lean(),
    WorkoutContribution.find({ userId }).sort({ date: -1 }).limit(7).lean(),
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

  const activityDays = mergeActivityDays(fitnessDays, workoutDays);
  const latestActivityDay = activityDays[0];
  const heartRate = heartRateStats[0] || {};
  const sleep = sleepStats[0] || {};

  return {
    userId,
    latestActivity: latestActivityDay
      ? {
          date: latestActivityDay.date,
          steps: latestActivityDay.totalSteps,
          distance: Math.round(latestActivityDay.totalDistance * 100) / 100,
          calories: latestActivityDay.calories,
          veryActiveMinutes: latestActivityDay.veryActiveMinutes,
          sedentaryMinutes: latestActivityDay.sedentaryMinutes,
        }
      : null,
    weeklyAverages: {
      steps: Math.round(averageField(activityDays, "totalSteps")),
      calories: Math.round(averageField(activityDays, "calories")),
      distance: Math.round(averageField(activityDays, "totalDistance") * 100) / 100,
      activeMinutes: Math.round(averageField(activityDays, "veryActiveMinutes")),
      sedentaryMinutes: Math.round(averageField(activityDays, "sedentaryMinutes")),
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
