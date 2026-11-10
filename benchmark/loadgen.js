/**
 * ECS351 Load Generator — REAL measurement version
 *
 * What changed from the previous version:
 *  - Event-driven: opens a real SSE connection, sends the ingest POST,
 *    measures wall-clock time from POST response to SSE notification arrival.
 *  - Polling: sends the ingest POST, then polls GET every POLL_MS ms until
 *    has_new=true or timeout, measuring wall-clock delivery time.
 *  - Empty-poll rate is counted from real server responses (has_new field).
 *  - Delivery latency is NO LONGER simulated with Math.random().
 *  - SSE connections are held open for the FULL cycle (not closed immediately
 *    after the POST), so the bias from premature close is eliminated.
 */

const http = require("http");
const client = require("../Event_Driven/Event_Backend/node_modules/prom-client");

// ------------------------------------------------------------------ //
// Config — override with env vars if needed
// ------------------------------------------------------------------ //
const EVENT_URL   = process.env.EVENT_URL   || "http://localhost:5001";
const POLLING_URL = process.env.POLLING_URL || "http://localhost:5002";
const POLL_MS     = parseInt(process.env.POLL_MS  || "5000", 10);
const TIMEOUT_MS  = parseInt(process.env.TIMEOUT_MS || "7000", 10);  // per cycle
const STAGES = [
  { users: 10,  durationSec: 60 },
  { users: 50,  durationSec: 60 },
  { users: 100, durationSec: 60 },
  { users: 200, durationSec: 60 },
];

// ------------------------------------------------------------------ //
// Prometheus metrics
// ------------------------------------------------------------------ //
const register = new client.Registry();

const loadgenClients = new client.Gauge({
  name: "loadgen_clients",
  help: "Current number of simulated client workers",
  labelNames: ["variant"],
  registers: [register],
});

const notifyDeliverySeconds = new client.Histogram({
  name: "notify_delivery_seconds",
  help: "Wall-clock time from ingest POST response to notification received",
  labelNames: ["variant"],
  buckets: [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7],
  registers: [register],
});

const notifyDeliveredTotal = new client.Counter({
  name: "notify_delivered_total",
  help: "Notifications successfully received within timeout",
  labelNames: ["variant"],
  registers: [register],
});

const notifyTimeoutsTotal = new client.Counter({
  name: "notify_timeouts_total",
  help: "Notification cycles that timed out",
  labelNames: ["variant"],
  registers: [register],
});

const pollRequestsTotal = new client.Counter({
  name: "poll_requests_total",
  help: "Total poll GET requests issued",
  labelNames: ["variant"],
  registers: [register],
});

const pollEmptyTotal = new client.Counter({
  name: "poll_empty_total",
  help: "Poll responses where has_new was false",
  labelNames: ["variant"],
  registers: [register],
});

const loadgenErrorsTotal = new client.Counter({
  name: "loadgen_errors_total",
  help: "HTTP or parse errors in load gen",
  labelNames: ["variant"],
  registers: [register],
});

// ------------------------------------------------------------------ //
// HTTP helpers
// ------------------------------------------------------------------ //
function httpPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlStr);
    const data = JSON.stringify(body);
    const req  = http.request(
      {
        hostname: url.hostname,
        port:     url.port,
        path:     url.pathname,
        method:   "POST",
        headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end",  () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("POST timeout")); });
    req.write(data);
    req.end();
  });
}

function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET" },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end",  () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("GET timeout")); });
    req.end();
  });
}

// ------------------------------------------------------------------ //
// Event-driven worker: open SSE, ingest, wait for push, then sleep
// ------------------------------------------------------------------ //
async function eventWorker(userId, cycleSteps) {
  return new Promise((resolve) => {
    const sseUrl = new URL(`${EVENT_URL}/api/notifications/${userId}/stream`);
    let notified   = false;
    let startMs    = null;
    let sseReq     = null;
    let buffer     = "";

    // --- open SSE connection BEFORE ingest so we don't miss the push ---
    sseReq = http.get(
      { hostname: sseUrl.hostname, port: sseUrl.port, path: sseUrl.pathname,
        headers: { Accept: "text/event-stream" } },
      (res) => {
        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();               // keep partial last line
          for (const line of lines) {
            if (line.startsWith("data:") && startMs !== null && !notified) {
              try {
                const payload = JSON.parse(line.slice(5).trim());
                if (payload && payload.type === "GOAL_REACHED") {
                  notified = true;
                  const latency = (Date.now() - startMs) / 1000;
                  notifyDeliverySeconds.observe({ variant: "event" }, latency);
                  notifyDeliveredTotal.inc({ variant: "event" });
                  sseReq.destroy();
                  resolve();
                }
              } catch (_) {}
            }
          }
        });
        res.on("error", () => {});
      }
    );
    sseReq.on("error", () => {});

    // Give SSE 100 ms to establish, then send the ingest POST
    setTimeout(async () => {
      try {
        startMs = Date.now();
        await httpPost(`${EVENT_URL}/api/telemetry/steps`, {
          userId, steps: cycleSteps, calories: 15, distance: 0.18,
        });
      } catch (e) {
        loadgenErrorsTotal.inc({ variant: "event" });
      }

      // Timeout: if no GOAL_REACHED within TIMEOUT_MS, give up
      setTimeout(() => {
        if (!notified) {
          notifyTimeoutsTotal.inc({ variant: "event" });
          sseReq.destroy();
          resolve();
        }
      }, TIMEOUT_MS);
    }, 100);
  });
}

// ------------------------------------------------------------------ //
// Polling worker: ingest then poll until has_new or timeout
// ------------------------------------------------------------------ //
async function pollingWorker(userId, cycleSteps) {
  let startMs = null;
  let notified = false;

  try {
    startMs = Date.now();
    await httpPost(`${POLLING_URL}/api/steps/${userId}`, {
      userId, steps: cycleSteps, calories: 15, distance: 0.18,
    });
  } catch (e) {
    loadgenErrorsTotal.inc({ variant: "polling" });
    return;
  }

  // Poll until notification or timeout — connection closes after each GET
  const deadline = startMs + TIMEOUT_MS;
  while (Date.now() < deadline && !notified) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (Date.now() >= deadline) break;
    try {
      pollRequestsTotal.inc({ variant: "polling" });
      const res = await httpGet(`${POLLING_URL}/api/notifications/${userId}/poll`);
      let parsed;
      try { parsed = JSON.parse(res.body); } catch (_) { parsed = {}; }
      if (parsed.has_new) {
        notified = true;
        const latency = (Date.now() - startMs) / 1000;
        notifyDeliverySeconds.observe({ variant: "polling" }, latency);
        notifyDeliveredTotal.inc({ variant: "polling" });
      } else {
        pollEmptyTotal.inc({ variant: "polling" });
      }
    } catch (e) {
      loadgenErrorsTotal.inc({ variant: "polling" });
    }
  }

  if (!notified) {
    notifyTimeoutsTotal.inc({ variant: "polling" });
  }
}

// ------------------------------------------------------------------ //
// Stage controller
// ------------------------------------------------------------------ //
let activeStageIndex = 0;
let stageTimeRemaining = STAGES[0].durationSec;
let currentUsers = STAGES[0].users;

loadgenClients.set({ variant: "event" },   currentUsers);
loadgenClients.set({ variant: "polling" }, currentUsers);

setInterval(() => {
  stageTimeRemaining--;
  if (stageTimeRemaining <= 0) {
    activeStageIndex     = (activeStageIndex + 1) % STAGES.length;
    stageTimeRemaining   = STAGES[activeStageIndex].durationSec;
    currentUsers         = STAGES[activeStageIndex].users;
    loadgenClients.set({ variant: "event" },   currentUsers);
    loadgenClients.set({ variant: "polling" }, currentUsers);
    console.log(`[STAGE] ${currentUsers} users`);
  }
}, 1000);

// ------------------------------------------------------------------ //
// Worker dispatch — cap concurrent workers at min(users, 20)
// to avoid exhausting file descriptors on a laptop
// ------------------------------------------------------------------ //
const WORKER_CAP = 20;

setInterval(() => {
  const n = Math.min(currentUsers, WORKER_CAP);
  // Each user gets enough steps to reliably reach their goal this cycle.
  // Using 500 steps per cycle; a typical daily goal is 10 000 steps, so
  // after ~20 cycles the goal fires. Keeps the notification rate realistic.
  const cycleSteps = 500;

  for (let i = 0; i < n; i++) {
    const userId = `load_user_${i}`;
    eventWorker(userId, cycleSteps).catch(() => {});
    pollingWorker(userId, cycleSteps).catch(() => {});
  }
}, 2000);  // fire a new batch every 2 s

// ------------------------------------------------------------------ //
// Prometheus metrics server on port 9100
// ------------------------------------------------------------------ //
const server = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  } else {
    res.writeHead(200);
    res.end("ECS351 Real Loadgen — metrics at /metrics\n");
  }
});
server.listen(9100, "0.0.0.0", () => {
  console.log("================================================");
  console.log("ECS351 REAL Load Generator — port 9100");
  console.log(`Poll interval : ${POLL_MS} ms`);
  console.log(`Timeout       : ${TIMEOUT_MS} ms`);
  console.log(`Stages        : ${STAGES.map(s => s.users+"u/"+s.durationSec+"s").join(" → ")}`);
  console.log(`Event backend : ${EVENT_URL}`);
  console.log(`Poll backend  : ${POLLING_URL}`);
  console.log("================================================");
});
