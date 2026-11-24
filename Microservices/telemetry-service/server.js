const express = require("express");
const mongoose = require("mongoose");
const { requestIdMiddleware } = require("../shared/requestId");
const { register, metricsMiddleware } = require("../shared/metrics");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "5022", 10);

app.use(requestIdMiddleware);
app.use(metricsMiddleware);
app.use(express.json());

app.get("/health", (_req, res) => {
  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({ status: "unavailable", database: "disconnected" });
    return;
  }
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

async function start() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error("MONGO_URI must be configured");
  await mongoose.connect(mongoUri);
  app.listen(PORT, "0.0.0.0", () => {
    if (process.env.QUIET !== "1") console.log(`Telemetry service listening on ${PORT}`);
  });
}

start().catch((error) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    service: process.env.SERVICE_NAME || "telemetry",
    variant: process.env.VARIANT || "micro",
    msg: error.message,
  }));
  process.exitCode = 1;
});
