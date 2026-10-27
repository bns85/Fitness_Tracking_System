const express = require("express");
const cors = require("cors");
const path = require("path");
const config = require("./config");
const connectDB = require("./config/db");
const dashboardRoutes = require("./routes/dashboard");
const notificationRoutes = require("./routes/notification");
const telemetryRoutes = require("./routes/telemetry");
const workoutRoutes = require("./routes/workout");
const { initGoalConsumers } = require("./consumers/goalConsumer");
const { initWorkoutConsumers } = require("./consumers/workoutConsumer");
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
const frontendPath = path.join(__dirname, "../../Story1_Event_Frontend");
app.use(express.static(frontendPath));

// API Routes
app.use("/api", dashboardRoutes);
app.use("/api", notificationRoutes);
app.use("/api", telemetryRoutes);
app.use("/api", workoutRoutes);

// Serve frontend for root
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
const start = async () => {
  await connectDB();
  initGoalConsumers();
  initWorkoutConsumers();
  app.listen(config.port, () => {
    console.log(`🚀 Server running on http://localhost:${config.port}`);
    console.log(`📡 Test Dashboard: http://localhost:${config.port}/api/dashboard/12345`);
    console.log(`📡 Ingest Steps: POST http://localhost:${config.port}/api/telemetry/steps`);
  });
};

start();
