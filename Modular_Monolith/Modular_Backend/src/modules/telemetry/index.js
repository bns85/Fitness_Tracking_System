const express = require("express");
const telemetryRepository = require("./telemetryRepository");
const { logJourneyStep } = require("../../utils/logger");
const cache = require("../../utils/cache");
const config = require("../../config");

let journeyFailures = null;
try {
  const metrics = require("../../metrics");
  journeyFailures = metrics.journeyFailures;
} catch (_) {}

let goalsModule = null;

function setDependencies({ goals }) {
  if (goals) goalsModule = goals;
}

/**
 * Public Facade API for Telemetry Module
 */
async function saveStepData(data) {
  return await telemetryRepository.saveSteps(data);
}

async function incrementActivity(userId, deltas) {
  return await telemetryRepository.incrementActivity(userId, deltas);
}

async function getLatestActivity(userId) {
  return await telemetryRepository.getLatestActivity(userId);
}

async function getWeeklyAverages(userId) {
  return await telemetryRepository.getWeeklyAverages(userId);
}

async function sumActivity(userId, fieldName, bounds) {
  return await telemetryRepository.sumActivity(userId, fieldName, bounds);
}

async function activityTotalsByUser(bounds, userId) {
  return await telemetryRepository.activityTotalsByUser(bounds, userId);
}

// ----------------------------------------------------
// Express Routes
// ----------------------------------------------------
const router = express.Router();

router.post("/telemetry/steps", async (req, res) => {
  const { userId, steps, calories = 0, distance = 0 } = req.body;

  if (!userId || steps === undefined || steps === null) {
    return res.status(400).json({
      success: false,
      message: "userId and steps are required",
    });
  }

  const requestId = req.requestId || null;

  // 1. Log ingest_received
  logJourneyStep({
    level: "info",
    requestId,
    service: config.serviceName,
    variant: config.variant,
    step: "ingest_received",
    userId,
    msg: `Ingest steps: ${steps}`,
  });

  try {
    // 2. Save data first
    await telemetryRepository.saveSteps({ userId, steps, calories, distance });

    // 3. Log data_saved
    logJourneyStep({
      level: "info",
      requestId,
      service: config.serviceName,
      variant: config.variant,
      step: "data_saved",
      userId,
      msg: `Data saved: ${steps} steps`,
    });

    // Invalidate dashboard cache
    await cache.del(`dashboard:${userId}`);

    // 4. Synchronous chain: evaluate goals (Error policy P: best-effort)
    const goals = goalsModule || require("../goals");
    try {
      await goals.evaluateGoals(userId, requestId);
    } catch (goalErr) {
      if (journeyFailures) {
        try {
          journeyFailures.inc({ step: "goal_evaluated" });
        } catch (_) {}
      }
      logJourneyStep({
        level: "warn",
        requestId,
        service: config.serviceName,
        variant: config.variant,
        step: "goal_evaluated",
        userId,
        msg: `Goal evaluation error: ${goalErr.message}`,
      });
    }

    // Error policy P: return 200 after data is saved
    res.status(200).json({
      success: true,
      message: "Telemetry recorded successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (journeyFailures) {
      try {
        journeyFailures.inc({ step: "data_saved" });
      } catch (_) {}
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = {
  saveStepData,
  incrementActivity,
  getLatestActivity,
  getWeeklyAverages,
  sumActivity,
  activityTotalsByUser,
  setDependencies,
  routes: router,
};
