const express = require("express");
const {
  startWorkout,
  stopWorkout,
  pauseWorkout,
  resumeWorkout,
  updateLiveMetrics,
  getActiveWorkout,
  getWorkoutHistory,
  getWorkoutById,
} = require("../controllers/workoutController");

const router = express.Router();

router.post("/workout/start", startWorkout);
router.post("/workout/stop", stopWorkout);
router.post("/workout/pause", pauseWorkout);
router.post("/workout/resume", resumeWorkout);
router.post("/workout/live-metrics", updateLiveMetrics);

router.get("/workout/active/:userId", getActiveWorkout);
router.get("/workout/history/:userId", getWorkoutHistory);
router.get("/workout/:workoutId", getWorkoutById);

module.exports = router;
