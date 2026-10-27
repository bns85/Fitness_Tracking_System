const express = require("express");
const cors = require("cors");
const config = require("./config");
const connectDB = require("./config/db");
const dashboardRoutes = require("./routes/dashboard");
const notificationRoutes = require("./routes/notification");
const workoutRoutes = require("./routes/workout");
const { startGoalPollingWorker } = require("./workers/goalPollingWorker");

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: true,
}));
app.use(express.json());

app.use("/api", dashboardRoutes);
app.use("/api", notificationRoutes);
app.use("/api", workoutRoutes);

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "PulseFlow - Polling Architecture",
    architecture: "POLLING",
    description: "Client polls the server at fixed intervals to fetch updated data.",
    pollIntervalMs: config.pollIntervalMs,
    endpoints: {
      health: `http://localhost:${config.port}/health`,
      dashboard: `http://localhost:${config.port}/api/dashboard/:userId`,
      pollNotifications: `GET /api/notifications/:userId/poll`,
      longPollNotifications: `GET /api/notifications/:userId/long-poll`,
      unreadCount: `GET /api/notifications/:userId/unread-count`,
      notificationsList: `GET /api/notifications/:userId`,
      logSleep: `POST /api/sleep/:userId`,
      startWalk: `POST /api/walk/:userId/start`,
      stopWalk: `POST /api/walk/:userId/stop`,
      logCalories: `POST /api/calories/:userId`,
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", architecture: "polling", timestamp: new Date().toISOString() });
});

// Start server immediately, connect to DB in background
app.listen(config.port, () => {
  console.log(`PulseFlow [POLLING] running on http://localhost:${config.port}`);
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Cache TTL: ${config.cacheTTL}s`);
  console.log(`Dashboard: http://localhost:${config.port}/api/dashboard/1503960366`);
  console.log(`Poll Notifications: http://localhost:${config.port}/api/notifications/:userId/poll`);
  startGoalPollingWorker();
});

// DB connection is non-blocking
connectDB();
