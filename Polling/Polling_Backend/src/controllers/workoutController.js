const Workout = require("../models/Workout");
const Notification = require("../models/Notification");

/**
 * POLLING ARCHITECTURE — No EventBus used.
 * Recommendations are computed synchronously inside stopWorkout.
 * Client polls /api/workout/status/:userId to track session state.
 * Defined in docs/WORKOUT_SESSION_ARCHITECTURE.md (Suhas Architecture)
 */

function evaluateWorkoutRecommendations({ avgHeartRate = 0, caloriesBurned = 0, durationMinutes = 0 }) {
  const recommendations = [];

  if (avgHeartRate >= 150) {
    recommendations.push("High cardiovascular strain. Hydrate with electrolytes and take a 24h recovery rest.");
  } else if (avgHeartRate >= 120) {
    recommendations.push("Optimal aerobic fat-burn zone! Great cardiovascular endurance session.");
  }

  if (caloriesBurned >= 400) {
    recommendations.push("Outstanding calorie burn! Replenish with carbohydrates and lean protein.");
  }

  if (durationMinutes < 15) {
    recommendations.push("Quick session completed. Try 30+ minutes next time for sustained endurance.");
  }

  if (recommendations.length === 0) {
    recommendations.push("Great workout! Keep the momentum going and stay hydrated.");
  }

  return recommendations;
}

/**
 * POST /api/workout/start
 */
const startWorkout = async (req, res) => {
  try {
    const { userId, workoutType = "running" } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    // Polling rule: No concurrent workouts allowed
    const activeSession = await Workout.findOne({ userId, status: "in-progress" });
    if (activeSession) {
      return res.status(400).json({
        success: false,
        message: "Workout session already active. Stop the current session first.",
        activeWorkoutId: activeSession._id,
      });
    }

    const workout = await Workout.create({
      userId,
      workoutType,
      status: "in-progress",
      startTime: new Date(),
    });

    console.log(`[POLL] Workout started for ${userId}: ${workoutType} (ID: ${workout._id})`);

    res.status(201).json({
      success: true,
      message: `Workout (${workoutType}) started. Poll /api/workout/status/${userId} to track progress.`,
      workout,
      pollEndpoint: `/api/workout/status/${userId}`,
      pollIntervalMs: 5000,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/workout/metrics/:workoutId
 * Ingest live heart rate and calorie readings during workout
 */
const recordLiveMetrics = async (req, res) => {
  try {
    const { workoutId } = req.params;
    const { heartRate, calories } = req.body;

    const workout = await Workout.findById(workoutId);
    if (!workout || workout.status !== "in-progress") {
      return res.status(404).json({ success: false, message: "No active workout session found" });
    }

    if (heartRate) {
      workout.heartRateReadings.push({ value: heartRate, timestamp: new Date() });
    }
    if (calories) {
      workout.caloriesBurned += calories;
    }

    await workout.save();

    res.json({
      success: true,
      message: "Live metrics recorded",
      currentCalories: workout.caloriesBurned,
      readingsCount: workout.heartRateReadings.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/workout/stop
 * Stops active workout, computes summary & recommendations synchronously (polling pattern)
 */
const stopWorkout = async (req, res) => {
  try {
    const { userId, caloriesBurned, avgHeartRate } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const workout = await Workout.findOne({ userId, status: "in-progress" });
    if (!workout) {
      return res.status(400).json({
        success: false,
        message: "No active workout session found for this user",
      });
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - new Date(workout.startTime).getTime();
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));

    // Compute average heart rate from readings or use provided value
    let computedAvgHR = avgHeartRate;
    if (!computedAvgHR && workout.heartRateReadings.length > 0) {
      const sum = workout.heartRateReadings.reduce((acc, r) => acc + r.value, 0);
      computedAvgHR = Math.round(sum / workout.heartRateReadings.length);
    }
    computedAvgHR = computedAvgHR || 135;

    const finalCalories = caloriesBurned || workout.caloriesBurned || Math.round(durationMinutes * 8.5);

    // POLLING PATTERN: Recommendations computed synchronously right here
    const recommendations = evaluateWorkoutRecommendations({
      avgHeartRate: computedAvgHR,
      caloriesBurned: finalCalories,
      durationMinutes,
    });

    workout.status = "completed";
    workout.endTime = endTime;
    workout.durationMinutes = durationMinutes;
    workout.caloriesBurned = finalCalories;
    workout.avgHeartRate = computedAvgHR;
    workout.recommendations = recommendations;
    await workout.save();

    // Create in-app notification (client will poll /api/notifications/:userId/poll to see it)
    await Notification.create({
      userId,
      type: "WORKOUT_COMPLETED",
      title: "🏋️ Workout Completed!",
      message: `Finished ${durationMinutes}m ${workout.workoutType} (${finalCalories} kcal, avg HR ${computedAvgHR} bpm). Check your recommendations!`,
      read: false,
    });

    console.log(`[POLL] Workout completed for ${userId}: ${durationMinutes}min, ${finalCalories}kcal, avgHR ${computedAvgHR}bpm`);

    res.json({
      success: true,
      message: "Workout session completed successfully",
      summary: {
        workoutId: workout._id,
        workoutType: workout.workoutType,
        durationMinutes,
        caloriesBurned: finalCalories,
        avgHeartRate: computedAvgHR,
        recommendations,
      },
      pollNotifications: `/api/notifications/${userId}/poll`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/workout/status/:userId
 * Client polls this endpoint to track current workout state
 */
const getWorkoutStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const workout = await Workout.findOne({ userId, status: "in-progress" });

    res.json({
      architecture: "POLLING",
      active: !!workout,
      workout: workout || null,
      pollIntervalMs: 5000,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/workout/history/:userId
 */
const getWorkoutHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const workouts = await Workout.find({ userId, status: "completed" }).sort({ createdAt: -1 });
    res.json({ success: true, workouts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  startWorkout,
  recordLiveMetrics,
  stopWorkout,
  getWorkoutStatus,
  getWorkoutHistory,
  evaluateWorkoutRecommendations,
};
