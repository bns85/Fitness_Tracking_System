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
let client;
try { client = require("../Event_Driven/Event_Backend/node_modules/prom-client"); }
catch (_) { client = require("prom-client"); }
const LOADGEN_VERSION = "v2-openloop";

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
// v2: both variants use the SAME fixed-length cycle (open loop), so the offered load is equal.
const THINK_MIN_S = parseFloat(process.env.THINK_MIN_S || "1");
const THINK_MAX_S = parseFloat(process.env.THINK_MAX_S || "6");
const CYCLE_MS = Math.max(
  parseFloat(process.env.CYCLE_S || "15") * 1000,
  THINK_MAX_S * 1000 + TIMEOUT_MS + 1000
);
const rand = (a, b) => a + Math.random() * (b - a);

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
  buckets: [0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05, 0.06, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 10, 15],
  registers: [register],
});

const ingestSeconds = new client.Histogram({
  name: "ingest_request_seconds",
  help: "Wall-clock time of the ingest POST itself",
  labelNames: ["variant"],
  buckets: [0.001, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1],
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
// Helpers for fixed-length cycles
// ------------------------------------------------------------------ //
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sleepUntil(endMs, gen) {
  while (Date.now() < endMs && gen === stageGeneration) {
    await sleep(Math.min(250, Math.max(1, endMs - Date.now())));
  }
}

// ------------------------------------------------------------------ //
// One event cycle: open SSE, think, ingest, wait for the push, hold the
// connection until the END of the cycle (like a real client).
// Delivery latency = time from just before the ingest POST to the push arriving.
// ------------------------------------------------------------------ //
async function eventCycle(userId, gen, cycleEnd) {
  const sseUrl = new URL(`${EVENT_URL}/api/notifications/${userId}/stream`);
  let notified = false;
  let t0 = null;
  let inWindow = false;
  let buffer = "";

  const sseReq = http.get(
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
          if (line.startsWith("data:") && t0 !== null && !notified) {
            try {
              const payload = JSON.parse(line.slice(5).trim());
              if (payload && payload.type === "GOAL_REACHED") {
                notified = true;
                const latency = (Date.now() - t0) / 1000;
                notifyDeliverySeconds.observe({ variant: "event" }, latency);
                notifyDeliveredTotal.inc({ variant: "event" });
                if (inWindow) {
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

  try {
    await sleep(rand(THINK_MIN_S, THINK_MAX_S) * 1000);
    if (gen !== stageGeneration) return;
    inWindow = recording && gen === stageGeneration;
    t0 = Date.now();
    try {
      await httpPost(`${EVENT_URL}/api/telemetry/steps`, {
        userId, steps: CYCLE_STEPS, calories: 15, distance: 0.18,
      });
      const ingestLat = (Date.now() - t0) / 1000;
      ingestSeconds.observe({ variant: "event" }, ingestLat);
      if (inWindow) stage.event.ingest.push(ingestLat);
    } catch (e) {
      loadgenErrorsTotal.inc({ variant: "event" });
      if (inWindow) stage.event.errors += 1;
    }
    const deadline = t0 + TIMEOUT_MS;
    while (!notified && Date.now() < deadline && gen === stageGeneration) await sleep(20);
    if (!notified && gen === stageGeneration) {
      notifyTimeoutsTotal.inc({ variant: "event" });
      if (inWindow) stage.event.timeouts += 1;
    }
    await sleepUntil(cycleEnd, gen);
  } finally {
    try { sseReq.destroy(); } catch (_) {}
  }
}

// ------------------------------------------------------------------ //
// One polling cycle: the client polls on ITS OWN clock (fixed cadence, random
// phase) for the whole cycle; the ingest happens at a random moment inside it.
// Delivery latency = time from just before the ingest POST to the poll response
// that first shows the notification. Polls that bring nothing new (before the
// ingest, or after the client already has the notification) count as empty.
// ------------------------------------------------------------------ //
async function pollingCycle(userId, gen, cycleEnd) {
  let t0 = null;
  let notified = false;
  let inWindow = false;
  let stopped = false;

  const napWhile = async (ms) => {
    const end = Date.now() + ms;
    while (!stopped && Date.now() < end) await sleep(Math.min(100, Math.max(1, end - Date.now())));
  };
  (async () => {
    await napWhile(Math.random() * POLL_MS); // random phase
    let next = Date.now();
    while (!stopped && Date.now() < cycleEnd && gen === stageGeneration) {
      const rec = recording && gen === stageGeneration;
      pollRequestsTotal.inc({ variant: "polling" });
      if (rec) stage.pollReq += 1;
      try {
        const res = await httpGet(`${POLLING_URL}/api/notifications/${userId}/poll`);
        let parsed;
        try { parsed = JSON.parse(res.body); } catch (_) { parsed = {}; }
        const hasNew = parsed.hasNew === true || parsed.has_new === true;
        const now = Date.now();
        if (hasNew && !notified && t0 !== null) {
          notified = true;
          const latency = (now - t0) / 1000;
          notifyDeliverySeconds.observe({ variant: "polling" }, latency);
          notifyDeliveredTotal.inc({ variant: "polling" });
          if (inWindow) {
            stage.polling.delivery.push(latency);
            stage.polling.delivered += 1;
          }
        } else {
          pollEmptyTotal.inc({ variant: "polling" });
          if (rec) stage.pollEmpty += 1;
        }
      } catch (e) {
        loadgenErrorsTotal.inc({ variant: "polling" });
        if (inWindow) stage.polling.errors += 1;
      }
      next += POLL_MS;
      const wait = next - Date.now();
      if (wait > 0) await napWhile(wait); else next = Date.now();
    }
  })();

  try {
    await sleep(rand(THINK_MIN_S, THINK_MAX_S) * 1000);
    if (gen !== stageGeneration) return;
    inWindow = recording && gen === stageGeneration;
    t0 = Date.now();
    try {
      await httpPost(`${POLLING_URL}/api/steps/${userId}`, {
        userId, steps: CYCLE_STEPS, calories: 15, distance: 0.18,
      });
      const ingestLat = (Date.now() - t0) / 1000;
      ingestSeconds.observe({ variant: "polling" }, ingestLat);
      if (inWindow) stage.polling.ingest.push(ingestLat);
    } catch (e) {
      loadgenErrorsTotal.inc({ variant: "polling" });
      if (inWindow) stage.polling.errors += 1;
    }
    const deadline = t0 + TIMEOUT_MS;
    while (!notified && Date.now() < deadline && gen === stageGeneration) await sleep(50);
    if (!notified && gen === stageGeneration) {
      notifyTimeoutsTotal.inc({ variant: "polling" });
      if (inWindow) stage.polling.timeouts += 1;
    }
    await sleepUntil(cycleEnd, gen);
  } finally {
    stopped = true; // the poll loop exits on its own within ~100 ms; do not wait for it
  }
}

// ------------------------------------------------------------------ //
// Long-lived worker loops: one per (variant, slot), fixed-length cycles
// ------------------------------------------------------------------ //
async function eventWorkerLoop(slot, gen) {
  await sleep(Math.random() * CYCLE_MS); // de-synchronise workers
  let i = 0;
  let cycleStart = Date.now();
  while (gen === stageGeneration) {
    if (Date.now() > cycleStart + CYCLE_MS) cycleStart = Date.now(); // fell behind: resync
    const cycleEnd = cycleStart + CYCLE_MS;
    cycleStart = cycleEnd;
    const userId = `load_${EXP}_${RUN_LABEL}_s${currentUsers}_w${slot}_c${i++}_${cycleSeq++}`;
    await ensureGoal(EVENT_URL, userId, CYCLE_STEPS);
    if (gen !== stageGeneration) break;
    await eventCycle(userId, gen, cycleEnd);
    await sleepUntil(cycleEnd, gen);
  }
}

async function pollingWorkerLoop(slot, gen) {
  await sleep(Math.random() * CYCLE_MS); // de-synchronise workers
  let i = 0;
  let cycleStart = Date.now();
  while (gen === stageGeneration) {
    if (Date.now() > cycleStart + CYCLE_MS) cycleStart = Date.now(); // fell behind: resync
    const cycleEnd = cycleStart + CYCLE_MS;
    cycleStart = cycleEnd;
    const userId = `load_${EXP}_${RUN_LABEL}_s${currentUsers}_w${slot}_c${i++}_${cycleSeq++}`;
    await ensureGoal(POLLING_URL, userId, CYCLE_STEPS);
    if (gen !== stageGeneration) break;
    await pollingCycle(userId, gen, cycleEnd);
    await sleepUntil(cycleEnd, gen);
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
  "delivery_min_s","delivery_max_s","ingest_per_s","notifications_per_s","poll_requests_per_s",
  "cycle_s","think_min_s","think_max_s","timeout_ms","loadgen_version",
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
      round(d.length ? Math.min(...d) : null), round(d.length ? Math.max(...d) : null),
      round(ing.length / HOLD_S, 4), round(v.delivered / HOLD_S, 4),
      variant === "polling" ? round(stage.pollReq / HOLD_S, 4) : "",
      CYCLE_MS / 1000, THINK_MIN_S, THINK_MAX_S, TIMEOUT_MS, LOADGEN_VERSION,
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
function validateStage(users) {
  const e = stage.event, p = stage.polling;
  const rel = (a, b) => (b ? Math.abs(a - b) / b : 0);
  if (e.ingest.length >= 30 && p.ingest.length >= 30 && rel(e.ingest.length, p.ingest.length) > 0.05) {
    console.log(`[WARN] ${users}u: offered load differs (ingest_n event=${e.ingest.length} polling=${p.ingest.length})`);
  }
  if (p.delivery.length >= 100) {
    const m = mean(p.delivery);
    if (rel(m, POLL_MS / 2000) > 0.15) {
      console.log(`[WARN] ${users}u: polling mean ${m.toFixed(2)}s is far from POLL_MS/2=${POLL_MS / 2000}s (check poll phase)`);
    }
  }
  for (const [name, v] of [["event", e], ["polling", p]]) {
    if (v.delivery.length) {
      const m = mean(v.delivery);
      if (m < Math.min(...v.delivery) - 1e-9 || m > Math.max(...v.delivery) + 1e-9) {
        console.log(`[WARN] ${users}u ${name}: mean outside min/max (data bug)`);
      }
    }
    const total = v.delivered + v.timeouts;
    if (total > 0 && v.timeouts / total > 0.02) {
      console.log(`[WARN] ${users}u ${name}: ${(100 * v.timeouts / total).toFixed(1)}% timeouts`);
    }
  }
}

async function runAllStages() {
  console.log("================================================");
  console.log(`EXP=${EXP} RUN_LABEL=${RUN_LABEL}`);
  console.log(`Stages        : ${STEPS.join(" → ")} users`);
  console.log(`HOLD_S/WARMUP : ${HOLD_S}/${WARMUP_S}`);
  console.log(`Poll interval : ${POLL_MS} ms  Timeout: ${TIMEOUT_MS} ms`);
  console.log(`Worker cap    : ${WORKER_CAP} per variant`);
  console.log(`Cycle         : ${CYCLE_MS / 1000}s fixed (think ${THINK_MIN_S}-${THINK_MAX_S}s)  version=${LOADGEN_VERSION}`);
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
    validateStage(users);
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
