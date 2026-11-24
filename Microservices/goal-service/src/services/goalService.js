const Goal = require("../models/Goal");
const burnCpu = require("../../../shared/burnCpu");
const { requestJson } = require("../../../shared/httpClient");
const { journeyFailures } = require("../../../shared/metrics");
const { logJourneyStep } = require("../../../shared/logger");
const {
  GOAL_STRATEGIES,
  capitalize,
  periodBounds,
  goalStarted,
  isGoalCompletedForPeriod,
  buildGoalView,
  sortGoalViews,
} = require("../utils/periodUtils");

function failure(step, requestId, userId, message) {
  journeyFailures.inc({ step });
  logJourneyStep({
    level: "error",
    requestId,
    service: "goal",
    step,
    userId,
    msg: message,
  });
}

async function getPeriodTotals(userId, period, requestId) {
  const bounds = periodBounds(period);
  const query = new URLSearchParams({
    start: bounds.start.toISOString(),
    end: bounds.end.toISOString(),
  });
  const url = `http://telemetry-service:5022/internal/telemetry/activity/${encodeURIComponent(userId)}?${query}`;
  const totals = await requestJson(url, {
    method: "GET",
    from: "goal",
    to: "telemetry",
    requestId,
  });
  return { bounds, totals };
}

async function getCurrentForGoal(goal, requestId) {
  const { totals } = await getPeriodTotals(goal.userId, goal.period || "daily", requestId);
  const strategy = GOAL_STRATEGIES[goal.type];
  return strategy ? strategy.current(totals) : 0;
}

async function getGoalViews(userId, requestId) {
  const goals = await Goal.find({ userId, active: { $ne: false } });
  const pendingPeriodData = new Map();
  for (const goal of goals) {
    const period = goal.period || "daily";
    if (!pendingPeriodData.has(period)) {
      pendingPeriodData.set(period, getPeriodTotals(userId, period, requestId));
    }
  }
  const periodData = new Map(await Promise.all(
    Array.from(pendingPeriodData, async ([period, result]) => [period, await result])
  ));
  const views = goals.map((goal) => {
    const { totals } = periodData.get(goal.period || "daily");
    const strategy = GOAL_STRATEGIES[goal.type];
    return buildGoalView(goal, strategy ? strategy.current(totals) : 0);
  });
  return sortGoalViews(views);
}

function notificationBody(payload) {
  const period = payload.period || "daily";
  const type = payload.goalType;
  const unit = payload.unit || (GOAL_STRATEGIES[type] && GOAL_STRATEGIES[type].unit) || "";
  return {
    userId: payload.userId,
    type: "GOAL_REACHED",
    title: `🎉 ${capitalize(period)} ${capitalize(type)} Goal Achieved!`,
    message: `Congratulations! You reached your ${period} goal of ${Number(payload.target).toLocaleString()} ${unit}.`,
    goalId: payload.goalId,
    periodKey: payload.periodKey,
  };
}

async function evaluateGoals(userId, requestId) {
  const cpuMs = Number.parseInt(process.env.GOAL_CPU_MS || "10", 10);
  burnCpu(Number.isFinite(cpuMs) && cpuMs >= 0 ? cpuMs : 10);

  const [daily, weekly] = await Promise.all([
    getPeriodTotals(userId, "daily", requestId),
    getPeriodTotals(userId, "weekly", requestId),
  ]);
  const goals = await Goal.find({ userId, active: { $ne: false } }).lean();
  const updates = [];

  for (const goal of goals) {
    if (!goalStarted(goal) || isGoalCompletedForPeriod(goal)) continue;
    const period = goal.period || "daily";
    const periodData = period === "weekly" ? weekly : daily;
    const strategy = GOAL_STRATEGIES[goal.type];
    const current = strategy ? strategy.current(periodData.totals) : 0;
    const target = Number(goal.target) || 0;

    if (current >= target) {
      const claimed = await Goal.findOneAndUpdate(
        { _id: goal._id, achievedPeriodKey: { $ne: periodData.bounds.key } },
        {
          $set: {
            achieved: true,
            achievedPeriodKey: periodData.bounds.key,
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
        period,
        periodKey: periodData.bounds.key,
        target,
        current,
        unit: strategy ? strategy.unit : "",
      };
      try {
        await requestJson("http://notification-service:5024/internal/notifications", {
          method: "POST",
          body: notificationBody(payload),
          from: "goal",
          to: "notification",
          requestId,
        });
      } catch (error) {
        failure("notification_created", requestId, userId, `Notification creation failed: ${error.message}`);
      }
    } else {
      const stale = goal.achieved && goal.achievedPeriodKey !== periodData.bounds.key;
      updates.push({
        updateOne: {
          filter: { _id: goal._id },
          update: stale
            ? { $set: { achieved: false, achievedPeriodKey: null, current } }
            : { $set: { current } },
        },
      });
    }
  }

  if (updates.length) await Goal.bulkWrite(updates, { ordered: false });
  logJourneyStep({
    requestId,
    service: "goal",
    step: "goal_evaluated",
    userId,
    msg: `Evaluated ${goals.length} active goals`,
  });
}

module.exports = {
  evaluateGoals,
  getCurrentForGoal,
  getGoalViews,
};
