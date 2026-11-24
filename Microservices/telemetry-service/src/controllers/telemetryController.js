const FitnessData = require("../models/FitnessData");
const cache = require("../utils/cache");
const { logJourneyStep } = require("../../../shared/logger");

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
  const { userId, steps = 0, caloriesBurned = 0, distanceKm = 0, durationMinutes = 0, endTime } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

  try {
    const date = startOfLocalDay(endTime ? new Date(endTime) : new Date());
    await FitnessData.findOneAndUpdate(
      { userId, date },
      {
        $setOnInsert: { userId, date },
        $inc: {
          totalSteps: Number(steps) || 0,
          calories: Number(caloriesBurned) || 0,
          totalDistance: Number(distanceKm) || 0,
          veryActiveMinutes: Number(durationMinutes) || 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await invalidateDashboardCache(userId, req.requestId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function invalidateDashboard(req, res) {
  await invalidateDashboardCache(req.params.userId, req.requestId);
  res.status(204).end();
}

module.exports = { recordSteps, updateWorkoutTotals, invalidateDashboard, startOfLocalDay };
