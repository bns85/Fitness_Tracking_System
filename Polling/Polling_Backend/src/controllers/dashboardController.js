const mongoose = require("mongoose");
const FitnessData = require("../models/FitnessData");
const HeartRate = require("../models/HeartRate");
const Sleep = require("../models/Sleep");
const Goal = require("../models/Goal");
const Weight = require("../models/Weight");
const cache = require("../utils/cache");

// In-memory fallback when MongoDB is unavailable
const memStore = {
  fitnessData: [],
  sleep: [],
  weight: [],
  goals: [
    { userId: "1503960366", type: "steps", target: 10000, current: 0 },
    { userId: "1503960366", type: "calories", target: 2000, current: 0 },
    { userId: "1503960366", type: "distance", target: 8, current: 0 },
  ],
};

function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const getDashboardSummary = async (req, res) => {
  try {
    const { userId } = req.params;

    const cacheKey = `dashboard:${userId}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return res.json({ data: cached });
    }

    let dashboardData;

    if (isDBConnected()) {
      dashboardData = await buildDashboardFromDB(userId);
    } else {
      dashboardData = buildDashboardFromMemory(userId);
    }

    await cache.set(cacheKey, dashboardData);
    res.json({ data: dashboardData });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
};

async function buildDashboardFromDB(userId) {
  const latestFitness = await FitnessData.findOne({ userId }).sort({ date: -1 });

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

  const goals = await Goal.find({ userId, achieved: false });

  const summary = todayData[0] || {};
  const sl = sleepStats[0] || {};

  const goalProgress = goals.map((goal) => {
    let current = 0;
    switch (goal.type) {
      case "steps": current = summary.latestSteps || 0; break;
      case "calories": current = summary.latestCalories || 0; break;
      case "distance": current = summary.latestDistance || 0; break;
    }
    return {
      type: goal.type,
      target: goal.target,
      current,
      percentage: goal.target > 0 ? Math.round((current / goal.target) * 100) : 0,
      achieved: current >= goal.target,
    };
  });

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
      steps: Math.round(summary.avgSteps || 0),
      calories: Math.round(summary.avgCalories || 0),
      distance: Math.round((summary.avgDistance || 0) * 100) / 100,
      activeMinutes: Math.round(summary.avgVeryActiveMinutes || 0),
      sedentaryMinutes: Math.round(summary.avgSedentaryMinutes || 0),
    },
    sleep: {
      avgMinutesAsleep: Math.round(sl.avgMinutesAsleep || 0),
      avgTimeInBed: Math.round(sl.avgTimeInBed || 0),
      latestMinutesAsleep: sl.latestMinutesAsleep || 0,
    },
    goals: goalProgress,
  };
}

function buildDashboardFromMemory(userId) {
  const today = todayStart();
  const todayEntries = memStore.fitnessData.filter(
    (e) => e.userId === userId && new Date(e.date).getTime() >= today.getTime()
  );

  const latest = todayEntries.length
    ? todayEntries.reduce((a, b) => (new Date(a.date) > new Date(b.date) ? a : b))
    : null;

  const totalSteps = todayEntries.reduce((sum, e) => sum + (e.totalSteps || 0), 0);
  const totalCalories = todayEntries.reduce((sum, e) => sum + (e.calories || 0), 0);
  const totalDistance = todayEntries.reduce((sum, e) => sum + (e.totalDistance || 0), 0);
  const totalActiveMin = todayEntries.reduce((sum, e) => sum + (e.veryActiveMinutes || 0), 0);

  const sleepEntries = memStore.sleep.filter((s) => s.userId === userId);
  const avgSleep = sleepEntries.length
    ? sleepEntries.reduce((sum, s) => sum + s.totalMinutesAsleep, 0) / sleepEntries.length
    : 0;

  const goals = memStore.goals.filter((g) => g.userId === userId).map((g) => {
    let current = 0;
    switch (g.type) {
      case "steps": current = totalSteps; break;
      case "calories": current = totalCalories; break;
      case "distance": current = totalDistance; break;
    }
    return {
      type: g.type,
      target: g.target,
      current,
      percentage: g.target > 0 ? Math.round((current / g.target) * 100) : 0,
      achieved: current >= g.target,
    };
  });

  return {
    userId,
    latestActivity: latest
      ? {
          date: latest.date,
          steps: latest.totalSteps,
          distance: Math.round(latest.totalDistance * 100) / 100,
          calories: latest.calories,
          veryActiveMinutes: latest.veryActiveMinutes,
          sedentaryMinutes: latest.sedentaryMinutes,
        }
      : null,
    weeklyAverages: {
      steps: Math.round(totalSteps / Math.max(todayEntries.length, 1)),
      calories: Math.round(totalCalories / Math.max(todayEntries.length, 1)),
      distance: Math.round((totalDistance / Math.max(todayEntries.length, 1)) * 100) / 100,
      activeMinutes: Math.round(totalActiveMin / Math.max(todayEntries.length, 1)),
      sedentaryMinutes: 0,
    },
    sleep: {
      avgMinutesAsleep: Math.round(avgSleep),
      avgTimeInBed: Math.round(avgSleep + 15),
      latestMinutesAsleep: sleepEntries.length ? sleepEntries[0].totalMinutesAsleep : 0,
    },
    goals,
  };
}

module.exports = { getDashboardSummary, memStore };
