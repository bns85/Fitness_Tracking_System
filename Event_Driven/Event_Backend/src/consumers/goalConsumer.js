const { eventBus, EVENTS } = require("../utils/eventBus");
const Goal = require("../models/Goal");
const FitnessData = require("../models/FitnessData");
const Notification = require("../models/Notification");
const cache = require("../utils/cache");

let isInitialized = false;

function initGoalConsumers() {
  if (isInitialized) return;
  isInitialized = true;
  console.log("🚀 [EVENT CONSUMER] Initializing Step & Goal Event Listeners...");

  // ----------------------------------------------------
  // 1. Consumer: STEP_UPDATED Listener
  // ----------------------------------------------------
  eventBus.on(EVENTS.STEP_UPDATED, async (data) => {
    try {
      const { userId, steps, calories = 0, distance = 0 } = data;
      console.log(`📡 [EVENT CONSUMER] STEP_UPDATED received for user ${userId}: +${steps} steps`);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Invalidate Cache for this user so next dashboard read gets latest numbers (CQRS Cache-Aside)
      const cacheKey = `dashboard:${userId}:${today.toISOString().slice(0, 10)}`;
      await cache.del(cacheKey);

      // Update or create today's fitness record atomically in DB
      const fitnessRecord = await FitnessData.findOneAndUpdate(
        { userId, date: { $gte: today } },
        {
          $inc: { totalSteps: steps, calories: calories, totalDistance: distance },
          $setOnInsert: { userId, date: today },
        },
        { upsert: true, new: true }
      );

      const totalSteps = fitnessRecord.totalSteps;

      // Check active Step Goals for this user
      const activeGoals = await Goal.find({ userId, type: "steps", achieved: false });

      for (const goal of activeGoals) {
        goal.current = totalSteps;

        // Check if target is reached!
        if (totalSteps >= goal.target) {
          goal.achieved = true;
          await goal.save();

          console.log(`🎯 [GOAL ACHIEVED] User ${userId} reached ${totalSteps} / ${goal.target} steps!`);

          // Publish GOAL_REACHED event to Event Bus
          eventBus.publish(EVENTS.GOAL_REACHED, {
            userId,
            goalType: "steps",
            target: goal.target,
            current: totalSteps
          });
        } else {
          await goal.save();
        }
      }
    } catch (error) {
      console.error("❌ Error in STEP_UPDATED consumer:", error.message);
    }
  });

  // ----------------------------------------------------
  // 2. Consumer: GOAL_REACHED Listener (Auto-Notification)
  // ----------------------------------------------------
  eventBus.on(EVENTS.GOAL_REACHED, async (data) => {
    try {
      const { userId, target, current } = data;
      console.log(`🔔 [NOTIFICATION CONSUMER] Creating alert for user ${userId}...`);

      const newNotification = await Notification.create({
        userId,
        type: "GOAL_REACHED",
        title: "🎉 Daily Step Goal Achieved!",
        message: `Awesome job! You reached your goal of ${target.toLocaleString()} steps with ${current.toLocaleString()} steps today! 🏆`,
        read: false
      });

      console.log(`✅ [NOTIFICATION CREATED] ID: ${newNotification._id}`);

      // Publish NOTIFICATION_CREATED event for real-time SSE push
      eventBus.publish(EVENTS.NOTIFICATION_CREATED, {
        userId,
        notification: newNotification
      });
    } catch (error) {
      console.error("❌ Error in GOAL_REACHED consumer:", error.message);
    }
  });
}

module.exports = { initGoalConsumers };
