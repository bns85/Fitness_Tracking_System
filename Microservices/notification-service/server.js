const express = require("express");
const mongoose = require("mongoose");
const { requestIdMiddleware } = require("../shared/requestId");
const { register, metricsMiddleware, installDatabaseMetrics } = require("../shared/metrics");
const { createNotificationHub } = require("./src/notifications/NotificationHub");

installDatabaseMetrics(mongoose);

const app = express();
const PORT = Number.parseInt(process.env.PORT || "5024", 10);
const hub = createNotificationHub();
const createNotificationRouter = require("./src/routes/notifications");

app.use(requestIdMiddleware);
app.use(metricsMiddleware);
app.use(express.json());
app.use("/api", createNotificationRouter(hub));
app.use("/", createNotificationRouter(hub));

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
    if (process.env.QUIET !== "1") console.log(`Notification service listening on ${PORT}`);
  });
}

start().catch(async (error) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    service: process.env.SERVICE_NAME || "notification",
    variant: process.env.VARIANT || "micro",
    msg: error.message,
  }));
  await hub.close();
  process.exitCode = 1;
});

process.on("SIGTERM", async () => {
  await hub.close();
  await mongoose.disconnect();
  process.exit(0);
});
