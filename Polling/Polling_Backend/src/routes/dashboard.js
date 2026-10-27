const express = require("express");
const { getDashboardSummary } = require("../controllers/dashboardController");
const {
  logSleep,
  startWalk,
  stopWalk,
  logCalories,
  logWeight,
  getActiveWalk,
} = require("../controllers/activityController");

const router = express.Router();

// POLLING: Client periodically fetches dashboard data
router.get("/dashboard/:userId", getDashboardSummary);

// POLLING: Client periodically checks walk status
router.get("/walk/:userId/status", getActiveWalk);

// POLLING: Client submits user actions (POST) then polls for updated dashboard
router.post("/sleep/:userId", logSleep);
router.post("/walk/:userId/start", startWalk);
router.post("/walk/:userId/stop", stopWalk);
router.post("/calories/:userId", logCalories);
router.post("/weight/:userId", logWeight);

module.exports = router;
