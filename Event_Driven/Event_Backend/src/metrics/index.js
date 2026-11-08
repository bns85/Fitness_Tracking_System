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

// Events Published Counter (Event-Driven only)
const eventsPublished = new client.Counter({
  name: "events_published_total",
  help: "Total events published to the event bus",
  labelNames: ["event"],
  registers: [register],
});

// Active Notification Listeners Gauge (SSE clients)
const notificationListeners = new client.Gauge({
  name: "notification_listeners",
  help: "Number of active SSE notification listeners",
  registers: [register],
});

// Express Middleware to measure request duration
function metricsMiddleware(req, res, next) {
  // Exclude continuous SSE stream and metrics endpoint from request duration
  if (req.path === "/metrics" || req.path === "/api/notifications/stream") {
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
  eventsPublished,
  notificationListeners,
  metricsMiddleware,
};
