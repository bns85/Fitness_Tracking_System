const express = require("express");
const controller = require("../controllers/workoutController");

const router = express.Router();

router.post("/workout/start", controller.startWorkout);
router.post("/workout/stop", controller.stopWorkout);
router.post("/workout/pause", controller.pauseWorkout);
router.post("/workout/resume", controller.resumeWorkout);
router.post("/workout/live-metrics", controller.updateLiveMetrics);
router.get("/workout/active/:userId", controller.getActiveWorkout);
router.get("/workout/history/:userId", controller.getWorkoutHistory);
router.get("/workout/:workoutId", controller.getWorkoutById);
router.get("/internal/workouts/recent/:userId", controller.getRecentWorkouts);

module.exports = router;
