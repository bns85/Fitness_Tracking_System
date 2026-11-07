const { eventBus, EVENTS } = require("../utils/eventBus");
const Workout = require("../models/Workout");
const Notification = require("../models/Notification");
const FitnessData = require("../models/FitnessData");
const Goal = require("../models/Goal");
const cache = require("../utils/cache");

let isInitialized = false;

const buildRecommendations = ({
  avgHeartRate = 0,
  caloriesBurned = 0,
  durationMinutes = 0,
}) => {
  const recommendations = [];

  if (avgHeartRate >= 150) {
    recommendations.push(
      "High cardiovascular strain detected. Ensure proper rehydration with electrolytes and prioritize 24h muscle recovery."
    );
  } else if (avgHeartRate >= 120) {
    recommendations.push(
      "Optimal aerobic fat-burn zone maintained! Great cardiovascular endurance session."
    );
  }

  if (caloriesBurned >= 400) {
    recommendations.push(
      "Outstanding calorie expenditure! Replenish with balanced carbohydrates and lean protein."
    );
  }

  if (durationMinutes > 0 && durationMinutes < 15) {
    recommendations.push(
      "Quick burst session completed. Consider extending tomorrow's routine to 30 minutes for endurance building."
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Solid session logged. Keep a consistent pace tomorrow to build on today's progress."
    );
  }

  return recommendations;
};

function initWorkoutConsumers() {
  if (isInitialized) return;
  isInitialized = true;
  console.log("🏋️ [EVENT CONSUMER] Initializing Workout Event Listeners...");

  // ----------------------------------------------------
  // 1. Recommendation Engine: WORKOUT_COMPLETED Listener
  // ----------------------------------------------------
  eventBus.on(EVENTS.WORKOUT_COMPLETED, async (data) => {
    try {
      const {
        workoutId,
        userId,
        durationMinutes = 0,
        caloriesBurned = 0,
        avgHeartRate = 0,
        steps = 0,
        distanceKm = 0,
      } = data;

      console.log(
        `🧠 [RECOMMENDATION ENGINE] Evaluating workout ${workoutId} for user ${userId}`
      );

      const recommendations = buildRecommendations({
        avgHeartRate,
        caloriesBurned,
        durationMinutes,
      });

      await Workout.findByIdAndUpdate(workoutId, { recommendations });

      // ----------------------------------------------------
      // Story 4: Aggregate into daily FitnessData & Invalidate Cache
      // ----------------------------------------------------
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const stepsToAdd = parseInt(steps, 10) || 0;
      const caloriesToAdd = Math.round(parseFloat(caloriesBurned)) || 0;
      const distanceToAdd = Math.round((parseFloat(distanceKm) || 0) * 100) / 100;
      const activeMinutesToAdd = Math.round(parseFloat(durationMinutes)) || 0;

      if (stepsToAdd > 0 || caloriesToAdd > 0 || activeMinutesToAdd > 0) {
        const updatedFitness = await FitnessData.findOneAndUpdate(
          { userId, date: { $gte: today } },
          {
            $inc: {
              totalSteps: stepsToAdd,
              calories: caloriesToAdd,
              totalDistance: distanceToAdd,
              veryActiveMinutes: activeMinutesToAdd,
            },
            $setOnInsert: { userId, date: today },
          },
          { upsert: true, new: true }
        );

        console.log(
          `📊 [FITNESS AGGREGATE] Updated daily fitness for user ${userId}: +${stepsToAdd} steps, +${caloriesToAdd} kcal, +${activeMinutesToAdd} active mins (Total steps today: ${updatedFitness.totalSteps})`
        );

        // Check active goals if steps or calories increased
        if (stepsToAdd > 0) {
          const activeStepGoals = await Goal.find({ userId, type: "steps", achieved: false });
          for (const goal of activeStepGoals) {
            goal.current = updatedFitness.totalSteps;
            if (updatedFitness.totalSteps >= goal.target) {
              goal.achieved = true;
              await goal.save();
              eventBus.publish(EVENTS.GOAL_REACHED, {
                userId,
                goalType: "steps",
                target: goal.target,
                current: updatedFitness.totalSteps,
              });
            } else {
              await goal.save();
            }
          }
        }
      }

      // Evict Redis dashboard cache so frontend reads fresh numbers immediately
      const todayStr = today.toISOString().slice(0, 10);
      await cache.del(`dashboard:${userId}`);
      await cache.del(`dashboard:${userId}:${todayStr}`);
      console.log(`🧹 [CACHE] Invalidation completed for user ${userId}`);

      eventBus.publish(EVENTS.RECOMMENDATION_GENERATED, {
        userId,
        workoutId,
        recommendations,
        durationMinutes,
        caloriesBurned,
        avgHeartRate,
      });
    } catch (error) {
      console.error("❌ Error in WORKOUT_COMPLETED consumer:", error.message);
    }
  });

  // ----------------------------------------------------
  // 2. Notification Service: RECOMMENDATION_GENERATED Listener
  // ----------------------------------------------------
  eventBus.on(EVENTS.RECOMMENDATION_GENERATED, async (data) => {
    try {
      const { userId, workoutId, durationMinutes = 0, caloriesBurned = 0 } = data;

      console.log(
        `🔔 [NOTIFICATION CONSUMER] Creating workout alert for user ${userId}...`
      );

      const notification = await Notification.create({
        userId,
        type: "WORKOUT_COMPLETED",
        title: "🏋️ Workout Completed!",
        message: `Nice work! You trained for ${durationMinutes} minutes and burned ${Math.round(
          caloriesBurned
        )} kcal. Check your personalized recommendations.`,
        read: false,
      });

      eventBus.publish(EVENTS.NOTIFICATION_CREATED, {
        userId,
        workoutId,
        notification,
      });
    } catch (error) {
      console.error("❌ Error in RECOMMENDATION_GENERATED consumer:", error.message);
    }
  });
}

module.exports = { initWorkoutConsumers, buildRecommendations };
