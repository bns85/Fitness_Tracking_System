const path = require("node:path");
const { createRequire } = require("node:module");

const serviceRequire = createRequire(path.join(process.cwd(), "package.json"));
const client = serviceRequire("prom-client");

const register = new client.Registry();
const variant = process.env.VARIANT || "micro";
const service = process.env.SERVICE_NAME || "unknown";

register.setDefaultLabels({ variant, service });
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.001, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1],
  registers: [register],
});

const dbOperations = new client.Counter({
  name: "db_operations_total",
  help: "Total database operations performed",
  labelNames: ["op"],
  registers: [register],
});

const downstreamCallDuration = new client.Histogram({
  name: "downstream_call_duration_seconds",
  help: "Duration of an internal HTTP call in seconds",
  labelNames: ["from", "to"],
  buckets: [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});

const journeyFailures = new client.Counter({
  name: "journey_failures_total",
  help: "Best-effort journey steps that failed",
  labelNames: ["step"],
  registers: [register],
});

const notificationListeners = new client.Gauge({
  name: "notification_listeners",
  help: "Number of active SSE notification listeners",
  registers: [register],
});

function installDatabaseMetrics(mongoose) {
  const operations = [
    "find", "findOne", "findOneAndUpdate", "findOneAndDelete", "updateOne",
    "updateMany", "deleteOne", "deleteMany", "count", "countDocuments",
    "aggregate", "insertMany", "save",
  ];
  mongoose.plugin((schema) => {
    operations.forEach((op) => {
      schema.pre(op, function () {
        dbOperations.inc({ op });
      });
    });
  });
}

function metricsMiddleware(req, res, next) {
  if (req.path === "/metrics" || req.path.includes("/stream")) return next();

  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const route = req.route ? req.route.path : req.path;
    httpRequestDuration.observe({
      method: req.method,
      route: route || req.path,
      status: String(res.statusCode),
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
  notificationListeners,
  installDatabaseMetrics,
  metricsMiddleware,
};
