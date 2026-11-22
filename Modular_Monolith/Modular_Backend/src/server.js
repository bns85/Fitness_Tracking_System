// metrics MUST be the first require: registers Mongoose db-operations plugin
const { register, metricsMiddleware } = require("./metrics");
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const connectDB = require("./config/db");

const app = express();

// Request ID middleware (assigns X-Request-Id if missing)
app.use((req, res, next) => {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

// Metrics Middleware (tracks http_request_duration_seconds)
app.use(metricsMiddleware);

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files (shared frontend at repo root or docker volume)
const frontendPath = path.join(__dirname, "../../../Frontend_Shared");
app.use(express.static(frontendPath));

// Health check endpoint (no /api prefix)
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Prometheus Metrics Endpoint (no /api prefix)
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// Meta Endpoint (/api/meta and /meta)
const metaHandler = (req, res) => {
  res.json({
    name: "PulseFlow",
    version: "1.0.0",
    style: "modular-monolith",
    variant: "modular",
  });
};
app.get("/api/meta", metaHandler);
app.get("/meta", metaHandler);

// Serve frontend for root
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// Start server
const start = async () => {
  await connectDB();
  return app.listen(config.port, () => {
    if (!config.quiet) {
      console.log(`🚀 Modular Monolith running on http://localhost:${config.port}`);
      console.log(`📡 Meta endpoint: http://localhost:${config.port}/api/meta`);
      console.log(`🏥 Health check: http://localhost:${config.port}/health`);
    }
  });
};

if (require.main === module) {
  start();
}

module.exports = { app, start };
