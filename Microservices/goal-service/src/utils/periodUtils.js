const GOAL_TYPES = ["steps", "calories", "distance"];
const GOAL_PERIODS = ["daily", "weekly"];
const TYPE_FIELD = { steps: "totalSteps", calories: "calories", distance: "totalDistance" };
const TYPE_UNIT = { steps: "steps", calories: "calories", distance: "km" };

const pad2 = (value) => String(value).padStart(2, "0");
const capitalize = (value) => String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);

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

function goalPeriodKey(goal, ref = new Date()) {
  return periodBounds(goal.period || "daily", ref).key;
}

function goalStarted(goal, ref = new Date()) {
  if (!goal.startDate) return true;
  return new Date(goal.startDate).getTime() <= periodBounds("daily", ref).end.getTime();
}

function isGoalCompletedForPeriod(goal, ref = new Date()) {
  return Boolean(goal.achieved && goal.achievedPeriodKey === goalPeriodKey(goal, ref));
}

function buildGoalView(goal, current) {
  const target = Number(goal.target) || 0;
  const period = goal.period || "daily";
  const completed = Boolean(goal.achieved && goal.achievedPeriodKey === periodBounds(period).key);
  const currentValue = Math.max(0, Math.round((Number(current) || 0) * 100) / 100);
  const reached = completed || (target > 0 && currentValue >= target);
  const percentage = target > 0 ? Math.min(100, Math.round((currentValue / target) * 100)) : 0;

  return {
    goalId: goal._id ? String(goal._id) : null,
    type: goal.type,
    period,
    target,
    current: currentValue,
    percentage,
    remaining: Math.max(0, Math.round((target - currentValue) * 100) / 100),
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
  TYPE_FIELD,
  TYPE_UNIT,
  capitalize,
  periodBounds,
  goalPeriodKey,
  goalStarted,
  isGoalCompletedForPeriod,
  buildGoalView,
  sortGoalViews,
};
