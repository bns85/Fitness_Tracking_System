const pad2 = (n) => String(n).padStart(2, "0");

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

function currentPeriodKeys(ref = new Date()) {
  return [periodBounds("daily", ref).key, periodBounds("weekly", ref).key];
}

function buildGoalView(goal, current, unit = "") {
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
    unit: unit || "",
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
  isoWeekKey,
  periodBounds,
  currentPeriodKeys,
  buildGoalView,
  sortGoalViews,
};
