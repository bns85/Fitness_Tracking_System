/**
 * ECS351 Load Generator — REAL measurement version
 *
 * Env (all optional):
 *   STEPS      comma-separated client counts per stage   (default "10,50,100,200")
 *   HOLD_S     seconds to record metrics per stage       (default 120)
 *   WARMUP_S   seconds before recording each stage       (default 20)
 *   RUN_LABEL  run id written into the CSV               (default "run1")
 *   EXP        experiment id / CSV prefix                (default "e1")
 *   POLL_MS    polling interval                          (default 5000)
 *   TIMEOUT_MS per-cycle delivery timeout                (default max(7000, POLL_MS+2000))
 *   WORKER_CAP max concurrent workers per variant        (default 250)
 *   OUT_DIR    CSV directory                             (default benchmark/results)
 *
 * Delivery / ingest percentiles come from RAW wall-clock samples (not Prom histograms).
 * One CSV row per (variant, users) per stage → <EXP>-<RUN_LABEL>-levels.csv
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const client = require("../Event_Driven/Event_Backend/node_modules/prom-client");

// ------------------------------------------------------------------ //
// Config
// ------------------------------------------------------------------ //
const EVENT_URL   = process.env.EVENT_URL   || "http://localhost:5001";
const POLLING_URL = process.env.POLLING_URL || "http://localhost:5002";
const POLL_MS     = parseInt(process.env.POLL_MS || "5000", 10);
const TIMEOUT_MS  = parseInt(
  process.env.TIMEOUT_MS || String(Math.max(7000, POLL_MS + 2000)),
  10
);
const STEPS = (process.env.STEPS || "10,50,100,200")
  .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
const HOLD_S    = parseInt(process.env.HOLD_S || "120", 10);
const WARMUP_S  = parseInt(process.env.WARMUP_S || "20", 10);
const RUN_LABEL = process.env.RUN_LABEL || "run1";
const EXP       = process.env.EXP || "e1";
const WORKER_CAP = parseInt(process.env.WORKER_CAP || "250", 10);
const OUT_DIR   = process.env.OUT_DIR || path.join(__dirname, "results");
const CYCLE_STEPS = 500;

// ------------------------------------------------------------------ //
// Prometheus metrics (Grafana / Prometheus — cumulative across stages)
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
  buckets: [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1, 2, 3, 4, 5, 6, 7, 10, 15, 20, 30],
  registers: [register],
});

const ingestSeconds = new client.Histogram({
  name: "ingest_request_seconds",
  help: "Wall-clock time of the ingest POST itself",
  labelNames: ["variant"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
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
  help: "Poll responses where hasNew was false",
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
// Stage-local recording (raw samples for exact CSV percentiles)
// ------------------------------------------------------------------ //
let stageGeneration = 0;
let recording = false;
let currentUsers = STEPS[0];

const stage = freshStage();

function freshStage() {
  return {
    event:   { delivery: [], ingest: [], delivered: 0, timeouts: 0, errors: 0 },
    polling: { delivery: [], ingest: [], delivered: 0, timeouts: 0, errors: 0 },
    pollReq: 0,
    pollEmpty: 0,
    appStart: null, // { event:{cpu,rss,lag}, polling:{...} }
    appEnd:   null,
  };
}

function pct(samples, p) {
  if (!samples.length) return null;
  const s = samples.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

function mean(samples) {
  if (!samples.length) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

function round(x, d = 6) {
  if (x === null || x === undefined || Number.isNaN(x)) return "";
  const f = 10 ** d;
  return String(Math.round(x * f) / f);
}

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

async function fetchMetricsText(base) {
  try {
    const r = await httpGet(`${base}/metrics`);
    return r.body || "";
  } catch (_) {
    return "";
  }
}

function parseGauge(text, name) {
  const re = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)`, "m");
  const m = text.match(re);
  return m ? parseFloat(m[1]) : null;
}

async function snapshotApps() {
  const [evText, poText] = await Promise.all([
    fetchMetricsText(EVENT_URL),
    fetchMetricsText(POLLING_URL),
  ]);
  const grab = (t) => ({
    cpu: parseGauge(t, "process_cpu_seconds_total"),
    rss: parseGauge(t, "process_resident_memory_bytes"),
    lag: parseGauge(t, "nodejs_eventloop_lag_p99_seconds"),
  });
  return { event: grab(evText), polling: grab(poText) };
}

// ------------------------------------------------------------------ //
// Setup: fresh userId + goal before each ingest cycle
// ------------------------------------------------------------------ //
let cycleSeq = 0;

async function ensureGoal(base, userId, target) {
  try {
    await httpPost(`${base}/api/goals`, { userId, type: "steps", target });
  } catch (_) { /* setup best-effort */ }
}

// ------------------------------------------------------------------ //
// One event cycle: open SSE, ingest, hold listener until TIMEOUT_MS
// ------------------------------------------------------------------ //
async function eventCycle(userId, gen) {
  return new Promise((resolve) => {
    if (gen !== stageGeneration) { resolve(); return; }

    const sseUrl = new URL(`${EVENT_URL}/api/notifications/${userId}/stream`);
    let notified = false;
    let startMs  = null;
    let sseReq   = null;
    let buffer   = "";
    let settled  = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try { if (sseReq) sseReq.destroy(); } catch (_) {}
      resolve();
    };

    sseReq = http.get(
      {
        hostname: sseUrl.hostname, port: sseUrl.port, path: sseUrl.pathname,
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith("data:") && startMs !== null && !notified) {
              try {
                const payload = JSON.parse(line.slice(5).trim());
                if (payload && payload.type === "GOAL_REACHED") {
                  notified = true;
                  const latency = (Date.now() - startMs) / 1000;
                  notifyDeliverySeconds.observe({ variant: "event" }, latency);
                  notifyDeliveredTotal.inc({ variant: "event" });
                  if (recording && gen === stageGeneration) {
                    stage.event.delivery.push(latency);
                    stage.event.delivered += 1;
                  }
                }
              } catch (_) {}
            }
          }
        });
        res.on("error", () => {});
      }
    );
    sseReq.on("error", () => {});

    setTimeout(async () => {
      try {
        startMs = Date.now();
        const t0 = Date.now();
        await httpPost(`${EVENT_URL}/api/telemetry/steps`, {
          userId, steps: CYCLE_STEPS, calories: 15, distance: 0.18,
        });
        const ingestLat = (Date.now() - t0) / 1000;
        ingestSeconds.observe({ variant: "event" }, ingestLat);
        if (recording && gen === stageGeneration) stage.event.ingest.push(ingestLat);
      } catch (e) {
        loadgenErrorsTotal.inc({ variant: "event" });
        if (recording && gen === stageGeneration) stage.event.errors += 1;
      }

      setTimeout(() => {
        if (!notified) {
          notifyTimeoutsTotal.inc({ variant: "event" });
          if (recording && gen === stageGeneration) stage.event.timeouts += 1;
        }
        finish();
      }, TIMEOUT_MS);
    }, 100);
  });
}

// ------------------------------------------------------------------ //
// One polling cycle: ingest then poll until TIMEOUT_MS
// ------------------------------------------------------------------ //
async function pollingCycle(userId, gen) {
  if (gen !== stageGeneration) return;

  let startMs = null;
  let notified = false;

  try {
    startMs = Date.now();
    const t0 = Date.now();
    await httpPost(`${POLLING_URL}/api/steps/${userId}`, {
      userId, steps: CYCLE_STEPS, calories: 15, distance: 0.18,
    });
    const ingestLat = (Date.now() - t0) / 1000;
    ingestSeconds.observe({ variant: "polling" }, ingestLat);
    if (recording && gen === stageGeneration) stage.polling.ingest.push(ingestLat);
  } catch (e) {
    loadgenErrorsTotal.inc({ variant: "polling" });
    if (recording && gen === stageGeneration) stage.polling.errors += 1;
    return;
  }

  const deadline = startMs + TIMEOUT_MS;
  while (Date.now() < deadline && gen === stageGeneration) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (Date.now() >= deadline || gen !== stageGeneration) break;
    try {
      pollRequestsTotal.inc({ variant: "polling" });
      if (recording && gen === stageGeneration) stage.pollReq += 1;
      const res = await httpGet(`${POLLING_URL}/api/notifications/${userId}/poll`);
      let parsed;
      try { parsed = JSON.parse(res.body); } catch (_) { parsed = {}; }
      const hasNew = parsed.hasNew === true || parsed.has_new === true;
      if (hasNew) {
        if (!notified) {
          notified = true;
          const latency = (Date.now() - startMs) / 1000;
          notifyDeliverySeconds.observe({ variant: "polling" }, latency);
          notifyDeliveredTotal.inc({ variant: "polling" });
          if (recording && gen === stageGeneration) {
            stage.polling.delivery.push(latency);
            stage.polling.delivered += 1;
          }
        }
      } else {
        pollEmptyTotal.inc({ variant: "polling" });
        if (recording && gen === stageGeneration) stage.pollEmpty += 1;
      }
    } catch (e) {
      loadgenErrorsTotal.inc({ variant: "polling" });
      if (recording && gen === stageGeneration) stage.polling.errors += 1;
    }
  }

  if (!notified) {
    notifyTimeoutsTotal.inc({ variant: "polling" });
    if (recording && gen === stageGeneration) stage.polling.timeouts += 1;
  }
}

// ------------------------------------------------------------------ //
// Long-lived worker loops — one per (variant, slot), live for one stage
// ------------------------------------------------------------------ //
async function eventWorkerLoop(slot, gen) {
  let i = 0;
  while (gen === stageGeneration) {
    const userId = `load_${EXP}_${RUN_LABEL}_s${currentUsers}_w${slot}_c${i++}_${cycleSeq++}`;
    await ensureGoal(EVENT_URL, userId, CYCLE_STEPS);
    if (gen !== stageGeneration) break;
    await eventCycle(userId, gen);
  }
}

async function pollingWorkerLoop(slot, gen) {
  let i = 0;
  while (gen === stageGeneration) {
    const userId = `load_${EXP}_${RUN_LABEL}_s${currentUsers}_w${slot}_c${i++}_${cycleSeq++}`;
    await ensureGoal(POLLING_URL, userId, CYCLE_STEPS);
    if (gen !== stageGeneration) break;
    await pollingCycle(userId, gen);
  }
}

function startStageWorkers(users) {
  stageGeneration += 1;
  const gen = stageGeneration;
  const n = Math.min(users, WORKER_CAP);
  loadgenClients.set({ variant: "event" }, n);
  loadgenClients.set({ variant: "polling" }, n);
  for (let i = 0; i < n; i++) {
    eventWorkerLoop(i, gen).catch(() => {});
    pollingWorkerLoop(i, gen).catch(() => {});
  }
  console.log(`[STAGE] start users=${users} workers/variant=${n} gen=${gen}`);
  return gen;
}

// ------------------------------------------------------------------ //
// CSV
// ------------------------------------------------------------------ //
const CSV_HEADER = [
  "exp","run_label","variant","users","hold_s","warmup_s","poll_ms",
  "delivery_p50_s","delivery_p95_s","delivery_p99_s","delivery_mean_s",
  "delivery_n","delivery_timeouts",
  "ingest_p50_s","ingest_p95_s","ingest_p99_s","ingest_mean_s","ingest_n","ingest_errors",
  "notify_delivered","poll_requests","poll_empty","poll_empty_share",
  "app_cpu_delta_s","app_rss_bytes","eventloop_lag_p99_s","workers",
].join(",");

function csvPath() {
  return path.join(OUT_DIR, `${EXP}-${RUN_LABEL}-levels.csv`);
}

function appendCsvRows(users) {
  const rows = [];
  const dur = HOLD_S;
  for (const variant of ["event", "polling"]) {
    const v = stage[variant];
    const d = v.delivery;
    const ing = v.ingest;
    const pollEmptyShare =
      variant === "polling" && stage.pollReq > 0
        ? stage.pollEmpty / stage.pollReq
        : null;

    let cpuDelta = null;
    let rss = null;
    let lag = null;
    if (stage.appStart && stage.appEnd) {
      const a = stage.appStart[variant] || {};
      const b = stage.appEnd[variant] || {};
      if (a.cpu != null && b.cpu != null) cpuDelta = b.cpu - a.cpu;
      rss = b.rss != null ? b.rss : null;
      lag = b.lag != null ? b.lag : null;
    }

    const workers = Math.min(currentUsers, WORKER_CAP);
    const row = [
      EXP, RUN_LABEL, variant, users, HOLD_S, WARMUP_S, POLL_MS,
      round(pct(d, 50)), round(pct(d, 95)), round(pct(d, 99)), round(mean(d)),
      d.length, v.timeouts,
      round(pct(ing, 50)), round(pct(ing, 95)), round(pct(ing, 99)), round(mean(ing)),
      ing.length, v.errors,
      v.delivered,
      variant === "polling" ? stage.pollReq : "",
      variant === "polling" ? stage.pollEmpty : "",
      pollEmptyShare != null ? round(pollEmptyShare, 4) : "",
      round(cpuDelta, 4), rss != null ? String(Math.round(rss)) : "", round(lag, 6),
      workers,
    ].join(",");
    rows.push(row);
  }

  const file = csvPath();
  const needHeader = !fs.existsSync(file) || fs.statSync(file).size === 0;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(file, (needHeader ? CSV_HEADER + "\n" : "") + rows.join("\n") + "\n");
  console.log(`[CSV] appended ${rows.length} rows → ${file}`);
}

// ------------------------------------------------------------------ //
// Stage runner
// ------------------------------------------------------------------ //
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runAllStages() {
  console.log("================================================");
  console.log(`EXP=${EXP} RUN_LABEL=${RUN_LABEL}`);
  console.log(`Stages        : ${STEPS.join(" → ")} users`);
  console.log(`HOLD_S/WARMUP : ${HOLD_S}/${WARMUP_S}`);
  console.log(`Poll interval : ${POLL_MS} ms  Timeout: ${TIMEOUT_MS} ms`);
  console.log(`Worker cap    : ${WORKER_CAP} per variant`);
  console.log(`CSV           : ${csvPath()}`);
  console.log("================================================");

  for (const users of STEPS) {
    currentUsers = users;
    // fresh stage buffers; reset recording counters via object replace is not
    // possible (const stage) — clear arrays/fields instead.
    stage.event.delivery.length = 0;
    stage.event.ingest.length = 0;
    stage.event.delivered = 0; stage.event.timeouts = 0; stage.event.errors = 0;
    stage.polling.delivery.length = 0;
    stage.polling.ingest.length = 0;
    stage.polling.delivered = 0; stage.polling.timeouts = 0; stage.polling.errors = 0;
    stage.pollReq = 0; stage.pollEmpty = 0;
    stage.appStart = null; stage.appEnd = null;
    recording = false;

    startStageWorkers(users);

    console.log(`[WARMUP] ${users} users for ${WARMUP_S}s`);
    await sleep(WARMUP_S * 1000);

    stage.appStart = await snapshotApps();
    recording = true;
    console.log(`[HOLD] ${users} users for ${HOLD_S}s (recording)`);
    await sleep(HOLD_S * 1000);
    recording = false;
    stage.appEnd = await snapshotApps();

    appendCsvRows(users);
    console.log(
      `[STAGE DONE] ${users}u event_del=${stage.event.delivery.length} ` +
      `poll_del=${stage.polling.delivery.length} poll_req=${stage.pollReq} ` +
      `empty_share=${stage.pollReq ? (stage.pollEmpty / stage.pollReq).toFixed(3) : "n/a"}`
    );
  }

  // stop workers
  stageGeneration += 1;
  loadgenClients.set({ variant: "event" }, 0);
  loadgenClients.set({ variant: "polling" }, 0);
  console.log(`[ALL STAGES DONE] → ${csvPath()}`);
  // give Prometheus a scrape tick, then exit so runners can chain
  await sleep(6000);
  process.exit(0);
}

// ------------------------------------------------------------------ //
// Metrics server :9100
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
  runAllStages().catch((err) => {
    console.error("[FATAL]", err);
    process.exit(1);
  });
});
