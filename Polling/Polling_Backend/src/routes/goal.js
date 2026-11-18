const express = require("express");
const {
  createGoal,
  getGoals,
  getActiveGoals,
  updateGoal,
  completeGoal,
} = require("../controllers/goalController");

const router = express.Router();

// Create a new fitness goal (validated, duplicate-safe)
router.post("/goals", createGoal);

// Goal listing (specific routes must be registered before /goals/:userId)
router.get("/goals/:userId/active", getActiveGoals);
router.get("/goals/:userId", getGoals);

// Update / deactivate / manually complete a goal
router.put("/goals/:goalId", updateGoal);
router.post("/goals/:goalId/complete", completeGoal);

module.exports = router;
