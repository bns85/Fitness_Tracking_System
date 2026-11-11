/**
 * ============================================================================
 * BACKGROUND GOAL POLLING WORKER (POLLING ARCHITECTURE)
 * ============================================================================
 * In Polling Architecture, rather than reacting instantly to sensor events,
 * this worker periodically polls active goals and checks them against
 * users' latest fitness records.
 * ============================================================================
 */

const mongoose = require("mongoose");
const Goal = require("../models/Goal");
const FitnessData = require("../models/FitnessData");
const Notification = require("../models/Notification");
const config = require("../config");

const QUIET = process.env.QUIET === "1";
let pollIntervalHandle = null;

function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function runGoalPollingCycle() {
  if (!isDBConnected()) return;

  try {
    const today = todayStart();
    const activeGoals = await Goal.find({ achieved: false });

    for (const goal of activeGoals) {
      const fitness = await FitnessData.findOne({
        userId: goal.userId,
        date: { $gte: today },
      });

      if (fitness && fitness.totalSteps >= goal.target) {
        goal.achieved = true;
        goal.current = fitness.totalSteps;
        await goal.save();

        const existingNotif = await Notification.findOne({
          userId: goal.userId,
          type: "GOAL_REACHED",
          createdAt: { $gte: today },
        });

        if (!existingNotif) {
          await Notification.create({
            userId: goal.userId,
            type: "GOAL_REACHED",
            title: "🎉 Daily Step Goal Achieved!",
            message: `Awesome job! You reached your goal of ${goal.target.toLocaleString()} steps with ${fitness.totalSteps.toLocaleString()} steps today! 🏆`,
            read: false,
          });
          if (!QUIET) console.log(`[POLL WORKER] Detected goal achieved for user ${goal.userId} (${fitness.totalSteps}/${goal.target})`);
        }
      }
    }
  } catch (err) {
    // Avoid noisy logs during shutdown
  }
}

function startGoalPollingWorker() {
  if (pollIntervalHandle) return;
  if (!QUIET) console.log(`⏱️ [POLLING WORKER] Started Goal Polling Worker (Interval: ${config.pollIntervalMs}ms)`);
  pollIntervalHandle = setInterval(runGoalPollingCycle, config.pollIntervalMs);
}

function stopGoalPollingWorker() {
  if (pollIntervalHandle) {
    clearInterval(pollIntervalHandle);
    pollIntervalHandle = null;
  }
}

module.exports = {
  startGoalPollingWorker,
  stopGoalPollingWorker,
  runGoalPollingCycle,
};
