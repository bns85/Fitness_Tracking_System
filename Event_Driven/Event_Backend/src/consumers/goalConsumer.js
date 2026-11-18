const { eventBus, EVENTS } = require("../utils/eventBus");
const FitnessData = require("../models/FitnessData");
const Notification = require("../models/Notification");
const cache = require("../utils/cache");
const { evaluateGoals, capitalize, TYPE_UNIT } = require("../utils/goalProgress");

const QUIET = process.env.QUIET === "1";
let isInitialized = false;

function buildGoalReachedNotification(payload) {
  const { goalType, period = "daily", target, unit } = payload;
  const resolvedUnit = unit || TYPE_UNIT[goalType] || "";
  return {
    userId: payload.userId,
    type: "GOAL_REACHED",
    title: `🎉 ${capitalize(period)} ${capitalize(goalType)} Goal Achieved!`,
    message: `Congratulations! You reached your ${period} goal of ${Number(target).toLocaleString()} ${resolvedUnit}.`,
    read: false,
    goalId: payload.goalId,
    periodKey: payload.periodKey,
  };
}

function initGoalConsumers() {
  if (isInitialized) return;
  isInitialized = true;
  if (!QUIET) console.log("🚀 [EVENT CONSUMER] Initializing Step & Goal Event Listeners...");

  // ----------------------------------------------------
  // 1. Consumer: STEP_UPDATED Listener
  // ----------------------------------------------------
  eventBus.on(EVENTS.STEP_UPDATED, async (data) => {
    try {
      const { userId, steps, calories = 0, distance = 0 } = data;
      if (!QUIET) console.log(`📡 [EVENT CONSUMER] STEP_UPDATED received for user ${userId}: +${steps} steps`);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Invalidate Cache for this user so next dashboard read gets latest numbers (CQRS Cache-Aside)
      const cacheKey = `dashboard:${userId}:${today.toISOString().slice(0, 10)}`;
      await cache.del(cacheKey);
      await cache.del(`dashboard:${userId}`);

      // Update or create today's fitness record atomically in DB
      const fitnessRecord = await FitnessData.findOneAndUpdate(
        { userId, date: { $gte: today } },
        {
          $inc: { totalSteps: steps, calories: calories, totalDistance: distance },
          $setOnInsert: { userId, date: today },
        },
        { upsert: true, new: true }
      );

      if (!QUIET) console.log(`📊 [FITNESS AGGREGATE] Total steps today for ${userId}: ${fitnessRecord.totalSteps}`);

      // Evaluate every active goal (steps / calories / distance, daily / weekly)
      // against the real activity record. GOAL_REACHED is emitted at most once
      // per goal per period (atomic claim inside evaluateGoals).
      await evaluateGoals({
        userId,
        onReached: async (payload) => {
          eventBus.publish(EVENTS.GOAL_REACHED, payload);
        },
      });

      // Re-invalidate after goal evaluation so goal status is never served stale
      await cache.del(cacheKey);
      await cache.del(`dashboard:${userId}`);
    } catch (error) {
      console.error("❌ Error in STEP_UPDATED consumer:", error.message);
    }
  });

  // ----------------------------------------------------
  // 2. Consumer: GOAL_REACHED Listener (Auto-Notification)
  // ----------------------------------------------------
  eventBus.on(EVENTS.GOAL_REACHED, async (data) => {
    try {
      const { userId, goalId, periodKey, target, current } = data;
      if (!QUIET) console.log(`🔔 [NOTIFICATION CONSUMER] Creating alert for user ${userId}...`);

      // De-duplication: exactly one notification per goal per goal period
      if (goalId && periodKey) {
        const existing = await Notification.findOne({
          userId,
          type: "GOAL_REACHED",
          goalId,
          periodKey,
        });
        if (existing) {
          if (!QUIET) console.log(`⏭️ [NOTIFICATION CONSUMER] Goal ${goalId} already notified for ${periodKey}, skipping duplicate`);
          return;
        }
      }

      const newNotification = await Notification.create(
        buildGoalReachedNotification(data)
      );

      if (!QUIET) console.log(`✅ [NOTIFICATION CREATED] ID: ${newNotification._id}`);

      // Publish NOTIFICATION_CREATED event for real-time SSE push
      eventBus.publish(EVENTS.NOTIFICATION_CREATED, {
        userId,
        notification: newNotification,
      });

      if (!QUIET && current !== undefined) {
        console.log(`🎯 [GOAL ACHIEVED] User ${userId}: ${current} / ${target}`);
      }
    } catch (error) {
      console.error("❌ Error in GOAL_REACHED consumer:", error.message);
    }
  });
}

module.exports = { initGoalConsumers, buildGoalReachedNotification };
