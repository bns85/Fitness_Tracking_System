/**
 * PulseFlow Architectural Referee Contract Test Suite
 *
 * Runs identical behavioral and API contract verifications against ANY variant:
 *   - Event-Driven Architecture (Port 5001)
 *   - Modular Monolith (Port 5011)
 *   - Microservices Architecture (Gateway Port 5021)
 *
 * Usage:
 *   BASE_URL=http://localhost:5001/api node --test benchmark/contract/contract.test.js
 *   BASE_URL=http://localhost:5011/api node --test benchmark/contract/contract.test.js
 *   BASE_URL=http://localhost:5021/api node --test benchmark/contract/contract.test.js
 */

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const RAW_BASE = process.env.BASE_URL || "http://127.0.0.1:5001/api";
const API_BASE = RAW_BASE.replace(/\/+$/, "");
const ROOT_URL = API_BASE.endsWith("/api") ? API_BASE.slice(0, -4) : API_BASE;

function makeRequest(method, urlString, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const client = url.protocol === "https:" ? https : http;
    const postData = body ? (typeof body === "string" ? body : JSON.stringify(body)) : null;

    const reqHeaders = {
      Accept: "application/json, text/plain, */*",
      ...headers,
    };
    if (postData) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(postData);
    }

    const req = client.request(
      url,
      {
        method,
        headers: reqHeaders,
        timeout: 10000,
      },
      (res) => {
        let rawData = "";
        res.on("data", (chunk) => (rawData += chunk));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(rawData);
          } catch (_) {
            parsed = rawData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after 10000ms: ${method} ${urlString}`));
    });
    req.on("error", reject);

    if (postData) req.write(postData);
    req.end();
  });
}

function listenForSSE(sseUrl, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const url = new URL(sseUrl);
    const client = url.protocol === "https:" ? https : http;

    const events = [];
    let timer;

    const req = client.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        },
      },
      (res) => {
        let buffer = "";

        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n\n");
          buffer = lines.pop(); // Retain remainder

          for (const block of lines) {
            if (!block.trim() || block.startsWith(":")) continue; // Heartbeats/comments
            let eventType = "message";
            let eventData = "";

            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) {
                eventType = line.replace(/^event:\s*/, "").trim();
              } else if (line.startsWith("data:")) {
                eventData += line.replace(/^data:\s*/, "").trim();
              }
            }

            try {
              const parsed = JSON.parse(eventData);
              events.push({ event: eventType, data: parsed });
            } catch (_) {
              events.push({ event: eventType, data: eventData });
            }
          }
        });

        res.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      }
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end();

    timer = setTimeout(() => {
      req.destroy();
      resolve(events);
    }, timeoutMs);
  });
}

describe(`PulseFlow Referee Contract Suite [${API_BASE}]`, () => {
  const testUserId = `test-user-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  // -------------------------------------------------------------------------
  // 1. Health & Architecture Metadata
  // -------------------------------------------------------------------------
  test("1.1 GET /health returns 200 with status 'ok'", async () => {
    const res = await makeRequest("GET", `${ROOT_URL}/health`);
    assert.equal(res.statusCode, 200, `Expected 200 from /health, got ${res.statusCode}`);
    assert.equal(res.body.status, "ok");
    assert.ok(res.body.timestamp, "Expected timestamp field in /health response");
  });

  test("1.2 GET /api/meta returns agreed architecture schema", async () => {
    const res = await makeRequest("GET", `${API_BASE}/meta`);
    assert.equal(res.statusCode, 200, `Expected 200 from /api/meta, got ${res.statusCode}`);
    assert.equal(res.body.name, "PulseFlow");
    assert.ok(res.body.version, "Expected version field in /api/meta");
    assert.ok(
      ["event-driven", "modular-monolith", "microservices"].includes(res.body.style),
      `Unexpected style: ${res.body.style}`
    );
    assert.ok(
      ["event", "modular", "micro"].includes(res.body.variant),
      `Unexpected variant: ${res.body.variant}`
    );
  });

  // -------------------------------------------------------------------------
  // 2. Goal Lifecycle & Validation Contract
  // -------------------------------------------------------------------------
  let createdGoalId = null;

  test("2.1 POST /api/goals rejects invalid goal types with 400 validation error", async () => {
    const res = await makeRequest("POST", `${API_BASE}/goals`, {
      userId: testUserId,
      type: "invalid_type",
      target: 10000,
    });
    assert.equal(res.statusCode, 400, "Should reject invalid goal type with 400");
    assert.ok(
      res.body.errors || res.body.message,
      "Expected errors array or message in 400 body"
    );
  });

  test("2.2 POST /api/goals rejects non-positive targets with 400 validation error", async () => {
    const res = await makeRequest("POST", `${API_BASE}/goals`, {
      userId: testUserId,
      type: "steps",
      target: 0,
    });
    assert.equal(res.statusCode, 400, "Should reject target 0 with 400");
  });

  test("2.3 POST /api/goals creates period-aware daily goal", async () => {
    const res = await makeRequest("POST", `${API_BASE}/goals`, {
      userId: testUserId,
      type: "steps",
      target: 1000,
      period: "daily",
    });
    assert.ok([200, 201].includes(res.statusCode), `Expected 200/201, got ${res.statusCode}`);
    assert.equal(res.body.success, true);
    assert.ok(res.body.goal, "Expected goal document in response");
    assert.equal(res.body.goal.userId, testUserId);
    assert.equal(res.body.goal.type, "steps");
    assert.equal(Number(res.body.goal.target), 1000);
    createdGoalId = res.body.goal._id || res.body.goal.id;
    assert.ok(createdGoalId, "Goal must have an _id");
  });

  test("2.4 POST /api/goals detects duplicate active goal and returns 409", async () => {
    const res = await makeRequest("POST", `${API_BASE}/goals`, {
      userId: testUserId,
      type: "steps",
      target: 2000,
      period: "daily",
    });
    assert.equal(res.statusCode, 409, "Duplicate active goal must return 409 DUPLICATE_GOAL");
  });

  test("2.5 GET /api/goals/:userId returns goal view models", async () => {
    const res = await makeRequest("GET", `${API_BASE}/goals/${testUserId}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.goals), "goals must be an array");
    assert.ok(res.body.goals.length >= 1, "Must list at least 1 goal");
    const found = res.body.goals.find((g) => (g._id || g.id) === createdGoalId);
    assert.ok(found, "Created goal must be present in goals list");
  });

  test("2.6 GET /api/goals/:userId/active returns active goals", async () => {
    const res = await makeRequest("GET", `${API_BASE}/goals/${testUserId}/active`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.goals));
    const active = res.body.goals.filter((g) => g.status === "active" || g.active !== false);
    assert.ok(active.length >= 1);
  });

  test("2.7 PUT /api/goals/:goalId updates goal target", async () => {
    const res = await makeRequest("PUT", `${API_BASE}/goals/${createdGoalId}`, {
      target: 1200,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(Number(res.body.goal.target), 1200);
  });

  // -------------------------------------------------------------------------
  // 3. Telemetry Ingest & Notification Stream Pipeline
  // -------------------------------------------------------------------------
  test("3.1 POST /api/telemetry/steps ingests steps and returns 200", async () => {
    const res = await makeRequest("POST", `${API_BASE}/telemetry/steps`, {
      userId: testUserId,
      steps: 1500,
      calories: 75,
      distance: 1.1,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  });

  test("3.2 GET /api/notifications/:userId returns created notifications", async () => {
    // Wait briefly for asynchronous evaluation if running event-driven
    await new Promise((r) => setTimeout(r, 600));

    const res = await makeRequest("GET", `${API_BASE}/notifications/${testUserId}`);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.notifications));
  });

  test("3.3 GET /api/notifications/:userId/unread-count and PUT /:id/read lifecycle", async () => {
    const listRes = await makeRequest("GET", `${API_BASE}/notifications/${testUserId}`);
    if (listRes.body.notifications && listRes.body.notifications.length > 0) {
      const notif = listRes.body.notifications[0];
      const notifId = notif._id || notif.id;

      const readRes = await makeRequest("PUT", `${API_BASE}/notifications/${notifId}/read`);
      assert.equal(readRes.statusCode, 200);
      assert.equal(readRes.body.success, true);

      const countRes = await makeRequest("GET", `${API_BASE}/notifications/${testUserId}/unread-count`);
      assert.equal(countRes.statusCode, 200);
      assert.ok(typeof countRes.body.unreadCount === "number");
    }
  });

  // -------------------------------------------------------------------------
  // 4. Dashboard Read Model
  // -------------------------------------------------------------------------
  test("4.1 GET /api/dashboard/:userId reflects ingested telemetry totals", async () => {
    const res = await makeRequest("GET", `${API_BASE}/dashboard/${testUserId}`);
    assert.equal(res.statusCode, 200);
    const data = res.body.data || res.body;
    assert.ok(data, "Dashboard must return data");
    const steps = data.totalSteps !== undefined ? data.totalSteps : (data.activity && data.activity.totalSteps);
    assert.ok(Number(steps) >= 1500, `Dashboard steps should reflect at least 1500, got ${steps}`);
  });

  // -------------------------------------------------------------------------
  // 5. Workout Lifecycle & Correct Total Updating
  // -------------------------------------------------------------------------
  let workoutId = null;

  test("5.1 POST /api/workout/start starts live workout", async () => {
    const res = await makeRequest("POST", `${API_BASE}/workout/start`, {
      userId: testUserId,
      workoutType: "running",
    });
    assert.ok([200, 201].includes(res.statusCode));
    assert.equal(res.body.success, true);
    assert.ok(res.body.workout);
    workoutId = res.body.workout._id || res.body.workout.id || res.body.workout.workoutId;
  });

  test("5.2 POST /api/workout/live-metrics streams active telemetry", async () => {
    const res = await makeRequest("POST", `${API_BASE}/workout/live-metrics`, {
      userId: testUserId,
      workoutId,
      heartRate: 152,
      calories: 140,
      steps: 600,
      distance: 0.8,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  });

  test("5.3 POST /api/workout/pause and resume", async () => {
    const pauseRes = await makeRequest("POST", `${API_BASE}/workout/pause`, {
      userId: testUserId,
      workoutId,
    });
    assert.equal(pauseRes.statusCode, 200);

    const resumeRes = await makeRequest("POST", `${API_BASE}/workout/resume`, {
      userId: testUserId,
      workoutId,
    });
    assert.equal(resumeRes.statusCode, 200);
  });

  test("5.4 POST /api/workout/stop saves workout and updates dashboard totals", async () => {
    const res = await makeRequest("POST", `${API_BASE}/workout/stop`, {
      userId: testUserId,
      workoutId,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.workoutSummary || res.body.workout);

    // Verify active workout is now null
    const activeRes = await makeRequest("GET", `${API_BASE}/workout/active/${testUserId}`);
    assert.equal(activeRes.statusCode, 200);
    assert.equal(activeRes.body.workout, null);

    // Verify workout history includes this workout
    const histRes = await makeRequest("GET", `${API_BASE}/workout/history/${testUserId}`);
    assert.equal(histRes.statusCode, 200);
    assert.ok(Array.isArray(histRes.body.workouts));
    assert.ok(histRes.body.workouts.length >= 1);
  });

  // -------------------------------------------------------------------------
  // 6. Error & Edge Cases Contract
  // -------------------------------------------------------------------------
  test("6.1 GET /api/nonexistent-route-xyz returns 404", async () => {
    const res = await makeRequest("GET", `${API_BASE}/nonexistent-route-xyz`);
    assert.equal(res.statusCode, 404);
  });
});
