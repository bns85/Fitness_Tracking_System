const config = require("../config");

/**
 * Log a journey step as a single structured JSON line to stdout.
 * Used for journey tracking and Experiment E7 reconstruction.
 *
 * @param {Object} entry
 * @param {string} [entry.level="info"]
 * @param {string} [entry.requestId]
 * @param {string} [entry.service]
 * @param {string} [entry.variant]
 * @param {string} entry.step - One of: ingest_received, data_saved, goal_evaluated, notification_created, sse_sent
 * @param {string} entry.userId
 * @param {string} entry.msg
 */
function logJourneyStep(entry) {
  const line = {
    ts: new Date().toISOString(),
    level: entry.level || "info",
    requestId: entry.requestId || null,
    service: entry.service || config.serviceName,
    variant: entry.variant || config.variant,
    step: entry.step,
    userId: entry.userId || null,
    msg: entry.msg || "",
  };
  console.log(JSON.stringify(line));
}

module.exports = {
  logJourneyStep,
};
