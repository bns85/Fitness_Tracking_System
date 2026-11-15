/**
 * Self test for benchmark/loadgen.js (v2). Needs NO real apps and NO Docker.
 * Starts two tiny stub servers that mimic the apps, runs the load generator for about 60 s
 * with short timings and checks that the measurement is valid:
 *   - polling delivery mean is about POLL_MS/2 (random poll phase), p99 near POLL_MS
 *   - event delivery is fast (stub delay is 20 ms)
 *   - both variants get the same number of ingests (equal offered load)
 *   - most polls are empty (idle polling is counted)
 * Run:  node benchmark/loadgen.selftest.js        (exit code 0 = PASS)
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const POLL_MS = 1000;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "lgself-"));

function stub(mode, port) {
  const sse = new Map(); const steps = new Set(); const t0 = Date.now();
  return http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      const j = (o, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      let m;
      if (req.url === "/metrics") { res.writeHead(200); return res.end(`process_cpu_seconds_total ${(Date.now() - t0) / 10000}\nprocess_resident_memory_bytes 100000000\nnodejs_eventloop_lag_p99_seconds 0.01\n`); }
      if (req.method === "POST" && req.url === "/api/goals") return j({ success: true });
      if (mode === "event" && req.url === "/api/telemetry/steps") {
        const { userId } = JSON.parse(b);
        return setTimeout(() => { j({ success: true }); setTimeout(() => { const r = sse.get(userId); if (r) r.write('data: {"type":"GOAL_REACHED"}\n\n'); }, 20); }, 3);
      }
      if (mode === "event" && (m = req.url.match(/^\/api\/notifications\/(.+)\/stream$/))) {
        res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
        const id = decodeURIComponent(m[1]); sse.set(id, res); res.on("close", () => sse.delete(id)); return;
      }
      if (mode === "polling" && (m = req.url.match(/^\/api\/steps\/(.+)$/))) { steps.add(decodeURIComponent(m[1])); return setTimeout(() => j({ success: true }), 3); }
      if (mode === "polling" && (m = req.url.match(/^\/api\/notifications\/(.+)\/poll$/))) return j({ hasNew: steps.has(decodeURIComponent(m[1])) });
      j({ error: "not found" }, 404);
    });
  }).listen(port);
}

const s1 = stub("event", 6301); const s2 = stub("polling", 6302);
const env = { ...process.env, EVENT_URL: "http://127.0.0.1:6301", POLLING_URL: "http://127.0.0.1:6302", POLL_MS: String(POLL_MS),
  TIMEOUT_MS: "2500", THINK_MIN_S: "0.2", THINK_MAX_S: "1.5", CYCLE_S: "5", STEPS: "20", HOLD_S: "45", WARMUP_S: "8", OUT_DIR: out, EXP: "self", RUN_LABEL: "t",
  METRICS_PORT: "9199" }; // never serve on 9100: Prometheus scrapes that port during real runs
console.log("running loadgen against stub servers (about 60 s)...");
const child = spawn(process.execPath, [path.join(__dirname, "loadgen.js")], { env, stdio: "inherit" });
child.on("exit", () => {
  s1.close(); s2.close();
  const lines = fs.readFileSync(path.join(out, "self-t-levels.csv"), "utf8").trim().split("\n");
  const head = lines[0].split(","); const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
  const ev = rows.find((r) => r.variant === "event"); const po = rows.find((r) => r.variant === "polling");
  const checks = [
    ["polling mean near POLL_MS/2", Math.abs(+po.delivery_mean_s - POLL_MS / 2000) <= 0.15 * (POLL_MS / 2000), `${po.delivery_mean_s}s (expect about ${POLL_MS / 2000}s)`],
    ["polling p99 near POLL_MS", +po.delivery_p99_s >= 0.9 * POLL_MS / 1000 && +po.delivery_p99_s <= 1.1 * POLL_MS / 1000, `${po.delivery_p99_s}s (expect about ${POLL_MS / 1000}s)`],
    ["polling min below mean (random phase)", +po.delivery_min_s < +po.delivery_mean_s, `min ${po.delivery_min_s}s`],
    ["event p95 under 0.2 s (stub delay 20 ms)", +ev.delivery_p95_s < 0.2, `${ev.delivery_p95_s}s`],
    ["equal offered load (ingest_n within 5%)", Math.abs(+ev.ingest_n - +po.ingest_n) / +ev.ingest_n <= 0.05, `event ${ev.ingest_n} vs polling ${po.ingest_n}`],
    ["idle polls are counted (empty share 60-95%)", +po.poll_empty_share >= 0.6 && +po.poll_empty_share <= 0.95, `${po.poll_empty_share}`],
    ["no timeouts", +ev.delivery_timeouts === 0 && +po.delivery_timeouts === 0, `event ${ev.delivery_timeouts}, polling ${po.delivery_timeouts}`],
  ];
  let ok = true;
  for (const [name, pass, detail] of checks) { console.log(`${pass ? "PASS" : "FAIL"}  ${name}   ${detail}`); if (!pass) ok = false; }
  console.log(ok ? "\nSELF TEST: PASS" : "\nSELF TEST: FAIL");
  process.exit(ok ? 0 : 1);
});
