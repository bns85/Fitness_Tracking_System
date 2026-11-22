const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app } = require("../src/server");
const burnCpu = require("../src/utils/burnCpu");
const { getStrategy, supportedGoalTypes } = require("../src/modules/goals/strategies");

describe("Modular Monolith Full Integration Test Suite", () => {
  let server;
  let port;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            "Content-Type": "application/json",
            ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
            ...headers,
          },
        },
        (res) => {
          let resData = "";
          res.on("data", (chunk) => (resData += chunk));
          res.on("end", () => {
            let parsedBody;
            try {
              parsedBody = JSON.parse(resData);
            } catch (_) {
              parsedBody = resData;
            }
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: parsedBody,
            });
          });
        }
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // --- Utility & Strategy Tests ---
  test("burnCpu helper burns approximately requested milliseconds", () => {
    const start = Date.now();
    burnCpu(10);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 9, `Expected at least 9ms, got ${elapsed}ms`);
  });

  test("Strategy registry supports steps, calories, and distance", () => {
    const types = supportedGoalTypes();
    assert.ok(types.includes("steps"));
    assert.ok(types.includes("calories"));
    assert.ok(types.includes("distance"));

    const stepsStrat = getStrategy("steps");
    assert.equal(stepsStrat.unit, "steps");
    assert.equal(stepsStrat.extractValue({ totalSteps: 5000 }), 5000);
  });

  // --- Health & Meta Tests ---
  test("GET /health returns 200 with ok status", async () => {
    const res = await request("GET", "/health");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "ok");
    assert.ok(res.body.timestamp);
    assert.ok(res.headers["x-request-id"]);
  });

  test("GET /api/meta returns agreed modular-monolith payload", async () => {
    const res = await request("GET", "/api/meta");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.name, "PulseFlow");
    assert.equal(res.body.style, "modular-monolith");
    assert.equal(res.body.variant, "modular");
    assert.equal(res.body.version, "1.0.0");
  });

  test("GET /metrics returns prometheus metrics text", async () => {
    const res = await request("GET", "/metrics");
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /http_request_duration_seconds/);
    assert.match(res.body, /variant="modular"/);
    assert.match(res.body, /service="app"/);
  });

  // --- Telemetry Validation ---
  test("POST /api/telemetry/steps requires userId and steps (400)", async () => {
    const res = await request("POST", "/api/telemetry/steps", { steps: 100 });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /userId and steps are required/);
  });

  // --- Goal Validation ---
  test("POST /api/goals validates required fields and types (400)", async () => {
    const res = await request("POST", "/api/goals", { userId: "user-1" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(Array.isArray(res.body.errors));
    assert.ok(res.body.errors.some((e) => e.includes("type is required")));
    assert.ok(res.body.errors.some((e) => e.includes("target is required")));
  });

  test("POST /api/goals rejects negative or zero target (400)", async () => {
    const res = await request("POST", "/api/goals", {
      userId: "user-1",
      type: "steps",
      target: -50,
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.errors.some((e) => e.includes("positive number")));
  });

  // --- Workout Validation ---
  test("POST /api/workout/start requires userId (400)", async () => {
    const res = await request("POST", "/api/workout/start", {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /userId is required/);
  });

  test("POST /api/workout/live-metrics returns 404 when no active workout", async () => {
    const res = await request("POST", "/api/workout/live-metrics", {
      userId: "non-existent-user",
      heartRate: 140,
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /No active workout found/);
  });

  test("POST /api/workout/stop returns 400 when no active workout found", async () => {
    const res = await request("POST", "/api/workout/stop", {
      userId: "non-existent-user",
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /No active workout found/);
  });

  // --- SSE Stream Headers ---
  test("GET /api/notifications/:userId/stream opens SSE stream with proper headers", async () => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/notifications/stream-test-user/stream",
      method: "GET",
    });

    const headersPromise = new Promise((resolve) => {
      req.on("response", (res) => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          res,
        });
      });
    });

    req.end();
    const { statusCode, headers, res } = await headersPromise;
    assert.equal(statusCode, 200);
    assert.equal(headers["content-type"], "text/event-stream");
    assert.equal(headers["cache-control"], "no-cache");
    assert.equal(headers["connection"], "keep-alive");
    req.destroy();
  });
});
