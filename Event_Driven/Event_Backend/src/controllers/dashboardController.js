const FitnessData = require("../models/FitnessData");
const HeartRate = require("../models/HeartRate");
const Sleep = require("../models/Sleep");
const Goal = require("../models/Goal");
const cache = require("../utils/cache");

const getDashboardSummary = async (req, res) => {
  try {
    const { userId } = req.params;

    const cacheKey = `dashboard:${userId}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ source: "cache", data: cached });
    }

    // Get latest fitness data for user
    const latestFitness = await FitnessData.findOne({ userId }).sort({ date: -1 });

    // Get today's or most recent day summary
    const todayData = await FitnessData.aggregate([
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
          latestSteps: { $first: "$totalSteps" },
          latestCalories: { $first: "$calories" },
          latestDistance: { $first: "$totalDistance" },
          latestVeryActiveMinutes: { $first: "$veryActiveMinutes" },
          latestSedentaryMinutes: { $first: "$sedentaryMinutes" },
        },
      },
    ]);

    // Get heart rate stats
    const heartRateStats = await HeartRate.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          avgHeartRate: { $avg: "$value" },
          maxHeartRate: { $max: "$value" },
          minHeartRate: { $min: "$value" },
        },
      },
    ]);

    // Get sleep stats
    const sleepStats = await Sleep.aggregate([
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
    ]);

    // Get active goals
    const goals = await Goal.find({ userId, achieved: false });

    const summary = todayData[0] || {};
    const hr = heartRateStats[0] || {};
    const sl = sleepStats[0] || {};

    // Calculate goal progress based on latest data
    const goalProgress = goals.map((goal) => {
      let current = 0;
      switch (goal.type) {
        case "steps":
          current = summary.latestSteps || 0;
          break;
        case "calories":
          current = summary.latestCalories || 0;
          break;
        case "distance":
          current = summary.latestDistance || 0;
          break;
      }
      return {
        type: goal.type,
        target: goal.target,
        current,
        percentage: goal.target > 0 ? Math.round((current / goal.target) * 100) : 0,
        achieved: current >= goal.target,
      };
    });

    const dashboardData = {
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
        steps: Math.round(summary.avgSteps || 0),
        calories: Math.round(summary.avgCalories || 0),
        distance: Math.round((summary.avgDistance || 0) * 100) / 100,
        activeMinutes: Math.round(summary.avgVeryActiveMinutes || 0),
        sedentaryMinutes: Math.round(summary.avgSedentaryMinutes || 0),
      },
      heartRate: {
        avg: Math.round(hr.avgHeartRate || 0),
        max: hr.maxHeartRate || 0,
        min: hr.minHeartRate || 0,
      },
      sleep: {
        avgMinutesAsleep: Math.round(sl.avgMinutesAsleep || 0),
        avgTimeInBed: Math.round(sl.avgTimeInBed || 0),
        latestMinutesAsleep: sl.latestMinutesAsleep || 0,
      },
      goals: goalProgress,
    };

    await cache.set(cacheKey, dashboardData);

    res.json({ source: "database", data: dashboardData });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
};

module.exports = { getDashboardSummary };
