const Workout = require("../models/Workout");
const { eventBus, EVENTS } = require("../utils/eventBus");
const waitForEvent = require("../utils/waitForEvent");

const ACTIVE_STATUSES = ["in-progress", "paused"];
const EVENT_WAIT_MS = 2000;

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
  recommendations: workout.recommendations,
});

// ----------------------------------------------------
// POST /api/workout/start
// ----------------------------------------------------
const startWorkout = async (req, res) => {
  try {
    const { userId, workoutType = "other" } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const activeWorkout = await Workout.findOne({
      userId,
      status: { $in: ACTIVE_STATUSES },
    });

    if (activeWorkout) {
      return res.status(400).json({
        success: false,
        message: "Workout session already active",
        workoutId: String(activeWorkout._id),
      });
    }

    const workout = await Workout.create({
      userId,
      workoutType,
      status: "in-progress",
      startTime: new Date(),
    });

    eventBus.publish(EVENTS.WORKOUT_STARTED, {
      workoutId: String(workout._id),
      userId,
      workoutType: workout.workoutType,
      startTime: workout.startTime,
    });

    res.status(201).json({
      success: true,
      status: workout.status,
      workout,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// POST /api/workout/live-metrics  (heart rate / calories during a session)
// ----------------------------------------------------
const updateLiveMetrics = async (req, res) => {
  try {
    const { userId, workoutId, heartRate, calories = 0, steps = 0, distance = 0 } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const query = { status: { $in: ACTIVE_STATUSES }, userId };
    if (workoutId) query._id = workoutId;

    const workout = await Workout.findOne(query);
    if (!workout) {
      return res.status(404).json({ success: false, message: "No active workout found" });
    }

    const hr = parseFloat(heartRate);
    if (!Number.isNaN(hr) && hr > 0) {
      workout.heartRateTotal += hr;
      workout.heartRateCount += 1;
      workout.avgHeartRate = workout.heartRateTotal / workout.heartRateCount;
      workout.maxHeartRate = Math.max(workout.maxHeartRate, hr);
    }

    workout.caloriesBurned += parseFloat(calories) || 0;
    workout.steps += parseInt(steps) || 0;
    workout.distanceKm += parseFloat(distance) || 0;
    await workout.save();

    if (!Number.isNaN(hr) && hr > 0) {
      eventBus.publish(EVENTS.HEART_RATE_UPDATED, {
        userId,
        workoutId: String(workout._id),
        heartRate: hr,
        avgHeartRate: Math.round(workout.avgHeartRate),
        caloriesBurned: workout.caloriesBurned,
        timestamp: new Date(),
      });
    }

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
};

// ----------------------------------------------------
// POST /api/workout/pause
// ----------------------------------------------------
const pauseWorkout = async (req, res) => {
  try {
    const { userId, workoutId } = req.body;

    const query = { userId, status: "in-progress" };
    if (workoutId) query._id = workoutId;

    const workout = await Workout.findOne(query);
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
};

// ----------------------------------------------------
// POST /api/workout/resume
// ----------------------------------------------------
const resumeWorkout = async (req, res) => {
  try {
    const { userId, workoutId } = req.body;

    const query = { userId, status: "paused" };
    if (workoutId) query._id = workoutId;

    const workout = await Workout.findOne(query);
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
};

// ----------------------------------------------------
// POST /api/workout/stop
// ----------------------------------------------------
const stopWorkout = async (req, res) => {
  try {
    const { userId, workoutId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const query = { userId, status: { $in: ACTIVE_STATUSES } };
    if (workoutId) query._id = workoutId;

    const workout = await Workout.findOne(query);
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
    workout.avgHeartRate = workout.heartRateCount > 0
      ? Math.round(workout.heartRateTotal / workout.heartRateCount)
      : 0;
    await workout.save();

    const summary = toSummary(workout);

    eventBus.publish(EVENTS.WORKOUT_COMPLETED, {
      workoutId: summary.workoutId,
      userId,
      workoutType: workout.workoutType,
      durationMinutes: summary.durationMinutes,
      caloriesBurned: summary.caloriesBurned,
      avgHeartRate: summary.avgHeartRate,
      maxHeartRate: summary.maxHeartRate,
      steps: summary.steps,
      startTime: workout.startTime,
      endTime: workout.endTime,
    });

    const recommendationEvent = await waitForEvent(
      eventBus,
      EVENTS.RECOMMENDATION_GENERATED,
      (e) => e.workoutId === summary.workoutId,
      EVENT_WAIT_MS
    );

    const notificationEvent = await waitForEvent(
      eventBus,
      EVENTS.NOTIFICATION_CREATED,
      (e) => e.workoutId === summary.workoutId,
      EVENT_WAIT_MS
    );

    const recommendations = recommendationEvent ? recommendationEvent.recommendations : [];

    if (recommendations.length > 0 && workout.recommendations.length === 0) {
      workout.recommendations = recommendations;
      await workout.save();
      summary.recommendations = recommendations;
    }

    res.status(200).json({
      success: true,
      workoutSummary: summary,
      recommendations,
      inAppNotification: notificationEvent ? notificationEvent.notification : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// GET /api/workout/active/:userId
// ----------------------------------------------------
const getActiveWorkout = async (req, res) => {
  try {
    const { userId } = req.params;

    const workout = await Workout.findOne({
      userId,
      status: { $in: ACTIVE_STATUSES },
    });

    res.json({
      success: true,
      workout: workout ? toSummary(workout) : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// GET /api/workout/history/:userId
// ----------------------------------------------------
const getWorkoutHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const workouts = await Workout.find({ userId })
      .sort({ startTime: -1 })
      .limit(limit);

    res.json({
      success: true,
      count: workouts.length,
      workouts: workouts.map(toSummary),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ----------------------------------------------------
// GET /api/workout/:workoutId
// ----------------------------------------------------
const getWorkoutById = async (req, res) => {
  try {
    const { workoutId } = req.params;

    const workout = await Workout.findById(workoutId);
    if (!workout) {
      return res.status(404).json({ success: false, message: "Workout not found" });
    }

    res.json({ success: true, workout: toSummary(workout) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  startWorkout,
  stopWorkout,
  pauseWorkout,
  resumeWorkout,
  updateLiveMetrics,
  getActiveWorkout,
  getWorkoutHistory,
  getWorkoutById,
};
