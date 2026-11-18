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
const cache = require("../utils/cache");
const { evaluateGoals } = require("../utils/goalProgress");
const { createGoalReachedNotification } = require("../utils/goalNotifications");
const config = require("../config");

const QUIET = process.env.QUIET === "1";
let pollIntervalHandle = null;
let cycleRunning = false;

function isDBConnected() {
  return mongoose.connection.readyState === 1;
}

async function runGoalPollingCycle() {
  // Skip if DB is down or the previous cycle is still running (overlaps are pointless)
  if (cycleRunning || !isDBConnected()) return;
  cycleRunning = true;

  try {
    // Evaluate every active goal (all users, all types, daily/weekly periods)
    // against real FitnessData. Each goal is claimed atomically so a
    // GOAL_REACHED notification is created at most once per goal per period.
    await evaluateGoals({
      onReached: async (payload) => {
        await createGoalReachedNotification(payload);
        await cache.del(`dashboard:${payload.userId}`);
        if (!QUIET) {
          console.log(
            `[POLL WORKER] Goal achieved for user ${payload.userId}: ${payload.current}/${payload.target} ${payload.unit} (${payload.period} ${payload.goalType})`
          );
        }
      },
    });
  } catch (err) {
    if (!QUIET) console.error(`[POLL WORKER] Goal polling cycle failed: ${err.message}`);
  } finally {
    cycleRunning = false;
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
