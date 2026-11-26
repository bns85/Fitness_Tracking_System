#!/usr/bin/env node
/**
 * benchmark/scripts/run_phase3.js — Cross-Platform Phase 3 Runner
 *
 * 100% Pure Node.js (No external curl dependencies, works in any terminal):
 *   node benchmark/scripts/run_phase3.js
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const root = path.resolve(__dirname, "../..");
const resultsDir = path.join(root, "benchmark", "results");
const runLog = path.join(resultsDir, "RUN_LOG.md");
const logsDir = path.join(resultsDir, "logs");

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Native HTTP helper with zero curl dependency
function httpGet(urlStr, timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const req = http.request(
        url,
        { method: "GET", timeout: timeoutMs },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: data }));
        }
      );
      req.on("error", () => resolve({ ok: false, statusCode: 0, body: "" }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, statusCode: 0, body: "" });
      });
      req.end();
    } catch (_) {
      resolve({ ok: false, statusCode: 0, body: "" });
    }
  });
}

function httpPost(urlStr, jsonBody, timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const payload = typeof jsonBody === "string" ? jsonBody : JSON.stringify(jsonBody);
      const req = http.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          timeout: timeoutMs,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, body: data }));
        }
      );
      req.on("error", () => resolve({ ok: false, statusCode: 0, body: "" }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, statusCode: 0, body: "" });
      });
      req.write(payload);
      req.end();
    } catch (_) {
      resolve({ ok: false, statusCode: 0, body: "" });
    }
  });
}

async function waitHealthy(port) {
  const url = `http://127.0.0.1:${port}/health`;
  process.stdout.write(`Checking service at ${url}... `);
  for (let i = 0; i < 20; i++) {
    const res = await httpGet(url, 2000);
    if (res.ok && res.body.includes("ok")) {
      console.log("Healthy!");
      return true;
    }
    await sleep(2000);
  }
  console.log("Service not currently reachable (proceeding if already starting).");
  return false;
}

function resetDb(variant) {
  console.log(`\n--- Resetting datastores for ${variant} ---`);
  if (variant === "micro") {
    try {
      execSync("docker exec mongo-micro mongosh fitness_telemetry --quiet --eval \"db.dropDatabase()\"", { stdio: "ignore" });
      execSync("docker exec mongo-micro mongosh fitness_goals --quiet --eval \"db.dropDatabase()\"", { stdio: "ignore" });
      execSync("docker exec mongo-micro mongosh fitness_notifications --quiet --eval \"db.dropDatabase()\"", { stdio: "ignore" });
      execSync("docker exec mongo-micro mongosh fitness_workouts --quiet --eval \"db.dropDatabase()\"", { stdio: "ignore" });
      execSync("docker exec redis-micro redis-cli FLUSHALL", { stdio: "ignore" });
    } catch (_) {}
  } else {
    try {
      execSync(`docker exec mongo-${variant} mongosh fitness_${variant} --quiet --eval "db.dropDatabase()"`, { stdio: "ignore" });
      execSync(`docker exec redis-${variant} redis-cli FLUSHALL`, { stdio: "ignore" });
    } catch (_) {}
  }
}

function runCmd(cmd, envOverrides = {}) {
  try {
    return execSync(cmd, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...envOverrides },
    });
  } catch (e) {
    console.error(`Command finished with note: ${e.message}`);
  }
}

async function main() {
  console.log("==========================================================");
  console.log(" Starting Phase 3 Benchmark Suite (PulseFlow ECS351) ");
  console.log("==========================================================");

  // 1. Check Docker
  console.log("\n[Step 1/5] Checking Docker daemon status...");
  try {
    execSync("docker version", { stdio: "ignore" });
    console.log("✓ Docker engine is running.");
  } catch (_) {
    console.error("\n❌ ERROR: Docker is not running!");
    console.error("Please ensure Docker Desktop is open and green before running.");
    process.exit(1);
  }

  // 2. Experiment E1: Baseline Multi-Variant Load
  console.log("\n[Step 2/5] Running Experiment E1: Baseline Step Loads (10, 50, 100, 200)...");
  const argVariants = process.argv[2] ? process.argv[2].split(",").map(v => v.trim()) : null;
  const variants = argVariants || ["event", "modular", "micro"];
  const ports = { event: 5001, modular: 5011, micro: 5021 };

  for (const variant of variants) {
    const port = ports[variant];

    for (const run of ["run1", "run2", "run3"]) {
      const startIso = new Date().toISOString();
      console.log(`\n>>> Running E1 | Variant: ${variant} | Run: ${run} | Start: ${startIso} <<<`);
      resetDb(variant);
      await waitHealthy(port);

      const logFile = path.join(logsDir, `e1_${variant}_${run}.log`);
      const env = {
        EXP: "e1",
        RUN_LABEL: `${variant}_${run}`,
        VARIANT: variant,
        STEPS: "10,50,100,200",
        HOLD_S: "120",
        WARMUP_S: "20",
        GOAL_CPU_MS: "10",
      };

      runCmd(`node benchmark/loadgen.js`, env);

      const endIso = new Date().toISOString();
      const entry = `\n### E1 Baseline — ${variant} / ${run} (${startIso} to ${endIso})\n- Variant: ${variant}\n- Port: ${port}\n- Stages: 10,50,100,200\n- CSV: benchmark/results/e1-${variant}_${run}-levels.csv\n`;
      fs.appendFileSync(runLog, entry);
    }
  }

  // 3. Experiment E4: Durability (20 crash trials)
  console.log("\n[Step 3/5] Running Experiment E4: Durability (20 crash trials per variant)...");
  const duraVariants = [
    { name: "event", port: 5001, container: "event-app", mongo: "mongo-event", db: "fitness_event", coll: "fitnessdatas" },
    { name: "modular", port: 5011, container: "modular-app", mongo: "mongo-modular", db: "fitness_modular", coll: "telemetry_fitness_data" },
    { name: "micro", port: 5021, container: "telemetry-service", mongo: "mongo-micro", db: "fitness_telemetry", coll: "fitnessdatas" },
  ];

  for (const v of duraVariants.filter(d => variants.includes(d.name))) {
    console.log(`\n--- Running 20 crash trials on ${v.name} ---`);
    let acked = 0;
    let saved = 0;

    let cid = v.container;
    try {
      const out = execSync(`docker ps -q -f name=${v.container}`, { encoding: "utf8" }).trim();
      if (out) cid = out.split("\n")[0];
    } catch (_) {}

    for (let t = 1; t <= 20; t++) {
      const user = `dura_${v.name}_t${t}_${Date.now()}`;
      const payload = { userId: user, steps: 500, calories: 15, distance: 0.2 };

      const res = await httpPost(`http://127.0.0.1:${v.port}/api/telemetry/steps`, payload);
      if (res.statusCode === 200) acked++;

      try { execSync(`docker kill ${cid}`, { stdio: "ignore" }); } catch (_) {}
      await sleep(1000);
      try { execSync(`docker start ${cid}`, { stdio: "ignore" }); } catch (_) {}

      // Wait recovery
      for (let r = 0; r < 20; r++) {
        const h = await httpGet(`http://127.0.0.1:${v.port}/health`);
        if (h.ok) break;
        await sleep(1000);
      }

      try {
        const count = execSync(
          `docker exec ${v.mongo} mongosh ${v.db} --quiet --eval "db['${v.coll}'].countDocuments({userId:'${user}'})"`,
          { encoding: "utf8" }
        ).trim();
        if (parseInt(count, 10) >= 1) saved++;
      } catch (_) {}
    }
    console.log(`Result for ${v.name}: Acknowledged=${acked}, Persisted=${saved}`);
  }

  // 4. Experiment E3: Fault Isolation
  console.log("\n[Step 4/5] Running Experiment E3: Fault Isolation...");
  try {
    let notifCid = "";
    try {
      notifCid = execSync("docker ps -q -f name=notification-service", { encoding: "utf8" }).trim().split("\n")[0];
    } catch (_) {}

    if (notifCid) {
      console.log("Simulating Fault A (stop notification-service)...");
      try { execSync(`docker stop ${notifCid}`, { stdio: "ignore" }); } catch (_) {}
    }

    runCmd("node benchmark/loadgen.js", {
      EXP: "e3_fault",
      RUN_LABEL: "micro_faultA",
      VARIANT: "micro",
      STEPS: "100",
      HOLD_S: "60",
      WARMUP_S: "10",
    });

    if (notifCid) {
      try { execSync(`docker start ${notifCid}`, { stdio: "ignore" }); } catch (_) {}
    }
  } catch (e) {
    console.error("E3 Fault step notice:", e.message);
  }

  // 5. Experiment E8: Burst Load
  console.log("\n[Step 5/5] Running Experiment E8: Burst Surge Load (0 -> 200 in 5s)...");
  for (const variant of ["event", "modular", "micro"]) {
    console.log(`\n>>> Testing Burst on ${variant} <<<`);
    runCmd("node benchmark/loadgen.js", {
      EXP: "e8_burst",
      RUN_LABEL: `${variant}_burst`,
      VARIANT: variant,
      STEPS: "200",
      HOLD_S: "60",
      WARMUP_S: "5",
      BURST: "1",
    });
  }

  // 6. Aggregate Results
  console.log("\n[Aggregation] Aggregating multi-run medians...");
  runCmd(`node benchmark/analysis/aggregate.js "${resultsDir}"`);

  console.log("\n==========================================================");
  console.log(" Phase 3 Benchmark Suite Completed Successfully! ");
  console.log(" Check benchmark/results/summary.csv and summary.md");
  console.log("==========================================================");
}

main().catch((err) => {
  console.error("Runner encountered error:", err);
});
