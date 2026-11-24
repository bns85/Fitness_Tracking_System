const express = require("express");
const mongoose = require("mongoose");
const { requestIdMiddleware } = require("../shared/requestId");
const { register, metricsMiddleware, installDatabaseMetrics } = require("../shared/metrics");
const { closeRedis } = require("./src/services/recommendations");

installDatabaseMetrics(mongoose);

const workoutRoutes = require("./src/routes/workouts");
const app = express();
const PORT = Number.parseInt(process.env.PORT || "5025", 10);

app.use(requestIdMiddleware);
app.use(metricsMiddleware);
app.use(express.json());
app.use("/api", workoutRoutes);
app.use("/", workoutRoutes);

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
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI must be configured");
  await mongoose.connect(process.env.MONGO_URI);
  app.listen(PORT, "0.0.0.0", () => {
    if (process.env.QUIET !== "1") console.log(`Workout service listening on ${PORT}`);
  });
}

start().catch(async (error) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    service: process.env.SERVICE_NAME || "workout",
    variant: process.env.VARIANT || "micro",
    msg: error.message,
  }));
  await closeRedis();
  process.exitCode = 1;
});

process.on("SIGTERM", async () => {
  await closeRedis();
  await mongoose.disconnect();
  process.exit(0);
});
