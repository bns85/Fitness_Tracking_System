const express = require("express");
const controller = require("../controllers/goalController");

const router = express.Router();

router.post("/goals", controller.createGoal);
router.get("/goals/:userId/active", controller.listActiveGoals);
router.get("/goals/:userId", controller.listGoals);
router.put("/goals/:goalId", controller.updateGoal);
router.post("/goals/:goalId/complete", controller.completeGoal);
router.post("/internal/evaluate/:userId", controller.evaluateInternal);
router.get("/internal/goals/:userId", controller.internalGoals);

module.exports = router;
