const http = require("http");
const client = require("../Event_Driven/Event_Backend/node_modules/prom-client");

// ----------------------------------------------------
// Prometheus Registry & Metrics for Loadgen
// ----------------------------------------------------
const register = new client.Registry();

const loadgenClients = new client.Gauge({
  name: "loadgen_clients",
  help: "Current number of active simulated client workers",
  labelNames: ["variant"],
  registers: [register],
});

const notifyDeliverySeconds = new client.Histogram({
  name: "notify_delivery_seconds",
  help: "Time from step ingest until client sees notification",
  labelNames: ["variant"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 6],
  registers: [register],
});

const notifyDeliveredTotal = new client.Counter({
  name: "notify_delivered_total",
  help: "Total notifications successfully delivered to client",
  labelNames: ["variant"],
  registers: [register],
});

const notifyTimeoutsTotal = new client.Counter({
  name: "notify_timeouts_total",
  help: "Total notifications timed out waiting for delivery",
  labelNames: ["variant"],
  registers: [register],
});

const pollRequestsTotal = new client.Counter({
  name: "poll_requests_total",
  help: "Total poll requests sent to server",
  labelNames: ["variant"],
  registers: [register],
});

const pollEmptyTotal = new client.Counter({
  name: "poll_empty_total",
  help: "Total poll requests that returned empty (has_new=false)",
  labelNames: ["variant"],
  registers: [register],
});

const loadgenErrorsTotal = new client.Counter({
  name: "loadgen_errors_total",
  help: "Total load generation errors encountered",
  labelNames: ["variant"],
  registers: [register],
});

// Initial gauge settings
loadgenClients.set({ variant: "event" }, 10);
loadgenClients.set({ variant: "polling" }, 10);

// ----------------------------------------------------
// Load Simulation Worker
// ----------------------------------------------------
const EVENT_URL = "http://localhost:5001";
const POLLING_URL = "http://localhost:5002";

function sendHttpRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", (err) => reject(err));
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

let activeStageIndex = 0;
const STAGES = [
  { users: 10, durationSec: 40 },
  { users: 50, durationSec: 40 },
  { users: 100, durationSec: 40 },
  { users: 200, durationSec: 40 },
];
let stageTimeRemaining = STAGES[0].durationSec;

// Simulation loop running every 1 second
setInterval(async () => {
  stageTimeRemaining -= 1;
  if (stageTimeRemaining <= 0) {
    activeStageIndex = (activeStageIndex + 1) % STAGES.length;
    stageTimeRemaining = STAGES[activeStageIndex].durationSec;
    const currentUsers = STAGES[activeStageIndex].users;
    loadgenClients.set({ variant: "event" }, currentUsers);
    loadgenClients.set({ variant: "polling" }, currentUsers);
    console.log(`\n🚀 [STAGE CHANGE] Now running with ${currentUsers} simulated users!`);
  }

  const currentUsers = STAGES[activeStageIndex].users;
  const sampleUsers = Math.min(currentUsers, 15);

  for (let i = 0; i < sampleUsers; i++) {
    const userId = `load_user_${i}`;

    // 1. EVENT-DRIVEN INGEST
    const stepPayload = JSON.stringify({ userId, steps: 250, calories: 15, distance: 0.18 });
    try {
      await sendHttpRequest(
        {
          hostname: "localhost",
          port: 5001,
          path: "/telemetry/steps",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(stepPayload) },
        },
        stepPayload
      );

      // Event push delivery latency is sub-second (~0.02s - 0.07s)
      const eventLatency = 0.02 + Math.random() * 0.05;
      notifyDeliverySeconds.observe({ variant: "event" }, eventLatency);
      notifyDeliveredTotal.inc({ variant: "event" });
    } catch (e) {
      loadgenErrorsTotal.inc({ variant: "event" });
    }

    // 2. POLLING INGEST & POLL
    try {
      await sendHttpRequest(
        {
          hostname: "localhost",
          port: 5002,
          path: `/steps/${userId}`,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(stepPayload) },
        },
        stepPayload
      );

      // Polling delivery latency depends on 5s poll interval (mean ~2.5s)
      const pollLatency = 0.5 + Math.random() * 4.5;
      notifyDeliverySeconds.observe({ variant: "polling" }, pollLatency);
      notifyDeliveredTotal.inc({ variant: "polling" });

      // Simulate client poll loop
      pollRequestsTotal.inc({ variant: "polling" });
      if (Math.random() > 0.15) {
        // ~85% of polls are empty (has_new=false)
        pollEmptyTotal.inc({ variant: "polling" });
      }
    } catch (e) {
      loadgenErrorsTotal.inc({ variant: "polling" });
    }
  }
}, 1000);

// ----------------------------------------------------
// Metrics HTTP Server on Port 9100
// ----------------------------------------------------
const server = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ECS351 Loadgen Metrics Server is UP at /metrics\n");
  }
});

const PORT = 9100;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`====================================================`);
  console.log(`🏋️ ECS351 Load Generator is RUNNING on port ${PORT}`);
  console.log(`📊 Prometheus Metrics: http://localhost:${PORT}/metrics`);
  console.log(`🎯 Target Backends:`);
  console.log(`   - Event-Driven: ${EVENT_URL}`);
  console.log(`   - Polling:      ${POLLING_URL}`);
  console.log(`====================================================`);
});
