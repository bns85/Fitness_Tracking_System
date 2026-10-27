const express = require("express");
const { eventBus, EVENTS } = require("../utils/eventBus");
const Goal = require("../models/Goal");

const router = express.Router();

// ----------------------------------------------------
// Event Producer: Ingest Step Telemetry
// POST /api/telemetry/steps
// ----------------------------------------------------
router.post("/telemetry/steps", async (req, res) => {
  try {
    const { userId, steps, calories = 0, distance = 0 } = req.body;

    if (!userId || !steps) {
      return res.status(400).json({ success: false, message: "userId and steps are required" });
    }

    // Publish STEP_UPDATED event to Event Bus (EDA Pattern)
    eventBus.publish(EVENTS.STEP_UPDATED, {
      userId,
      steps: parseInt(steps),
      calories: parseFloat(calories),
      distance: parseFloat(distance),
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: `Event STEP_UPDATED (+${steps} steps) published to Event Bus for user ${userId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------------------------------------
// Set or Update a User Goal
// POST /api/goals
// ----------------------------------------------------
router.post("/goals", async (req, res) => {
  try {
    const { userId, type = "steps", target = 10000 } = req.body;

    const goal = await Goal.findOneAndUpdate(
      { userId, type },
      { target, current: 0, achieved: false },
      { upsert: true, new: true }
    );

    res.json({ success: true, goal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
