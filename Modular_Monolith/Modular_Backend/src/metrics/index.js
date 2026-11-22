const client = require("prom-client");
const mongoose = require("mongoose");
const config = require("../config");

// Initialize Prometheus Register
const register = new client.Registry();

// Set default labels for every metric on this target (variant, service)
register.setDefaultLabels({
  variant: config.variant,
  service: config.serviceName,
});

// Collect default Node.js system and process metrics (includes event loop lag)
client.collectDefaultMetrics({
  register,
  prefix: "",
  eventLoopMonitoringPrecision: 10,
});

// HTTP Request Duration Histogram
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [
    0.001, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05, 0.075,
    0.1, 0.15, 0.25, 0.5, 1,
  ],
  registers: [register],
});

// Database Operations Counter
const dbOperations = new client.Counter({
  name: "db_operations_total",
  help: "Total database operations performed",
  labelNames: ["op"],
  registers: [register],
});

// Journey Failures Counter (Error policy P: logged and counted)
const journeyFailures = new client.Counter({
  name: "journey_failures_total",
  help: "Total journey step failures",
  labelNames: ["step"],
  registers: [register],
});

// Active Notification Listeners Gauge (SSE clients)
const notificationListeners = new client.Gauge({
  name: "notification_listeners",
  help: "Number of active SSE notification listeners",
  registers: [register],
});

// Global Mongoose plugin — tracks DB ops across queries
function dbOperationsPlugin(schema) {
  const track = (op) => {
    schema.pre(op, function () {
      try {
        dbOperations.inc({ op });
      } catch (e) {
        /* metrics must never break requests */
      }
    });
  };

  [
    "find",
    "findOne",
    "findOneAndUpdate",
    "findOneAndDelete",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "count",
    "countDocuments",
    "aggregate",
    "insertMany",
    "save",
  ].forEach(track);
}

mongoose.plugin(dbOperationsPlugin);

// Express Middleware to measure request duration
function metricsMiddleware(req, res, next) {
  if (req.path === "/metrics" || req.path.includes("/stream")) {
    return next();
  }

  const start = process.hrtime();
  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationSeconds = diff[0] + diff[1] / 1e9;
    const route = req.route ? req.route.path : req.path;
    httpRequestDuration.observe(
      {
        method: req.method,
        route: route || req.path,
        status: String(res.statusCode),
      },
      durationSeconds
    );
  });
  next();
}

module.exports = {
  register,
  httpRequestDuration,
  dbOperations,
  journeyFailures,
  notificationListeners,
  metricsMiddleware,
};
