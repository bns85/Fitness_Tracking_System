const express = require("express");
const { recordSteps, updateWorkoutTotals, invalidateDashboard } = require("../controllers/telemetryController");
const { getDashboardSummary, getInternalDashboard } = require("../controllers/dashboardController");

const router = express.Router();

router.post("/telemetry/steps", recordSteps);
router.get("/dashboard/:userId", getDashboardSummary);
router.post("/internal/workouts/totals", updateWorkoutTotals);
router.delete("/internal/dashboard/:userId/cache", invalidateDashboard);
router.get("/internal/dashboard/:userId", getInternalDashboard);

module.exports = router;
