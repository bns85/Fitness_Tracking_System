const Goal = require("../models/Goal");
const { requestJson } = require("../../../shared/httpClient");
const { journeyFailures } = require("../../../shared/metrics");
const { logJourneyStep } = require("../../../shared/logger");
const { evaluateGoals, getCurrentForGoal, getGoalViews } = require("../services/goalService");
const { GOAL_TYPES, GOAL_PERIODS, periodBounds } = require("../utils/periodUtils");

function validateGoalPayload(body = {}) {
  const errors = [];
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim().toLowerCase() : "";
  const period = body.period ? String(body.period).trim().toLowerCase() : "daily";
  const rawTarget = body.target;
  const target = typeof rawTarget === "number" ? rawTarget : Number(String(rawTarget ?? "").trim());

  if (!userId) errors.push("User ID is required.");
  if (!GOAL_TYPES.includes(type)) errors.push(`Goal type must be one of: ${GOAL_TYPES.join(", ")}.`);
  if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === "" || !Number.isFinite(target) || target <= 0) {
    errors.push("Target value must be a positive number.");
  }
  if (!GOAL_PERIODS.includes(period)) errors.push("Goal period must be daily or weekly.");

  let startDate = null;
  if (body.startDate !== undefined && body.startDate !== null && String(body.startDate).trim() !== "") {
    const parsed = new Date(body.startDate);
    if (Number.isNaN(parsed.getTime())) errors.push("Start date is not a valid date.");
    else startDate = parsed;
  }
  return { errors, data: { userId, type, target, period, startDate } };
}

async function invalidateDashboard(userId, requestId) {
  try {
    await requestJson(`http://telemetry-service:5022/internal/dashboard/${encodeURIComponent(userId)}/cache`, {
      method: "DELETE",
      from: "goal",
      to: "telemetry",
      requestId,
    });
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId,
      service: "goal",
      variant: "micro",
      userId,
      msg: `Dashboard cache invalidation failed: ${error.message}`,
    }));
  }
}

async function evaluateBestEffort(userId, requestId) {
  try {
    await evaluateGoals(userId, requestId);
  } catch (error) {
    journeyFailures.inc({ step: "goal_evaluated" });
    logJourneyStep({
      level: "error",
      requestId,
      service: "goal",
      step: "goal_evaluated",
      userId,
      msg: `Goal evaluation failed: ${error.message}`,
    });
  }
}

async function createGoal(req, res) {
  const { errors, data } = validateGoalPayload(req.body || {});
  if (errors.length) return res.status(400).json({ success: false, message: errors.join(" "), errors });

  try {
    const { userId, type, target, period, startDate } = data;
    const duplicate = await Goal.findOne({
      userId,
      type,
      period: { $in: [period, null] },
      active: { $ne: false },
    });
    if (duplicate) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_GOAL",
        message: `You already have an active ${period} ${type} goal. Update that goal instead of creating a duplicate.`,
        goal: duplicate,
      });
    }

    let goal = await Goal.create({
      userId,
      type,
      target,
      period,
      startDate: startDate || new Date(),
      current: 0,
      achieved: false,
      achievedPeriodKey: null,
      active: true,
    });
    await evaluateBestEffort(userId, req.requestId);
    goal = (await Goal.findById(goal._id)) || goal;
    await invalidateDashboard(userId, req.requestId);
    return res.status(200).json({ success: true, goal });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function listGoals(req, res) {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
  try {
    const goals = await getGoalViews(userId, req.requestId);
    return res.json({ success: true, goals, count: goals.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function listActiveGoals(req, res) {
  const { userId } = req.params;
  if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
  try {
    const allGoals = await getGoalViews(userId, req.requestId);
    const goals = allGoals.filter((goal) => goal.status === "active");
    return res.json({ success: true, goals, count: goals.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function updateGoal(req, res) {
  try {
    const goal = await Goal.findById(req.params.goalId);
    if (!goal) return res.status(404).json({ success: false, message: "Goal not found" });
    const body = req.body || {};
    let definitionChanged = false;

    if (body.target !== undefined) {
      const target = Number(body.target);
      if (!Number.isFinite(target) || target <= 0) {
        return res.status(400).json({ success: false, message: "Target value must be a positive number." });
      }
      if (target !== goal.target) definitionChanged = true;
      goal.target = target;
    }
    if (body.period !== undefined) {
      const period = String(body.period).trim().toLowerCase();
      if (!GOAL_PERIODS.includes(period)) return res.status(400).json({ success: false, message: "Goal period must be daily or weekly." });
      if (period !== goal.period) definitionChanged = true;
      goal.period = period;
    }
    if (body.type !== undefined) {
      const type = String(body.type).trim().toLowerCase();
      if (!GOAL_TYPES.includes(type)) return res.status(400).json({ success: false, message: `Goal type must be one of: ${GOAL_TYPES.join(", ")}.` });
      if (type !== goal.type) definitionChanged = true;
      goal.type = type;
    }
    if (body.startDate !== undefined && body.startDate !== null && String(body.startDate).trim() !== "") {
      const parsed = new Date(body.startDate);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ success: false, message: "Start date is not a valid date." });
      goal.startDate = parsed;
    }
    if (body.endDate !== undefined) {
      if (body.endDate === null || body.endDate === "") goal.endDate = null;
      else {
        const parsed = new Date(body.endDate);
        if (Number.isNaN(parsed.getTime())) return res.status(400).json({ success: false, message: "End date is not a valid date." });
        goal.endDate = parsed;
      }
    }
    if (body.active !== undefined) goal.active = Boolean(body.active);
    if (definitionChanged) {
      goal.achieved = false;
      goal.achievedPeriodKey = null;
      goal.current = 0;
    }

    await goal.save();
    if (!definitionChanged) await evaluateBestEffort(goal.userId, req.requestId);
    const fresh = (await Goal.findById(goal._id)) || goal;
    await invalidateDashboard(goal.userId, req.requestId);
    return res.json({ success: true, goal: fresh });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function completeGoal(req, res) {
  try {
    const goal = await Goal.findById(req.params.goalId);
    if (!goal) return res.status(404).json({ success: false, message: "Goal not found" });
    const current = await getCurrentForGoal(goal, req.requestId);
    const bounds = periodBounds(goal.period || "daily");
    goal.achieved = true;
    goal.achievedPeriodKey = bounds.key;
    goal.current = Math.max(current, Number(goal.target) || 0);
    goal.lastAchievedAt = new Date();
    goal.active = true;
    await goal.save();
    await invalidateDashboard(goal.userId, req.requestId);
    return res.json({ success: true, goal });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function evaluateInternal(req, res) {
  const userId = req.params.userId;
  try {
    await evaluateGoals(userId, req.requestId);
    return res.json({ success: true });
  } catch (error) {
    journeyFailures.inc({ step: "goal_evaluated" });
    logJourneyStep({
      level: "error",
      requestId: req.requestId,
      service: "goal",
      step: "goal_evaluated",
      userId,
      msg: `Goal evaluation failed: ${error.message}`,
    });
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function internalGoals(req, res) {
  try {
    const goals = await getGoalViews(req.params.userId, req.requestId);
    return res.json({ goals });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  createGoal,
  listGoals,
  listActiveGoals,
  updateGoal,
  completeGoal,
  evaluateInternal,
  internalGoals,
};
