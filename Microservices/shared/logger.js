const VARIANT = process.env.VARIANT || "micro";
const SERVICE_NAME = process.env.SERVICE_NAME || "unknown";

function logJourneyStep({ level = "info", requestId = null, service = SERVICE_NAME, variant = VARIANT, step, userId = null, msg }) {
  process.stdout.write(`${JSON.stringify({
    ts: new Date().toISOString(),
    level,
    requestId,
    service,
    variant,
    step,
    userId,
    msg,
  })}\n`);
}

module.exports = { logJourneyStep };
