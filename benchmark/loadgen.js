/**
 * PulseFlow Load Generator v3 — Three-Variant Architecture Benchmark
 *
 * Supports three primary variants + legacy polling:
 *   - event   (Event-Driven with SSE push, port 5001)
 *   - modular (Modular Monolith with SSE push, port 5011)
 *   - micro   (Microservices with SSE push via Gateway, port 5021)
 *   - polling (Legacy periodic polling, port 5002)
 *
 * Env options:
 *   VARIANT         single variant to test: event | modular | micro | polling
 *   VARIANTS        comma-separated variants (default: "event,modular,micro" or single VARIANT)
 *   EVENT_URL       URL for event-driven backend       (default http://localhost:5001)
 *   MODULAR_URL     URL for modular monolith backend   (default http://localhost:5011)
 *   MICRO_URL       URL for microservices gateway      (default http://localhost:5021)
 *   POLLING_URL     URL for legacy polling backend     (default http://localhost:5002)
 *   STEPS           comma-separated client counts      (default "10,50,100,200", up to 800)
 *   HOLD_S          seconds to record metrics          (default 120)
 *   WARMUP_S        seconds before recording           (default 20)
 *   RUN_LABEL       run id for CSV                     (default "run1")
 *   EXP             experiment id / CSV prefix         (default "e1")
 *   POLL_MS         polling interval (legacy)          (default 5000)
 *   TIMEOUT_MS      per-cycle delivery timeout         (default 8000)
 *   WORKER_CAP      max concurrent workers             (default 1000)
 *   OUT_DIR         CSV directory                      (default benchmark/results)
 *   GOAL_CPU_MS     simulated goal CPU burn ms         (default 10)
 *   BURST           if 1, ramp 0 to N in 5s (burst)    (default 0)
 *   REPLICAS        number of application replicas     (default 1)
 *   TOTAL_CPU_LIMIT total CPU quota allocated          (default "1.0")
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
let client;
try { client = require("../Event_Driven/Event_Backend/node_modules/prom-client"); }
catch (_) {
  try { client = require("prom-client"); }
  catch (e) {
    // Minimal mock fallback if prom-client is not yet installed in local workspace
    client = {
      Registry: class { constructor() { this.contentType = "text/plain"; } metrics() { return Promise.resolve(""); } },
      Gauge: class { constructor() { this.set = () => {}; } },
      Histogram: class { constructor() { this.observe = () => {}; } },
      Counter: class { constructor() { this.inc = () => {}; } },
    };
  }
}

const LOADGEN_VERSION = "v3-three-variant";

// ------------------------------------------------------------------ //
// Config & Variant Endpoints
// ------------------------------------------------------------------ //
const EVENT_URL   = process.env.EVENT_URL   || "http://localhost:5001";
const MODULAR_URL = process.env.MODULAR_URL || "http://localhost:5011";
const MICRO_URL   = process.env.MICRO_URL   || "http://localhost:5021";
const POLLING_URL = process.env.POLLING_URL || "http://localhost:5002";

const VARIANT_URLS = {
  event:   EVENT_URL,
  modular: MODULAR_URL,
  micro:   MICRO_URL,
  polling: POLLING_URL,
};

// Determine active variants
let ACTIVE_VARIANTS = ["event", "modular", "micro"];
if (process.env.VARIANT) {
  ACTIVE_VARIANTS = [process.env.VARIANT.trim().toLowerCase()];
} else if (process.env.VARIANTS) {
  ACTIVE_VARIANTS = process.env.VARIANTS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const POLL_MS     = parseInt(process.env.POLL_MS || "5000", 10);
const TIMEOUT_MS  = parseInt(
  process.env.TIMEOUT_MS || String(Math.max(8000, POLL_MS + 2000)),
  10
);
const STEPS = (process.env.STEPS || "10,50,100,200")
  .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n > 0);
const HOLD_S    = parseInt(process.env.HOLD_S || "120", 10);
const WARMUP_S  = parseInt(process.env.WARMUP_S || "20", 10);
const RUN_LABEL = process.env.RUN_LABEL || "run1";
const EXP       = process.env.EXP || "e1";
const WORKER_CAP = parseInt(process.env.WORKER_CAP || "1000", 10);
const OUT_DIR   = process.env.OUT_DIR || path.join(__dirname, "results");
const GOAL_CPU_MS = parseInt(process.env.GOAL_CPU_MS || "10", 10);
const IS_BURST  = process.env.BURST === "1" || process.argv.includes("--burst");
const REPLICAS  = parseInt(process.env.REPLICAS || "1", 10);
const TOTAL_CPU_LIMIT = process.env.TOTAL_CPU_LIMIT || "1.0";

const CYCLE_STEPS = 500;
const THINK_MIN_S = parseFloat(process.env.THINK_MIN_S || "1");
const THINK_MAX_S = parseFloat(process.env.THINK_MAX_S || "6");
const CYCLE_MS = Math.max(
  parseFloat(process.env.CYCLE_S || "15") * 1000,
  THINK_MAX_S * 1000 + TIMEOUT_MS + 1000
);

const rand = (a, b) => a + Math.random() * (b - a);
const monoMs = () => Number(process.hrtime.bigint() / 1000000n);
const genRequestId = () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const METRICS_PORT = parseInt(process.env.METRICS_PORT || "9100", 10);

// Default container counts by variant
function getContainerCount(variant) {
  if (variant === "micro") return 5 * REPLICAS;
  return 1 * REPLICAS;
}

// ------------------------------------------------------------------ //
// Prometheus Metrics
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
  help: "Wall-clock time from ingest POST to notification received",
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
// Stage-local recording
// ------------------------------------------------------------------ //
let stageGeneration = 0;
let recording = false;
let currentUsers = STEPS[0];
let cycleSeq = 0;

function createVariantStage() {
  return { delivery: [], ingest: [], delivered: 0, timeouts: 0, errors: 0, pollReq: 0, pollEmpty: 0 };
}

const stage = {
  variants: {},
  appStart: null,
  appEnd: null,
};

function resetStage() {
  stage.variants = {};
  for (const v of ACTIVE_VARIANTS) {
    stage.variants[v] = createVariantStage();
  }
  stage.appStart = null;
  stage.appEnd = null;
}

resetStage();

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
// HTTP Helpers
// ------------------------------------------------------------------ //
function httpPost(urlStr, body, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlStr);
    const data = JSON.stringify(body);
    const req  = http.request(
      {
        hostname: url.hostname,
        port:     url.port,
        path:     url.pathname,
        method:   "POST",
        headers:  {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          "X-Request-Id": genRequestId(),
          ...customHeaders,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end",  () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error("POST timeout")); });
    req.write(data);
    req.end();
  });
}

function httpGet(urlStr, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port:     url.port,
        path:     url.pathname + url.search,
        method:   "GET",
        headers:  {
          "X-Request-Id": genRequestId(),
          ...customHeaders,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end",  () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error("GET timeout")); });
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
  const snap = {};
  for (const variant of ACTIVE_VARIANTS) {
    const base = VARIANT_URLS[variant];
    const text = await fetchMetricsText(base);
    snap[variant] = {
      cpu: parseGauge(text, "process_cpu_seconds_total"),
      rss: parseGauge(text, "process_resident_memory_bytes"),
      lag: parseGauge(text, "nodejs_eventloop_lag_p99_seconds"),
    };
  }
  return snap;
}

// ------------------------------------------------------------------ //
// Setup: Goal creation adhering to period-aware contract
// ------------------------------------------------------------------ //
async function ensureGoal(base, userId, target) {
  try {
    await httpPost(`${base}/api/goals`, {
      userId,
      type: "steps",
      target,
      period: "daily",
    });
  } catch (_) { /* best-effort goal setup */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sleepUntil(endMs, gen) {
  while (monoMs() < endMs && gen === stageGeneration) {
    await sleep(Math.min(250, Math.max(1, endMs - monoMs())));
  }
}

// ------------------------------------------------------------------ //
// Standard Push Cycle (Event-Driven, Modular Monolith, Microservices)
// ------------------------------------------------------------------ //
async function pushCycle(variant, userId, gen, cycleEnd) {
  const base = VARIANT_URLS[variant];
  const sseUrl = new URL(`${base}/api/notifications/${userId}/stream`);
  let notified = false;
  let t0 = null;
  let inWindow = false;
  let buffer = "";

  const sseReq = http.get(
    {
      hostname: sseUrl.hostname,
      port:     sseUrl.port,
      path:     sseUrl.pathname,
      headers:  {
        Accept: "text/event-stream",
        "X-Request-Id": genRequestId(),
      },
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
              if (payload && (payload.type === "GOAL_REACHED" || payload.event === "notification")) {
                notified = true;
                const latency = (monoMs() - t0) / 1000;
                notifyDeliverySeconds.observe({ variant }, latency);
                notifyDeliveredTotal.inc({ variant });
                if (inWindow && stage.variants[variant]) {
                  stage.variants[variant].delivery.push(latency);
                  stage.variants[variant].delivered += 1;
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
    t0 = monoMs();

    try {
      await httpPost(`${base}/api/telemetry/steps`, {
        userId,
        steps: CYCLE_STEPS,
        calories: 15,
        distance: 0.18,
      });
      const ingestLat = (monoMs() - t0) / 1000;
      ingestSeconds.observe({ variant }, ingestLat);
      if (inWindow && stage.variants[variant]) {
        stage.variants[variant].ingest.push(ingestLat);
      }
    } catch (e) {
      loadgenErrorsTotal.inc({ variant });
      if (inWindow && stage.variants[variant]) {
        stage.variants[variant].errors += 1;
      }
    }

    const deadline = t0 + TIMEOUT_MS;
    while (!notified && monoMs() < deadline && gen === stageGeneration) {
      await sleep(20);
    }
    if (!notified && gen === stageGeneration) {
      notifyTimeoutsTotal.inc({ variant });
      if (inWindow && stage.variants[variant]) {
        stage.variants[variant].timeouts += 1;
      }
    }
    await sleepUntil(cycleEnd, gen);
  } finally {
    try { sseReq.destroy(); } catch (_) {}
  }
}

// ------------------------------------------------------------------ //
// Legacy Polling Cycle (Maintained for legacy verification)
// ------------------------------------------------------------------ //
async function pollingCycle(userId, gen, cycleEnd) {
  let t0 = null;
  let notified = false;
  let inWindow = false;
  let stopped = false;
  const variant = "polling";

  const napWhile = async (ms) => {
    const end = monoMs() + ms;
    while (!stopped && monoMs() < end) await sleep(Math.min(100, Math.max(1, end - monoMs())));
  };

  (async () => {
    await napWhile(Math.random() * POLL_MS);
    let next = monoMs();
    while (!stopped && monoMs() < cycleEnd && gen === stageGeneration) {
      const rec = recording && gen === stageGeneration;
      pollRequestsTotal.inc({ variant: "polling" });
      if (rec && stage.variants.polling) stage.variants.polling.pollReq += 1;
      try {
        const res = await httpGet(`${POLLING_URL}/api/notifications/${userId}/poll`);
        let parsed;
        try { parsed = JSON.parse(res.body); } catch (_) { parsed = {}; }
        const hasNew = parsed.hasNew === true || parsed.has_new === true;
        const now = monoMs();
        if (hasNew && !notified && t0 !== null) {
          notified = true;
          const latency = (now - t0) / 1000;
          notifyDeliverySeconds.observe({ variant: "polling" }, latency);
          notifyDeliveredTotal.inc({ variant: "polling" });
          if (inWindow && stage.variants.polling) {
            stage.variants.polling.delivery.push(latency);
            stage.variants.polling.delivered += 1;
          }
        } else {
          pollEmptyTotal.inc({ variant: "polling" });
          if (rec && stage.variants.polling) stage.variants.polling.pollEmpty += 1;
        }
      } catch (e) {
        loadgenErrorsTotal.inc({ variant: "polling" });
        if (inWindow && stage.variants.polling) stage.variants.polling.errors += 1;
      }
      next += POLL_MS;
      const wait = next - monoMs();
      if (wait > 0) await napWhile(wait); else next = monoMs();
    }
  })();

  try {
    await sleep(rand(THINK_MIN_S, THINK_MAX_S) * 1000);
    if (gen !== stageGeneration) return;
    inWindow = recording && gen === stageGeneration;
    t0 = monoMs();
    try {
      await httpPost(`${POLLING_URL}/api/steps/${userId}`, {
        userId,
        steps: CYCLE_STEPS,
        calories: 15,
        distance: 0.18,
      });
      const ingestLat = (monoMs() - t0) / 1000;
      ingestSeconds.observe({ variant: "polling" }, ingestLat);
      if (inWindow && stage.variants.polling) stage.variants.polling.ingest.push(ingestLat);
    } catch (e) {
      loadgenErrorsTotal.inc({ variant: "polling" });
      if (inWindow && stage.variants.polling) stage.variants.polling.errors += 1;
    }
    const deadline = t0 + TIMEOUT_MS;
    while (!notified && monoMs() < deadline && gen === stageGeneration) await sleep(50);
    if (!notified && gen === stageGeneration) {
      notifyTimeoutsTotal.inc({ variant: "polling" });
      if (inWindow && stage.variants.polling) stage.variants.polling.timeouts += 1;
    }
    await sleepUntil(cycleEnd, gen);
  } finally {
    stopped = true;
  }
}

// ------------------------------------------------------------------ //
// Worker Loop Dispatcher
// ------------------------------------------------------------------ //
async function workerLoop(variant, slot, gen) {
  if (IS_BURST) {
    // Burst mode: ramp 0 to N across 5 seconds
    const burstDelay = (slot / Math.max(1, currentUsers)) * 5000;
    await sleep(burstDelay);
  } else {
    await sleep(Math.random() * CYCLE_MS);
  }

  let i = 0;
  let cycleStart = monoMs();
  const base = VARIANT_URLS[variant];

  while (gen === stageGeneration) {
    if (monoMs() > cycleStart + CYCLE_MS) cycleStart = monoMs();
    const cycleEnd = cycleStart + CYCLE_MS;
    cycleStart = cycleEnd;

    const userId = `load_${EXP}_${RUN_LABEL}_${variant}_s${currentUsers}_w${slot}_c${i++}_${cycleSeq++}`;
    await ensureGoal(base, userId, CYCLE_STEPS);
    if (gen !== stageGeneration) break;

    if (variant === "polling") {
      await pollingCycle(userId, gen, cycleEnd);
    } else {
      await pushCycle(variant, userId, gen, cycleEnd);
    }
    await sleepUntil(cycleEnd, gen);
  }
}

function startStageWorkers(users) {
  stageGeneration += 1;
  const gen = stageGeneration;
  const n = Math.min(users, WORKER_CAP);

  for (const variant of ACTIVE_VARIANTS) {
    loadgenClients.set({ variant }, n);
    for (let i = 0; i < n; i++) {
      workerLoop(variant, i, gen).catch(() => {});
    }
  }

  console.log(`[STAGE] Started users=${users} (${ACTIVE_VARIANTS.join(",")}) workers/variant=${n} gen=${gen} burst=${IS_BURST}`);
  return gen;
}

// ------------------------------------------------------------------ //
// CSV Output
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
  "replicas","containers","total_cpu_limit"
].join(",");

function csvPath() {
  return path.join(OUT_DIR, `${EXP}-${RUN_LABEL}-levels.csv`);
}

function appendCsvRows(users) {
  const rows = [];
  for (const variant of ACTIVE_VARIANTS) {
    const v = stage.variants[variant] || createVariantStage();
    const d = v.delivery;
    const ing = v.ingest;
    const pollEmptyShare =
      variant === "polling" && v.pollReq > 0
        ? v.pollEmpty / v.pollReq
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
      variant === "polling" ? v.pollReq : "",
      variant === "polling" ? v.pollEmpty : "",
      pollEmptyShare != null ? round(pollEmptyShare, 4) : "",
      round(cpuDelta, 4), rss != null ? String(Math.round(rss)) : "", round(lag, 6),
      workers,
      round(d.length ? Math.min(...d) : null), round(d.length ? Math.max(...d) : null),
      round(ing.length / HOLD_S, 4), round(v.delivered / HOLD_S, 4),
      variant === "polling" ? round(v.pollReq / HOLD_S, 4) : "",
      CYCLE_MS / 1000, THINK_MIN_S, THINK_MAX_S, TIMEOUT_MS, LOADGEN_VERSION,
      REPLICAS, getContainerCount(variant), TOTAL_CPU_LIMIT,
    ].join(",");
    rows.push(row);
  }

  const file = csvPath();
  const needHeader = !fs.existsSync(file) || fs.statSync(file).size === 0;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(file, (needHeader ? CSV_HEADER + "\n" : "") + rows.join("\n") + "\n");
  console.log(`[CSV] Appended ${rows.length} rows → ${file}`);
}

// ------------------------------------------------------------------ //
// Stage Runner
// ------------------------------------------------------------------ //
async function runAllStages() {
  console.log("================================================");
  console.log(`PulseFlow Load Generator ${LOADGEN_VERSION}`);
  console.log(`EXP=${EXP} RUN_LABEL=${RUN_LABEL}`);
  console.log(`Variants      : ${ACTIVE_VARIANTS.join(", ")}`);
  console.log(`Stages        : ${STEPS.join(" → ")} users`);
  console.log(`HOLD_S/WARMUP : ${HOLD_S}/${WARMUP_S}s`);
  console.log(`Burst mode    : ${IS_BURST}`);
  console.log(`Replicas      : ${REPLICAS} (CPU limit: ${TOTAL_CPU_LIMIT})`);
  console.log(`CSV           : ${csvPath()}`);
  console.log("================================================");

  for (const users of STEPS) {
    currentUsers = users;
    resetStage();
    recording = false;

    startStageWorkers(users);

    console.log(`[WARMUP] ${users} users for ${WARMUP_S}s...`);
    await sleep(WARMUP_S * 1000);

    stage.appStart = await snapshotApps();
    recording = true;
    console.log(`[HOLD] ${users} users for ${HOLD_S}s (measuring)...`);
    await sleep(HOLD_S * 1000);
    recording = false;
    stage.appEnd = await snapshotApps();

    appendCsvRows(users);

    for (const variant of ACTIVE_VARIANTS) {
      const v = stage.variants[variant];
      console.log(`[STAGE SUMMARY] ${users}u [${variant}] delivered=${v.delivered} timeouts=${v.timeouts} p50=${round(pct(v.delivery, 50))}s p95=${round(pct(v.delivery, 95))}s`);
    }
  }

  stageGeneration += 1;
  for (const variant of ACTIVE_VARIANTS) {
    loadgenClients.set({ variant }, 0);
  }
  console.log(`[ALL STAGES COMPLETED] Results saved to ${csvPath()}`);
  await sleep(6000);
  process.exit(0);
}

// ------------------------------------------------------------------ //
// Metrics Server
// ------------------------------------------------------------------ //
const server = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  } else {
    res.writeHead(200);
    res.end(`PulseFlow Load Generator ${LOADGEN_VERSION} — metrics at /metrics\n`);
  }
});

server.listen(METRICS_PORT, "0.0.0.0", () => {
  runAllStages().catch((err) => {
    console.error("[FATAL ERROR]", err);
    process.exit(1);
  });
});
