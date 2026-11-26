#!/usr/bin/env node
/**
 * PulseFlow Contract Referee Runner (contract.js)
 *
 * Runs contract tests against any variant and outputs formatted results.
 * Usage:
 *   node benchmark/contract/contract.js
 *   BASE_URL=http://localhost:5011/api node benchmark/contract/contract.js
 *   BASE_URL=http://localhost:5021/api node benchmark/contract/contract.js
 *   node benchmark/contract/contract.js --all
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");

const targetUrl = process.env.BASE_URL || "http://127.0.0.1:5001/api";
const checkAll = process.argv.includes("--all");

function request(method, urlStr, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === "https:" ? https : http;
    const data = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;

    const reqHeaders = {
      Accept: "application/json, text/plain, */*",
      ...headers,
    };
    if (data) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(data);
    }

    const req = client.request(
      url,
      {
        method,
        headers: reqHeaders,
        timeout: 8000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            parsed = raw;
          }
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error(`Timeout: ${method} ${urlStr}`)));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function verifyContract(baseUrl) {
  const apiBase = baseUrl.replace(/\/+$/, "");
  const rootUrl = apiBase.endsWith("/api") ? apiBase.slice(0, -4) : apiBase;
  const testUser = `contract-user-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  console.log(`\n=============================================================`);
  console.log(`Refereeing Contract: ${apiBase}`);
  console.log(`Test User ID:        ${testUser}`);
  console.log(`=============================================================`);

  const checks = [];
  function record(desc, passed, detail = "") {
    checks.push({ desc, passed, detail });
    console.log(`${passed ? "✓ PASS" : "✗ FAIL"} | ${desc} ${detail ? "(" + detail + ")" : ""}`);
  }

  try {
    // 1. Health
    const healthRes = await request("GET", `${rootUrl}/health`);
    record("1.1 GET /health returns 200 with status ok", healthRes.statusCode === 200 && healthRes.body.status === "ok");

    // 2. Meta
    const metaRes = await request("GET", `${apiBase}/meta`);
    record(
      "1.2 GET /api/meta returns agreed schema",
      metaRes.statusCode === 200 && metaRes.body.name === "PulseFlow" && !!metaRes.body.style && !!metaRes.body.variant,
      metaRes.body.style ? `style=${metaRes.body.style}` : "missing"
    );

    // 3. Goal Validation
    const valRes = await request("POST", `${apiBase}/goals`, { userId: testUser, type: "invalid_type", target: 5000 });
    record("2.1 Reject invalid goal type with 400", valRes.statusCode === 400);

    const valTargetRes = await request("POST", `${apiBase}/goals`, { userId: testUser, type: "steps", target: -100 });
    record("2.2 Reject negative goal target with 400", valTargetRes.statusCode === 400);

    // 4. Goal Creation
    const goalRes = await request("POST", `${apiBase}/goals`, { userId: testUser, type: "steps", target: 1000, period: "daily" });
    const goalCreated = [200, 201].includes(goalRes.statusCode) && goalRes.body.success;
    record("2.3 Create period-aware daily goal", goalCreated);
    const goalId = goalRes.body?.goal?._id || goalRes.body?.goal?.id;

    // 5. Duplicate Goal Check
    const dupRes = await request("POST", `${apiBase}/goals`, { userId: testUser, type: "steps", target: 2000, period: "daily" });
    record("2.4 Duplicate active goal returns 409", dupRes.statusCode === 409);

    // 6. Goal Listing
    const listRes = await request("GET", `${apiBase}/goals/${testUser}`);
    record("2.5 GET /api/goals/:userId returns goal list", listRes.statusCode === 200 && Array.isArray(listRes.body.goals));

    // 7. Telemetry Ingest
    const ingestRes = await request("POST", `${apiBase}/telemetry/steps`, {
      userId: testUser,
      steps: 1500,
      calories: 75,
      distance: 1.1,
    });
    record("3.1 Ingest steps (POST /api/telemetry/steps) returns 200", ingestRes.statusCode === 200 && ingestRes.body.success);

    // 8. Notifications
    await new Promise((r) => setTimeout(r, 600)); // Allow async processing
    const notifRes = await request("GET", `${apiBase}/notifications/${testUser}`);
    record("3.2 GET /api/notifications/:userId returns array", notifRes.statusCode === 200 && Array.isArray(notifRes.body.notifications));

    // 9. Dashboard Totals
    const dashRes = await request("GET", `${apiBase}/dashboard/${testUser}`);
    const dashData = dashRes.body.data || dashRes.body;
    const steps = dashData?.totalSteps ?? dashData?.activity?.totalSteps ?? 0;
    record("4.1 Dashboard totals reflect ingested steps (>= 1500)", dashRes.statusCode === 200 && steps >= 1500, `steps=${steps}`);

    // 10. Workout Lifecycle
    const wStart = await request("POST", `${apiBase}/workout/start`, { userId: testUser, workoutType: "running" });
    record("5.1 Start live workout (POST /api/workout/start)", [200, 201].includes(wStart.statusCode) && wStart.body.success);
    const wId = wStart.body?.workout?._id || wStart.body?.workout?.id || wStart.body?.workout?.workoutId;

    if (wId) {
      await request("POST", `${apiBase}/workout/live-metrics`, { userId: testUser, workoutId: wId, heartRate: 145, calories: 120, steps: 500, distance: 0.7 });
      const wStop = await request("POST", `${apiBase}/workout/stop`, { userId: testUser, workoutId: wId });
      record("5.2 Stop workout and update totals (POST /api/workout/stop)", wStop.statusCode === 200 && wStop.body.success);

      const wActive = await request("GET", `${apiBase}/workout/active/${testUser}`);
      record("5.3 Active workout is null after stop", wActive.statusCode === 200 && (wActive.body.workout === null || !wActive.body.workout));
    }

    // 11. 404 Route Check
    const notFound = await request("GET", `${apiBase}/unknown-nonexistent-path-xyz`);
    record("6.1 Nonexistent path returns 404", notFound.statusCode === 404);

  } catch (err) {
    record(`Execution error connecting to ${apiBase}`, false, err.message);
  }

  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  console.log(`\nResult for ${baseUrl}: ${passed}/${total} checks passed (${passed === total ? "ALL PASS" : "FAILURES DETECTED"})`);
  return passed === total;
}

async function main() {
  if (checkAll) {
    const urls = [
      "http://127.0.0.1:5001/api",
      "http://127.0.0.1:5011/api",
      "http://127.0.0.1:5021/api",
    ];
    let allOk = true;
    for (const url of urls) {
      const ok = await verifyContract(url);
      if (!ok) allOk = false;
    }
    process.exit(allOk ? 0 : 1);
  } else {
    const ok = await verifyContract(targetUrl);
    process.exit(ok ? 0 : 1);
  }
}

main();
