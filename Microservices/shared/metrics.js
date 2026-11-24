const client = require("prom-client");

const register = new client.Registry();
const variant = process.env.VARIANT || "micro";
const service = process.env.SERVICE_NAME || "unknown";

client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status", "variant", "service"],
  buckets: [0.001, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1],
  registers: [register],
});

const dbOperations = new client.Counter({
  name: "db_operations_total",
  help: "Total database operations performed",
  labelNames: ["op", "variant", "service"],
  registers: [register],
});

const downstreamCallDuration = new client.Histogram({
  name: "downstream_call_duration_seconds",
  help: "Duration of an internal HTTP call in seconds",
  labelNames: ["from", "to", "variant"],
  buckets: [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});

const journeyFailures = new client.Counter({
  name: "journey_failures_total",
  help: "Best-effort journey steps that failed",
  labelNames: ["variant", "service", "step"],
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  if (req.path === "/metrics" || req.path.includes("/stream")) return next();

  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const route = req.route ? req.route.path : req.path;
    httpRequestDuration.observe({
      method: req.method,
      route: route || req.path,
      status: String(res.statusCode),
      variant,
      service,
    }, Number(process.hrtime.bigint() - startedAt) / 1e9);
  });
  next();
}

module.exports = {
  register,
  httpRequestDuration,
  dbOperations,
  downstreamCallDuration,
  journeyFailures,
  metricsMiddleware,
};
