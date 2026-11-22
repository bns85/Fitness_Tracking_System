const express = require("express");
const goalRepository = require("./goalRepository");
const { getStrategy, supportedGoalTypes } = require("./strategies");
const {
  periodBounds,
  currentPeriodKeys,
  buildGoalView,
  sortGoalViews,
} = require("./periodUtils");
const burnCpu = require("../../utils/burnCpu");
const { logJourneyStep } = require("../../utils/logger");
const cache = require("../../utils/cache");
const config = require("../../config");

let journeyFailures = null;
try {
  const metrics = require("../../metrics");
  journeyFailures = metrics.journeyFailures;
} catch (_) {}

// Injected module references (resolved at startup / runtime)
let telemetryModule = null;
let notificationsModule = null;

function setDependencies({ telemetry, notifications }) {
  if (telemetry) telemetryModule = telemetry;
  if (notifications) notificationsModule = notifications;
}

/**
 * Public Facade API for Goals Module
 */
async function evaluateGoals(userId, requestId) {
  try {
    // Exactly ONE call to burnCpu inside goal logic
    burnCpu(config.goalCpuMs);

    const [dailyKey, weeklyKey] = currentPeriodKeys();
    const goals = await goalRepository.findUnachievedOrStale(userId, dailyKey, weeklyKey);
    if (!goals || goals.length === 0) return [];

    const dailyBounds = periodBounds("daily");
    const weeklyBounds = periodBounds("weekly");

    const telemetry = telemetryModule || require("../telemetry");
    const [dailyTotals, weeklyTotals] = await Promise.all([
      telemetry.activityTotalsByUser(dailyBounds, userId),
      telemetry.activityTotalsByUser(weeklyBounds, userId),
    ]);

    const reached = [];
    const currentUpdates = [];

    for (const goal of goals) {
      const period = goal.period || "daily";
      const isWeekly = period === "weekly";
      const bounds = isWeekly ? weeklyBounds : dailyBounds;
      const totalsMap = isWeekly ? weeklyTotals : dailyTotals;
      const userTotals = totalsMap.get(String(goal.userId));

      const strategy = getStrategy(goal.type);
      const current = strategy ? strategy.extractValue(userTotals) : 0;
      const target = Number(goal.target) || 0;

      if (current >= target) {
        const claimed = await goalRepository.claimAchieved(goal._id, bounds.key, current);
        if (!claimed) continue;

        logJourneyStep({
          level: "info",
          requestId: requestId || null,
          service: config.serviceName,
          variant: config.variant,
          step: "goal_evaluated",
          userId: goal.userId,
          msg: `Goal reached: ${goal.type} (${current}/${target})`,
        });

        const notifications = notificationsModule || require("../notifications");
        try {
          await notifications.createNotification({
            userId: goal.userId,
            type: "GOAL_REACHED",
            title: "Goal Reached!",
            message: `Congratulations! You reached your ${period} goal of ${target} ${strategy ? strategy.unit : goal.type}!`,
            goalId: String(goal._id),
            periodKey: bounds.key,
            requestId,
          });
        } catch (err) {
          if (journeyFailures) {
            try {
              journeyFailures.inc({ step: "notification_created" });
            } catch (_) {}
          }
          if (!config.quiet) console.warn("Failed to create notification on goal reached:", err.message);
        }

        reached.push(claimed);
      } else {
        const stale = goal.achieved && goal.achievedPeriodKey !== bounds.key;
        currentUpdates.push({
          updateOne: {
            filter: { _id: goal._id },
            update: stale
              ? { $set: { achieved: false, achievedPeriodKey: null, current } }
              : { $set: { current } },
          },
        });
      }
    }

    if (currentUpdates.length > 0) {
      await goalRepository.bulkWrite(currentUpdates);
    }

    return reached;
  } catch (error) {
    if (journeyFailures) {
      try {
        journeyFailures.inc({ step: "goal_evaluated" });
      } catch (_) {}
    }
    logJourneyStep({
      level: "warn",
      requestId: requestId || null,
      service: config.serviceName,
      variant: config.variant,
      step: "goal_evaluated",
      userId,
      msg: `Goal evaluation failure: ${error.message}`,
    });
    return [];
  }
}

async function getGoalViewsForUser(userId) {
  const goals = await goalRepository.findGoalsForUser(userId);
  const telemetry = telemetryModule || require("../telemetry");

  const views = await Promise.all(
    goals.map(async (goal) => {
      const bounds = periodBounds(goal.period || "daily");
      const strategy = getStrategy(goal.type);
      const current = strategy
        ? await telemetry.sumActivity(goal.userId, strategy.field, bounds)
        : 0;
      return buildGoalView(goal, current, strategy ? strategy.unit : "");
    })
  );

  return sortGoalViews(views);
}

async function getActiveGoalViewsForUser(userId) {
  const views = await getGoalViewsForUser(userId);
  return views.filter((v) => v.status === "active");
}

// ----------------------------------------------------
// Express Routes
// ----------------------------------------------------
const router = express.Router();

// POST /api/goals
router.post("/goals", async (req, res) => {
  try {
    const { userId, type, target, period = "daily", startDate } = req.body;
    const errors = [];

    if (!userId) errors.push("userId is required");
    if (!type) {
      errors.push("type is required");
    } else if (!supportedGoalTypes().includes(type)) {
      errors.push(`Invalid type. Must be one of: ${supportedGoalTypes().join(", ")}`);
    }

    if (target === undefined || target === null) {
      errors.push("target is required");
    } else if (typeof target !== "number" || target <= 0) {
      errors.push("target must be a positive number");
    }

    if (period && !["daily", "weekly"].includes(period)) {
      errors.push("period must be either daily or weekly");
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors.join(". "),
        errors,
      });
    }

    // Check duplicate active goal
    const existing = await goalRepository.findActiveGoal(userId, type, period);
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_GOAL",
        message: `You already have an active ${period} ${type} goal. Update that goal instead of creating a duplicate.`,
        goal: existing,
      });
    }

    const goal = await goalRepository.create({
      userId,
      type,
      target,
      period,
      startDate: startDate ? new Date(startDate) : new Date(),
    });

    await cache.del(`dashboard:${userId}`);

    // Initial evaluation against existing activity
    await evaluateGoals(userId, req.requestId);

    const freshGoal = await goalRepository.findById(goal._id);
    res.status(200).json({ success: true, goal: freshGoal || goal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/goals/:userId
router.get("/goals/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const views = await getGoalViewsForUser(userId);
    res.json({ success: true, goals: views, count: views.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/goals/:userId/active
router.get("/goals/:userId/active", async (req, res) => {
  try {
    const { userId } = req.params;
    const views = await getActiveGoalViewsForUser(userId);
    res.json({ success: true, goals: views, count: views.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/goals/:goalId
router.put("/goals/:goalId", async (req, res) => {
  try {
    const { goalId } = req.params;
    const goal = await goalRepository.findById(goalId);
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    const { target, period, type, startDate, endDate, active } = req.body;
    const updates = {};

    if (target !== undefined) {
      if (typeof target !== "number" || target <= 0) {
        return res.status(400).json({ success: false, message: "target must be a positive number" });
      }
      updates.target = target;
    }

    if (period !== undefined) {
      if (!["daily", "weekly"].includes(period)) {
        return res.status(400).json({ success: false, message: "period must be daily or weekly" });
      }
      updates.period = period;
    }

    if (type !== undefined) {
      if (!supportedGoalTypes().includes(type)) {
        return res.status(400).json({ success: false, message: `Invalid type. Must be one of: ${supportedGoalTypes().join(", ")}` });
      }
      updates.type = type;
    }

    if (startDate !== undefined) updates.startDate = new Date(startDate);
    if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : null;
    if (active !== undefined) updates.active = Boolean(active);

    // If definition changed, reset progress
    if (updates.target || updates.period || updates.type) {
      updates.achieved = false;
      updates.achievedPeriodKey = null;
      updates.current = 0;
    }

    const updated = await goalRepository.updateGoal(goalId, updates);
    await cache.del(`dashboard:${goal.userId}`);

    res.json({ success: true, goal: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/goals/:goalId/complete
router.post("/goals/:goalId/complete", async (req, res) => {
  try {
    const { goalId } = req.params;
    const goal = await goalRepository.findById(goalId);
    if (!goal) {
      return res.status(404).json({ success: false, message: "Goal not found" });
    }

    const bounds = periodBounds(goal.period || "daily");
    const updated = await goalRepository.updateGoal(goalId, {
      achieved: true,
      achievedPeriodKey: bounds.key,
      current: Math.max(goal.current || 0, goal.target),
      lastAchievedAt: new Date(),
    });

    await cache.del(`dashboard:${goal.userId}`);

    res.json({ success: true, goal: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = {
  evaluateGoals,
  getGoalViewsForUser,
  getActiveGoalViewsForUser,
  setDependencies,
  routes: router,
};
