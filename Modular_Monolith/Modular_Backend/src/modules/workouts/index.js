const express = require("express");
const workoutRepository = require("./workoutRepository");
const recommendationsModule = require("../recommendations");
const cache = require("../../utils/cache");

let telemetryModule = null;
let notificationsModule = null;

function setDependencies({ telemetry, notifications }) {
  if (telemetry) telemetryModule = telemetry;
  if (notifications) notificationsModule = notifications;
}

const ACTIVE_STATUSES = ["in-progress", "paused"];

const round = (value, decimals = 1) => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

const toSummary = (workout) => ({
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
  recommendations: workout.recommendations || [],
});

/**
 * Public Facade API for Workouts Module
 */
async function getRecentWorkouts(userId, limit = 5) {
  const list = await workoutRepository.findRecentCompleted(userId, limit);
  return list.map((w) => ({
    workoutId: String(w._id),
    workoutType: w.workoutType,
    durationMinutes: w.durationMinutes,
    caloriesBurned: w.caloriesBurned,
    avgHeartRate: Math.round(w.avgHeartRate),
    endTime: w.endTime,
    recommendations: w.recommendations || [],
  }));
}

// ----------------------------------------------------
// Express Routes
// ----------------------------------------------------
const router = express.Router();

// POST /api/workout/start
router.post("/workout/start", async (req, res) => {
  try {
    const { userId, workoutType = "other" } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const activeWorkout = await workoutRepository.findActiveByUserId(userId);
    if (activeWorkout) {
      return res.status(400).json({
        success: false,
        message: "Workout session already active",
        workoutId: String(activeWorkout._id),
      });
    }

    const workout = await workoutRepository.create({
      userId,
      workoutType,
      status: "in-progress",
      startTime: new Date(),
    });

    res.status(201).json({
      success: true,
      status: workout.status,
      workout,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/workout/live-metrics
router.post("/workout/live-metrics", async (req, res) => {
  try {
    const { userId, workoutId, heartRate, calories = 0, steps = 0, distance = 0 } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const workout = await workoutRepository.findActiveByIdOrUser(userId, workoutId);
    if (!workout) {
      return res.status(404).json({ success: false, message: "No active workout found" });
    }

    const hr = parseFloat(heartRate);
    if (!Number.isNaN(hr) && hr > 0) {
      workout.heartRateTotal += hr;
      workout.heartRateCount += 1;
      workout.avgHeartRate = workout.heartRateTotal / workout.heartRateCount;
      workout.maxHeartRate = Math.max(workout.maxHeartRate, hr);
      workout.heartRateReadings.push({ value: hr, timestamp: new Date() });
    }

    workout.caloriesBurned += parseFloat(calories) || 0;
    workout.steps += parseInt(steps, 10) || 0;
    workout.distanceKm += parseFloat(distance) || 0;
    await workout.save();

    res.json({
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
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/workout/pause
router.post("/workout/pause", async (req, res) => {
  try {
    const { userId, workoutId } = req.body;
    const workout = await workoutRepository.findActiveByIdOrUser(userId, workoutId, "in-progress");
    if (!workout) {
      return res.status(400).json({ success: false, message: "No active workout found" });
    }

    workout.status = "paused";
    workout.pausedAt = new Date();
    await workout.save();

    res.json({ success: true, status: workout.status, workout });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/workout/resume
router.post("/workout/resume", async (req, res) => {
  try {
    const { userId, workoutId } = req.body;
    const workout = await workoutRepository.findActiveByIdOrUser(userId, workoutId, "paused");
    if (!workout) {
      return res.status(400).json({ success: false, message: "No paused workout found" });
    }

    if (workout.pausedAt) {
      workout.pausedMs += Date.now() - workout.pausedAt.getTime();
      workout.pausedAt = null;
    }
    workout.status = "in-progress";
    await workout.save();

    res.json({ success: true, status: workout.status, workout });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/workout/stop — CORRECT behaviour: saves result AND updates dashboard totals
router.post("/workout/stop", async (req, res) => {
  try {
    const { userId, workoutId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const workout = await workoutRepository.findActiveByIdOrUser(userId, workoutId);
    if (!workout) {
      return res.status(400).json({ success: false, message: "No active workout found" });
    }

    const endTime = new Date();
    let pausedMs = workout.pausedMs;
    if (workout.pausedAt) {
      pausedMs += endTime.getTime() - workout.pausedAt.getTime();
    }
    const activeMs = Math.max(0, endTime.getTime() - workout.startTime.getTime() - pausedMs);

    workout.status = "completed";
    workout.endTime = endTime;
    workout.pausedAt = null;
    workout.pausedMs = pausedMs;
    workout.durationMinutes = round(activeMs / 60000, 1);
    workout.avgHeartRate =
      workout.heartRateCount > 0
        ? Math.round(workout.heartRateTotal / workout.heartRateCount)
        : 0;

    // Recommendations
    const recs = await recommendationsModule.getWorkoutRecommendations({
      workoutId: String(workout._id),
      avgHeartRate: workout.avgHeartRate,
      caloriesBurned: workout.caloriesBurned,
      durationMinutes: workout.durationMinutes,
    });
    workout.recommendations = recs;
    await workout.save();

    const summary = toSummary(workout);

    // CORRECT BEHAVIOUR: updates dashboard totals via telemetry repository
    const telemetry = telemetryModule || require("../telemetry");
    await telemetry.incrementActivity(userId, {
      steps: workout.steps,
      calories: workout.caloriesBurned,
      distance: workout.distanceKm,
      activeMinutes: workout.durationMinutes,
    });

    // Invalidate dashboard cache
    await cache.del(`dashboard:${userId}`);

    // Create and publish in-app notification
    const notifications = notificationsModule || require("../notifications");
    let inAppNotification = null;
    try {
      inAppNotification = await notifications.createNotification({
        userId,
        type: "WORKOUT_COMPLETED",
        title: "Workout Completed!",
        message: `Great job completing your ${workout.workoutType} workout! Burned ${workout.caloriesBurned} calories.`,
        requestId: req.requestId,
      });
    } catch (_) {}

    res.status(200).json({
      success: true,
      workoutSummary: summary,
      recommendations: recs,
      inAppNotification,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/workout/active/:userId
router.get("/workout/active/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const workout = await workoutRepository.findActiveByUserId(userId);
    res.json({
      success: true,
      workout: workout ? toSummary(workout) : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/workout/history/:userId
router.get("/workout/history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 20;
    const list = await workoutRepository.findHistory(userId, limit);
    res.json({
      success: true,
      count: list.length,
      workouts: list.map(toSummary),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/workout/:workoutId
router.get("/workout/:workoutId", async (req, res) => {
  try {
    const { workoutId } = req.params;
    const workout = await workoutRepository.findById(workoutId);
    if (!workout) {
      return res.status(404).json({ success: false, message: "Workout not found" });
    }
    res.json({
      success: true,
      workout: toSummary(workout),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = {
  getRecentWorkouts,
  setDependencies,
  routes: router,
};
