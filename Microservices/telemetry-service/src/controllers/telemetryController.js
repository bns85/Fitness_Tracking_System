const FitnessData = require("../models/FitnessData");
const WorkoutContribution = require("../models/WorkoutContribution");
const cache = require("../utils/cache");
const { logJourneyStep } = require("../../../shared/logger");
const { requestJson } = require("../../../shared/httpClient");
const { journeyFailures } = require("../../../shared/metrics");

async function evaluateGoalsBestEffort(userId, requestId) {
  try {
    await requestJson(`http://goal-service:5023/internal/evaluate/${encodeURIComponent(userId)}`, {
      method: "POST",
      body: {},
      from: "telemetry",
      to: "goal",
      requestId,
    });
    logJourneyStep({
      requestId,
      service: "telemetry",
      step: "goal_evaluated",
      userId,
      msg: "Goal evaluation completed",
    });
  } catch (error) {
    journeyFailures.inc({ step: "goal_evaluated" });
    logJourneyStep({
      level: "error",
      requestId,
      service: "telemetry",
      step: "goal_evaluated",
      userId,
      msg: `Goal evaluation failed: ${error.message}`,
    });
  }
}

async function invalidateDashboardCache(userId, requestId) {
  try {
    await cache.del(`dashboard:${userId}`);
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId,
      service: "telemetry",
      variant: "micro",
      userId,
      msg: `Dashboard cache invalidation failed: ${error.message}`,
    }));
  }
}

function startOfLocalDay(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

async function recordSteps(req, res) {
  const { userId, steps, calories = 0, distance = 0 } = req.body || {};
  logJourneyStep({
    requestId: req.requestId,
    service: "telemetry",
    step: "ingest_received",
    userId: userId || null,
    msg: "Step telemetry received",
  });

  if (!userId || !steps) {
    return res.status(400).json({ success: false, message: "userId and steps are required" });
  }

  try {
    const date = startOfLocalDay();
    await FitnessData.findOneAndUpdate(
      { userId, date },
      {
        $setOnInsert: { userId, date },
        $inc: {
          totalSteps: Number.parseInt(steps, 10),
          calories: Number.parseFloat(calories),
          totalDistance: Number.parseFloat(distance),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await invalidateDashboardCache(userId, req.requestId);
    logJourneyStep({
      requestId: req.requestId,
      service: "telemetry",
      step: "data_saved",
      userId,
      msg: "Step telemetry saved",
    });

    await evaluateGoalsBestEffort(userId, req.requestId);

    return res.json({
      success: true,
      message: `Steps recorded (+${steps} steps) for user ${userId}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function updateWorkoutTotals(req, res) {
  const {
    workoutId,
    userId,
    steps = 0,
    caloriesBurned = 0,
    distanceKm = 0,
    durationMinutes = 0,
    endTime,
  } = req.body || {};
  if (!workoutId) return res.status(400).json({ success: false, message: "workoutId is required" });
  if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

  try {
    const date = startOfLocalDay(endTime ? new Date(endTime) : new Date());
    const contribution = {
      workoutId,
      userId,
      date,
      totalSteps: Number.parseInt(steps, 10) || 0,
      calories: Math.round(Number(caloriesBurned) || 0),
      totalDistance: Math.round((Number(distanceKm) || 0) * 100) / 100,
      veryActiveMinutes: Math.round(Number(durationMinutes) || 0),
    };
    try {
      await WorkoutContribution.updateOne(
      { workoutId },
      {
        $setOnInsert: contribution,
      },
      { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000 || !await WorkoutContribution.exists({ workoutId })) throw error;
    }
    await invalidateDashboardCache(userId, req.requestId);
    await evaluateGoalsBestEffort(userId, req.requestId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function invalidateDashboard(req, res) {
  await invalidateDashboardCache(req.params.userId, req.requestId);
  res.status(204).end();
}

module.exports = {
  recordSteps,
  updateWorkoutTotals,
  invalidateDashboard,
  startOfLocalDay,
  evaluateGoalsBestEffort,
};
