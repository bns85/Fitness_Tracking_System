const Goal = require("../models/Goal");
const FitnessData = require("../models/FitnessData");
const burnCpu = require("./burnCpu");

const GOAL_TYPES = ["steps", "calories", "distance"];
const GOAL_PERIODS = ["daily", "weekly"];

const TYPE_FIELD = { steps: "totalSteps", calories: "calories", distance: "totalDistance" };
const TYPE_UNIT = { steps: "steps", calories: "calories", distance: "km" };

const pad2 = (n) => String(n).padStart(2, "0");
const capitalize = (value) => String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);

// ---------------------------------------------------------------------------
// Period helpers: daily = local calendar day, weekly = local Mon..Sun week
// ---------------------------------------------------------------------------
function periodBounds(period = "daily", ref = new Date()) {
  const start = new Date(ref);
  start.setHours(0, 0, 0, 0);

  if (period === "weekly") {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end, key: isoWeekKey(start) };
  }

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start,
    end,
    key: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`,
  };
}

// ISO-8601 week key (YYYY-Www) derived from the Monday that starts the week
function isoWeekKey(mondayStart) {
  const thursday = new Date(mondayStart);
  thursday.setHours(12, 0, 0, 0);
  thursday.setDate(thursday.getDate() + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4, 12, 0, 0, 0);
  const firstDayOffset = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayOffset + 3);
  const week = 1 + Math.round((thursday - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${thursday.getFullYear()}-W${pad2(week)}`;
}

function currentPeriodKeys(ref = new Date()) {
  return [periodBounds("daily", ref).key, periodBounds("weekly", ref).key];
}

// ---------------------------------------------------------------------------
// Activity aggregation for a goal type inside a period window
// ---------------------------------------------------------------------------
async function sumActivity(userId, type, bounds) {
  const field = TYPE_FIELD[type];
  if (!field || !userId) return 0;
  const docs = await FitnessData.find(
    { userId, date: { $gte: bounds.start, $lt: bounds.end } },
    { [field]: 1 }
  );
  return docs.reduce((sum, doc) => sum + (Number(doc[field]) || 0), 0);
}

// ---------------------------------------------------------------------------
// Activity totals for every user inside a period window (bulk, 1 aggregation)
// ---------------------------------------------------------------------------
async function activityTotalsByUser(bounds, userId) {
  const match = { date: { $gte: bounds.start, $lt: bounds.end } };
  if (userId) match.userId = userId;
  const rows = await FitnessData.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$userId",
        totalSteps: { $sum: "$totalSteps" },
        calories: { $sum: "$calories" },
        totalDistance: { $sum: "$totalDistance" },
      },
    },
  ]);
  const map = new Map();
  for (const row of rows) map.set(String(row._id), row);
  return map;
}

async function getGoalCurrent(goal) {
  const period = goal.period || "daily";
  return sumActivity(goal.userId, goal.type, periodBounds(period));
}

function goalPeriodKey(goal, ref = new Date()) {
  return periodBounds(goal.period || "daily", ref).key;
}

function isGoalCompletedForPeriod(goal, ref = new Date()) {
  return Boolean(goal.achieved && goal.achievedPeriodKey === goalPeriodKey(goal, ref));
}

function goalStarted(goal, ref = new Date()) {
  if (!goal.startDate) return true;
  const endOfToday = periodBounds("daily", ref).end;
  return new Date(goal.startDate).getTime() <= endOfToday.getTime();
}

// ---------------------------------------------------------------------------
// Evaluate active goals against real activity data.
// Calls onReached(payload) exactly once per goal per period (atomic claim).
// Activity is fetched in bulk (one aggregation per period) so cycles stay fast
// even with thousands of goals.
// ---------------------------------------------------------------------------
async function evaluateGoals({ userId, onReached } = {}) {
  const [dailyKey, weeklyKey] = currentPeriodKeys();
  const filter = {
    ...(userId ? { userId } : {}),
    active: { $ne: false },
    $or: [{ achieved: false }, { achievedPeriodKey: { $nin: [dailyKey, weeklyKey] } }],
  };

  const goals = await Goal.find(filter).lean();
  if (!goals.length) return [];

  // Consistent compute simulation: called exactly ONCE per goal evaluation
  const goalCpuMs = Number(process.env.GOAL_CPU_MS || 0);
  if (goalCpuMs > 0) {
    burnCpu(goalCpuMs);
  }

  const dailyBounds = periodBounds("daily");
  const weeklyBounds = periodBounds("weekly");
  const [dailyTotals, weeklyTotals] = await Promise.all([
    activityTotalsByUser(dailyBounds, userId),
    activityTotalsByUser(weeklyBounds, userId),
  ]);

  const reached = [];
  const currentUpdates = [];

  for (const goal of goals) {
    if (!goalStarted(goal)) continue;
    if (isGoalCompletedForPeriod(goal)) continue;

    const period = goal.period || "daily";
    const isWeekly = period === "weekly";
    const bounds = isWeekly ? weeklyBounds : dailyBounds;
    const totals = (isWeekly ? weeklyTotals : dailyTotals).get(String(goal.userId));
    const field = TYPE_FIELD[goal.type];
    const current = totals && field ? Number(totals[field]) || 0 : 0;
    const target = Number(goal.target) || 0;

    if (current >= target) {
      const claimed = await Goal.findOneAndUpdate(
        { _id: goal._id, achievedPeriodKey: { $ne: bounds.key } },
        {
          $set: {
            achieved: true,
            achievedPeriodKey: bounds.key,
            current,
            lastAchievedAt: new Date(),
          },
        },
        { new: true }
      );

      if (!claimed) continue;

      const payload = {
        userId: goal.userId,
        goalId: String(goal._id),
        goalType: goal.type,
        type: goal.type,
        period,
        periodKey: bounds.key,
        target,
        current,
        unit: TYPE_UNIT[goal.type] || "",
      };
      reached.push(payload);
      if (onReached) await onReached(payload);
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

  if (currentUpdates.length) {
    await Goal.bulkWrite(currentUpdates, { ordered: false });
  }

  return reached;
}

// ---------------------------------------------------------------------------
// Read-only projection used by dashboard / goal APIs
// ---------------------------------------------------------------------------
function buildGoalView(goal, current) {
  const target = Number(goal.target) || 0;
  const period = goal.period || "daily";
  const { key } = periodBounds(period);
  const completed = Boolean(goal.achieved && goal.achievedPeriodKey === key);
  const currentVal = Math.max(0, Math.round((Number(current) || 0) * 100) / 100);
  const reached = completed || (target > 0 && currentVal >= target);
  const percentage = target > 0 ? Math.min(100, Math.round((currentVal / target) * 100)) : 0;

  return {
    goalId: goal._id ? String(goal._id) : null,
    type: goal.type,
    period,
    target,
    current: currentVal,
    percentage,
    remaining: Math.max(0, Math.round((target - currentVal) * 100) / 100),
    achieved: reached,
    status: reached ? "completed" : "active",
    active: goal.active !== false,
    unit: TYPE_UNIT[goal.type] || "",
    startDate: goal.startDate || null,
    endDate: goal.endDate || null,
  };
}

function sortGoalViews(views) {
  return views.sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === "active" ? -1 : 1;
  });
}

module.exports = {
  GOAL_TYPES,
  GOAL_PERIODS,
  TYPE_UNIT,
  capitalize,
  periodBounds,
  currentPeriodKeys,
  sumActivity,
  getGoalCurrent,
  goalPeriodKey,
  isGoalCompletedForPeriod,
  evaluateGoals,
  buildGoalView,
  sortGoalViews,
};
