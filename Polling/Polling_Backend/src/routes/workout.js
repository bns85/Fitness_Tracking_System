const express = require("express");
const {
  startWorkout,
  recordLiveMetrics,
  stopWorkout,
  getWorkoutStatus,
  getWorkoutHistory,
} = require("../controllers/workoutController");

const router = express.Router();

// POLLING: Start a workout session
router.post("/workout/start", startWorkout);

// POLLING: Ingest live telemetry (HR / calories)
router.post("/workout/metrics/:workoutId", recordLiveMetrics);

// POLLING: Stop and complete active workout session
router.post("/workout/stop", stopWorkout);

// POLLING: Client polls this to track current workout state
router.get("/workout/status/:userId", getWorkoutStatus);

// POLLING: Get completed workout history
router.get("/workout/history/:userId", getWorkoutHistory);

module.exports = router;
