const mongoose = require("mongoose");
const Goal = require("../models/Goal");
const cache = require("../utils/cache");
const { memStore } = require("./dashboardController");
const {
  evaluateGoals,
  getGoalCurrent,
  buildGoalView,
  sortGoalViews,
  GOAL_TYPES,
  GOAL_PERIODS,
  periodBounds,
} = require("../utils/goalProgress");
const { createGoalReachedNotification } = require("../utils/goalNotifications");

const QUIET = process.env.QUIET === "1";

function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

async function invalidateDashboardCache(userId) {
  if (!userId) return;
  await cache.del(`dashboard:${userId}`);
}

async function evaluateForUser(userId) {
  await evaluateGoals({
    userId,
    onReached: async (payload) => {
      await createGoalReachedNotification(payload);
      await invalidateDashboardCache(payload.userId);
    },
  });
}

function validateGoalPayload(body = {}) {
  const errors = [];
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim().toLowerCase() : "";
  const period = body.period ? String(body.period).trim().toLowerCase() : "daily";
  const rawTarget = body.target;
  const target = typeof rawTarget === "number" ? rawTarget : Number(String(rawTarget ?? "").trim());

  if (!userId) errors.push("User ID is required.");
  if (!GOAL_TYPES.includes(type)) {
    errors.push(`Goal type must be one of: ${GOAL_TYPES.join(", ")}.`);
  }
  if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === "" || !Number.isFinite(target)) {
    errors.push("Target value must be a positive number.");
  } else if (target <= 0) {
    errors.push("Target value must be a positive number.");
  }
  if (!GOAL_PERIODS.includes(period)) {
    errors.push("Goal period must be daily or weekly.");
  }

  let startDate = null;
  if (body.startDate !== undefined && body.startDate !== null && String(body.startDate).trim() !== "") {
    const parsed = new Date(body.startDate);
    if (Number.isNaN(parsed.getTime())) {
      errors.push("Start date is not a valid date.");
    } else {
      startDate = parsed;
    }
  }

  return { errors, data: { userId, type, target, period, startDate } };
}

function findMemoryGoal(goalId) {
  return memStore.goals.find((g) => String(g._id) === String(goalId)) || null;
}

function memoryCurrent(goal) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const entries = memStore.fitnessData.filter(
    (e) => e.userId === goal.userId && new Date(e.date).getTime() >= today.getTime()
  );
  switch (goal.type) {
    case "steps":
      return entries.reduce((sum, e) => sum + (e.totalSteps || 0), 0);
    case "calories":
      return entries.reduce((sum, e) => sum + (e.calories || 0), 0);
    case "distance":
      return entries.reduce((sum, e) => sum + (e.totalDistance || 0), 0);
    default:
      return 0;
  }
}

// ----------------------------------------------------
// POST /api/goals — create a new fitness goal
// ----------------------------------------------------
const createGoal = async (req, res) => {
  try {
    const { errors, data } = validateGoalPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join(" "), errors });
    }

    const { userId, type, target, period, startDate } = data;

    if (!isDBConnected()) {
      const duplicate = memStore.goals.find(
        (g) => g.userId === userId && g.type === type && (g.period || "daily") === period && g.active !== false
      );
      if (duplicate) {
        return res.status(409).json({
          success: false,
          code: "DUPLICATE_GOAL",
          message: `You already have an active ${period} ${type} goal. Update that goal instead of creating a duplicate.`,
          goal: duplicate,
        });
      }
      const memoryGoal = {
        _id: `mem_goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        userId,
        type,
        target,
        period,
        startDate: startDate || new Date(),
        current: 0,
        achieved: false,
        active: true,
        createdAt: new Date(),
      };
      memStore.goals.push(memoryGoal);
      if (!QUIET) console.log(`[GOAL CREATED][memory] ${period} ${type} goal (${target}) for ${userId}`);
      return res.status(200).json({ success: true, goal: memoryGoal });
    }

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

    // Activity logged before the goal existed still counts towards it
    await evaluateForUser(userId);
    goal = (await Goal.findById(goal._id)) || goal;
    await invalidateDashboardCache(userId);

    if (!QUIET) console.log(`🎯 [GOAL CREATED] ${period} ${type} goal (${target}) for user ${userId}`);
    return res.status(200).json({ success: true, goal });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// GET /api/goals/:userId — all goals for a user
// ----------------------------------------------------
const getGoals = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

    if (!isDBConnected()) {
      const views = memStore.goals
        .filter((g) => g.userId === userId && g.active !== false)
        .map((g) => buildGoalView(g, memoryCurrent(g)));
      return res.json({ success: true, goals: sortGoalViews(views), count: views.length });
    }

    const goals = await Goal.find({ userId, active: { $ne: false } });
    const views = [];
    for (const goal of goals) {
      views.push(buildGoalView(goal, await getGoalCurrent(goal)));
    }

    return res.json({ success: true, goals: sortGoalViews(views), count: views.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// GET /api/goals/:userId/active — goals still in progress
// ----------------------------------------------------
const getActiveGoals = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });

    if (!isDBConnected()) {
      const views = memStore.goals
        .filter((g) => g.userId === userId && g.active !== false)
        .map((g) => buildGoalView(g, memoryCurrent(g)))
        .filter((view) => view.status === "active");
      return res.json({ success: true, goals: sortGoalViews(views), count: views.length });
    }

    const goals = await Goal.find({ userId, active: { $ne: false } });
    const views = [];
    for (const goal of goals) {
      const view = buildGoalView(goal, await getGoalCurrent(goal));
      if (view.status === "active") views.push(view);
    }

    return res.json({ success: true, goals: sortGoalViews(views), count: views.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// PUT /api/goals/:goalId — update / deactivate a goal
// ----------------------------------------------------
const updateGoal = async (req, res) => {
  try {
    const { goalId } = req.params;
    const { body = {} } = req;

    if (!isDBConnected()) {
      const goal = findMemoryGoal(goalId);
      if (!goal) return res.status(404).json({ success: false, message: "Goal not found" });
      if (body.target !== undefined) {
        const target = Number(body.target);
        if (!Number.isFinite(target) || target <= 0) {
          return res.status(400).json({ success: false, message: "Target value must be a positive number." });
        }
        goal.target = target;
        goal.achieved = false;
      }
      if (body.period !== undefined) {
        const period = String(body.period).trim().toLowerCase();
        if (!GOAL_PERIODS.includes(period)) {
          return res.status(400).json({ success: false, message: "Goal period must be daily or weekly." });
        }
        goal.period = period;
        goal.achieved = false;
      }
      if (body.active !== undefined) goal.active = Boolean(body.active);
      await invalidateDashboardCache(goal.userId);
      return res.json({ success: true, goal });
    }

    const goal = await Goal.findById(goalId);
    if (!goal) return res.status(404).json({ success: false, message: "Goal not found" });

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
      if (!GOAL_PERIODS.includes(period)) {
        return res.status(400).json({ success: false, message: "Goal period must be daily or weekly." });
      }
      if (period !== goal.period) definitionChanged = true;
      goal.period = period;
    }

    if (body.type !== undefined) {
      const type = String(body.type).trim().toLowerCase();
      if (!GOAL_TYPES.includes(type)) {
        return res.status(400).json({ success: false, message: `Goal type must be one of: ${GOAL_TYPES.join(", ")}.` });
      }
      if (type !== goal.type) definitionChanged = true;
      goal.type = type;
    }

    if (body.startDate !== undefined && body.startDate !== null && String(body.startDate).trim() !== "") {
      const parsed = new Date(body.startDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: "Start date is not a valid date." });
      }
      goal.startDate = parsed;
    }

    if (body.endDate !== undefined) {
      if (body.endDate === null || body.endDate === "") {
        goal.endDate = null;
      } else {
        const parsed = new Date(body.endDate);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ success: false, message: "End date is not a valid date." });
        }
        goal.endDate = parsed;
      }
    }

    if (body.active !== undefined) {
      goal.active = Boolean(body.active);
    }

    if (definitionChanged) {
      goal.achieved = false;
      goal.achievedPeriodKey = null;
      goal.current = 0;
    }

    await goal.save();

    if (!definitionChanged) {
      await evaluateForUser(goal.userId);
    }
    const fresh = (await Goal.findById(goal._id)) || goal;
    await invalidateDashboardCache(goal.userId);

    return res.json({ success: true, goal: fresh });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// POST /api/goals/:goalId/complete — mark a goal completed
// ----------------------------------------------------
const completeGoal = async (req, res) => {
  try {
    const { goalId } = req.params;

    if (!isDBConnected()) {
      const goal = findMemoryGoal(goalId);
      if (!goal) return res.status(404).json({ success: false, message: "Goal not found" });
      goal.achieved = true;
      goal.current = Math.max(goal.current || 0, goal.target);
      await invalidateDashboardCache(goal.userId);
      return res.json({ success: true, goal });
    }

    const goal = await Goal.findById(goalId);
    if (!goal) return res.status(404).json({ success: false, message: "Goal not found" });

    const current = await getGoalCurrent(goal);
    const bounds = periodBounds(goal.period || "daily");

    goal.achieved = true;
    goal.achievedPeriodKey = bounds.key;
    goal.current = Math.max(current, Number(goal.target) || 0);
    goal.lastAchievedAt = new Date();
    goal.active = true;
    await goal.save();

    await invalidateDashboardCache(goal.userId);
    return res.json({ success: true, goal });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createGoal,
  getGoals,
  getActiveGoals,
  updateGoal,
  completeGoal,
};
