const client = require("prom-client");
const mongoose = require("mongoose");

// Initialize Prometheus Register
const register = new client.Registry();

// Collect default Node.js system and process metrics (includes nodejs_eventloop_lag_p99_seconds)
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
  buckets: [0.001, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1],
  registers: [register],
});

// Database Operations Counter
const dbOperations = new client.Counter({
  name: "db_operations_total",
  help: "Total database operations performed",
  labelNames: ["op"],
  registers: [register],
});

// Poll Responses Counter (Polling only: has_new="true|false")
const pollResponses = new client.Counter({
  name: "poll_responses_total",
  help: "Total polling query responses categorized by whether new data was found",
  labelNames: ["has_new"],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Global Mongoose plugin — MUST run before any model is compiled.
// server.js requires this module FIRST so the plugin is registered first.
// ---------------------------------------------------------------------------
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
  if (req.path === "/metrics") {
    return next();
  }

  const start = process.hrtime();
  res.on("finish", () => {
    const diff = process.hrtime(start);
    const durationSeconds = diff[0] + diff[1] / 1e9;
    let route = req.route ? req.route.path : req.path;
    
    // Normalize routes for benchmark filters
    if (req.path.includes("/steps/")) {
      route = "/steps/:userId";
    } else if (req.path.includes("/notifications/") && req.path.includes("/poll")) {
      route = "/notifications/:userId/poll";
    }

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
  pollResponses,
  metricsMiddleware,
};
