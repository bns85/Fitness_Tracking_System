const Notification = require("../models/Notification");
const { capitalize, TYPE_UNIT } = require("./goalProgress");

const QUIET = process.env.QUIET === "1";

/**
 * Create a GOAL_REACHED notification for a goal payload.
 * Returns null when a notification for this goal + period already exists,
 * which guarantees exactly one notification per goal per period.
 */
async function createGoalReachedNotification(payload) {
  const { userId, goalId, goalType, period = "daily", periodKey, target, unit } = payload;
  const resolvedUnit = unit || TYPE_UNIT[goalType] || "";

  if (goalId && periodKey) {
    const existing = await Notification.findOne({
      userId,
      type: "GOAL_REACHED",
      goalId,
      periodKey,
    });
    if (existing) {
      if (!QUIET) console.log(`[GOAL NOTIFY] Duplicate suppressed for goal ${goalId} (${periodKey})`);
      return null;
    }
  }

  const notification = await Notification.create({
    userId,
    type: "GOAL_REACHED",
    title: `🎉 ${capitalize(period)} ${capitalize(goalType)} Goal Achieved!`,
    message: `Congratulations! You reached your ${period} goal of ${Number(target).toLocaleString()} ${resolvedUnit}.`,
    read: false,
    goalId,
    periodKey,
  });

  if (!QUIET) console.log(`[GOAL NOTIFY] Created GOAL_REACHED notification for ${userId} (${period} ${goalType})`);
  return notification;
}

module.exports = { createGoalReachedNotification };
