const client = require("prom-client");

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
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
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
