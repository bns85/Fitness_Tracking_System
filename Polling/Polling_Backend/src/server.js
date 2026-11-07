
const express = require("express");
const cors = require("cors");
const path = require("path");
const config = require("./config");
const connectDB = require("./config/db");
const dashboardRoutes = require("./routes/dashboard");
const notificationRoutes = require("./routes/notification");
const workoutRoutes = require("./routes/workout");
const { startGoalPollingWorker } = require("./workers/goalPollingWorker");

const app = express();

// Serve Polling frontend
const frontendPath = path.join(__dirname, "../../Polling_Frontend");
app.use(express.static(frontendPath));

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: true,
}));

app.use(express.json());

// API routes
app.use("/api", dashboardRoutes);
app.use("/api", notificationRoutes);
app.use("/api", workoutRoutes);

// Frontend route
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    architecture: "polling",
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(config.port, () => {
  console.log(`PulseFlow [POLLING] running on http://localhost:${config.port}`);
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Cache TTL: ${config.cacheTTL}s`);
  console.log(`Dashboard: http://localhost:${config.port}/api/dashboard/1503960366`);
  console.log(`Poll Notifications: http://localhost:${config.port}/api/notifications/:userId/poll`);

  startGoalPollingWorker();
});

// Connect database
connectDB();

