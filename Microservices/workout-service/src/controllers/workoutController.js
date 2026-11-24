const Workout = require("../models/Workout");
const { getRecommendations } = require("../services/recommendations");
const { requestJson } = require("../../../shared/httpClient");
const { journeyFailures } = require("../../../shared/metrics");
const { logJourneyStep } = require("../../../shared/logger");

const ACTIVE_STATUSES = ["in-progress", "paused"];
const round = (value, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

function toSummary(workout) {
  return {
    workoutId: String(workout._id),
    userId: workout.userId,
    workoutType: workout.workoutType,
    status: workout.status,
    startTime: workout.startTime,
    endTime: workout.endTime,
    durationMinutes: workout.durationMinutes,
    caloriesBurned: workout.caloriesBurned,
    steps: workout.steps,
    distanceKm: workout.distanceKm,
    avgHeartRate: Math.round(workout.avgHeartRate),
    maxHeartRate: workout.maxHeartRate,
    recommendations: workout.recommendations,
  };
}

function logFailure(req, step, userId, message) {
  journeyFailures.inc({ step });
  logJourneyStep({
    level: "error",
    requestId: req.requestId,
    service: "workout",
    step,
    userId,
    msg: message,
  });
}

async function startWorkout(req, res) {
  try {
    const { userId, workoutType = "other" } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
    const activeWorkout = await Workout.findOne({ userId, status: { $in: ACTIVE_STATUSES } });
    if (activeWorkout) {
      return res.status(400).json({
        success: false,
        message: "Workout session already active",
        workoutId: String(activeWorkout._id),
      });
    }

    const workout = await Workout.create({ userId, workoutType, status: "in-progress", startTime: new Date() });
    return res.status(201).json({ success: true, status: workout.status, workout });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function updateLiveMetrics(req, res) {
  try {
    const { userId, workoutId, heartRate, calories = 0, steps = 0, distance = 0 } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
    const query = { status: { $in: ACTIVE_STATUSES }, userId };
    if (workoutId) query._id = workoutId;
    const workout = await Workout.findOne(query);
    if (!workout) return res.status(404).json({ success: false, message: "No active workout found" });

    const heartRateValue = Number.parseFloat(heartRate);
    if (!Number.isNaN(heartRateValue) && heartRateValue > 0) {
      workout.heartRateTotal += heartRateValue;
      workout.heartRateCount += 1;
      workout.avgHeartRate = workout.heartRateTotal / workout.heartRateCount;
      workout.maxHeartRate = Math.max(workout.maxHeartRate, heartRateValue);
    }
    workout.caloriesBurned += Number.parseFloat(calories) || 0;
    workout.steps += Number.parseInt(steps, 10) || 0;
    workout.distanceKm += Number.parseFloat(distance) || 0;
    await workout.save();

    return res.json({
      success: true,
      live: {
        workoutId: String(workout._id),
        status: workout.status,
        heartRate: Math.round(workout.avgHeartRate),
        maxHeartRate: workout.maxHeartRate,
        caloriesBurned: workout.caloriesBurned,
        steps: workout.steps,
        distanceKm: round(workout.distanceKm, 2),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function pauseWorkout(req, res) {
  try {
    const { userId, workoutId } = req.body || {};
    const query = { userId, status: "in-progress" };
    if (workoutId) query._id = workoutId;
    const workout = await Workout.findOne(query);
    if (!workout) return res.status(400).json({ success: false, message: "No active workout found" });
    workout.status = "paused";
    workout.pausedAt = new Date();
    await workout.save();
    return res.json({ success: true, status: workout.status, workout });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function resumeWorkout(req, res) {
  try {
    const { userId, workoutId } = req.body || {};
    const query = { userId, status: "paused" };
    if (workoutId) query._id = workoutId;
    const workout = await Workout.findOne(query);
    if (!workout) return res.status(400).json({ success: false, message: "No paused workout found" });
    if (workout.pausedAt) {
      workout.pausedMs += Date.now() - workout.pausedAt.getTime();
      workout.pausedAt = null;
    }
    workout.status = "in-progress";
    await workout.save();
    return res.json({ success: true, status: workout.status, workout });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function stopWorkout(req, res) {
  const { userId, workoutId } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, message: "userId is required" });
  try {
    const query = { userId, status: { $in: ACTIVE_STATUSES } };
    if (workoutId) query._id = workoutId;
    const workout = await Workout.findOne(query);
    if (!workout) return res.status(400).json({ success: false, message: "No active workout found" });

    const endTime = new Date();
    let pausedMs = workout.pausedMs;
    if (workout.pausedAt) pausedMs += endTime.getTime() - workout.pausedAt.getTime();
    const activeMs = Math.max(0, endTime.getTime() - workout.startTime.getTime() - pausedMs);
    workout.status = "completed";
    workout.endTime = endTime;
    workout.pausedAt = null;
    workout.pausedMs = pausedMs;
    workout.durationMinutes = round(activeMs / 60000, 1);
    workout.avgHeartRate = workout.heartRateCount > 0
      ? Math.round(workout.heartRateTotal / workout.heartRateCount)
      : 0;
    await workout.save();

    const recommendations = await getRecommendations({
      avgHeartRate: workout.avgHeartRate,
      caloriesBurned: workout.caloriesBurned,
      durationMinutes: workout.durationMinutes,
    });
    workout.recommendations = recommendations;
    await workout.save();

    const summary = toSummary(workout);
    try {
      await requestJson("http://telemetry-service:5022/internal/workouts/totals", {
        method: "POST",
        body: {
          workoutId: summary.workoutId,
          userId,
          steps: summary.steps,
          caloriesBurned: summary.caloriesBurned,
          distanceKm: summary.distanceKm,
          durationMinutes: summary.durationMinutes,
          endTime: summary.endTime,
        },
        from: "workout",
        to: "telemetry",
        requestId: req.requestId,
      });
    } catch (error) {
      logFailure(req, "data_saved", userId, `Dashboard totals update failed: ${error.message}`);
      return res.status(500).json({ success: false, message: "Workout saved but dashboard totals could not be updated" });
    }

    let inAppNotification = null;
    try {
      const notificationResponse = await requestJson("http://notification-service:5024/internal/notifications", {
        method: "POST",
        body: {
          userId,
          type: "WORKOUT_COMPLETED",
          title: "🏋️ Workout Completed!",
          message: `Nice work! You trained for ${summary.durationMinutes} minutes and burned ${Math.round(summary.caloriesBurned)} kcal. Check your personalized recommendations.`,
        },
        from: "workout",
        to: "notification",
        requestId: req.requestId,
      });
      inAppNotification = notificationResponse.notification;
    } catch (error) {
      logFailure(req, "notification_created", userId, `Workout notification failed: ${error.message}`);
    }

    return res.json({ success: true, workoutSummary: summary, recommendations, inAppNotification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function getActiveWorkout(req, res) {
  try {
    const workout = await Workout.findOne({
      userId: req.params.userId,
      status: { $in: ACTIVE_STATUSES },
    });
    return res.json({ success: true, workout: workout ? toSummary(workout) : null });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function getWorkoutHistory(req, res) {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 20, 100);
    const workouts = await Workout.find({ userId: req.params.userId }).sort({ startTime: -1 }).limit(limit);
    return res.json({ success: true, count: workouts.length, workouts: workouts.map(toSummary) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function getWorkoutById(req, res) {
  try {
    const workout = await Workout.findById(req.params.workoutId);
    if (!workout) return res.status(404).json({ success: false, message: "Workout not found" });
    return res.json({ success: true, workout: toSummary(workout) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function getRecentWorkouts(req, res) {
  try {
    const workouts = await Workout.find({ userId: req.params.userId, status: "completed" })
      .sort({ endTime: -1 })
      .limit(5);
    return res.json({
      workouts: workouts.map((workout) => ({
        workoutId: String(workout._id),
        workoutType: workout.workoutType,
        durationMinutes: workout.durationMinutes,
        caloriesBurned: workout.caloriesBurned,
        avgHeartRate: workout.avgHeartRate,
        endTime: workout.endTime,
        recommendations: workout.recommendations,
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  startWorkout,
  updateLiveMetrics,
  pauseWorkout,
  resumeWorkout,
  stopWorkout,
  getActiveWorkout,
  getWorkoutHistory,
  getWorkoutById,
  getRecentWorkouts,
};
