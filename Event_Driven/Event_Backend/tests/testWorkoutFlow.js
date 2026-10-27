/**
 * ============================================================================
 * SPRINT 2 - STORY 3: WORKOUT SESSION FLOW & RECOMMENDATIONS TEST SUITE
 * ============================================================================
 *
 * Flow under test:
 *   [Workout API] -> [Event Bus] -> [Recommendation Engine] -> [Notification Service]
 *
 * 1. POST /api/workout/start        -> 201, status in-progress, WORKOUT_STARTED
 * 2. Duplicate start                -> 400 "Workout session already active"
 * 3. POST /api/workout/live-metrics -> live HR + calories tracked
 * 4. POST /api/workout/stop         -> 200 { workoutSummary, recommendations, inAppNotification }
 * 5. Event Bus routing              -> WORKOUT_COMPLETED -> RECOMMENDATION_GENERATED
 * 6. Stop again                     -> 400 "No active workout found"
 * 7. History / Active reads         -> completed session persisted with recommendations
 * ============================================================================
 */

const http = require("http");
const connectDB = require("../src/config/db");
const { eventBus, EVENTS } = require("../src/utils/eventBus");
const { initWorkoutConsumers } = require("../src/consumers/workoutConsumer");
const Workout = require("../src/models/Workout");
const Notification = require("../src/models/Notification");

const TEST_PORT = process.env.PORT || 5001;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_USER = "sourabha_workout_test_user";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      timeout: options.timeout || 8000,
    };

    const req = http.request(reqOptions, (res) => {
      let rawData = "";
      res.on("data", (chunk) => (rawData += chunk));
      res.on("end", () => {
        let body;
        try {
          body = JSON.parse(rawData);
        } catch (e) {
          body = rawData;
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out`));
    });

    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function ensureServer() {
  await connectDB();
  const isRunning = await new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });

  if (isRunning) {
    console.log(`${colors.cyan}[INFO] Backend server already running on port ${TEST_PORT}.${colors.reset}`);
    initWorkoutConsumers();
    return null;
  }

  console.log(`${colors.cyan}[INFO] Starting backend server for testing...${colors.reset}`);
  await connectDB();
  initWorkoutConsumers();

  const express = require("express");
  const cors = require("cors");
  const dashboardRoutes = require("../src/routes/dashboard");
  const notificationRoutes = require("../src/routes/notification");
  const telemetryRoutes = require("../src/routes/telemetry");
  const workoutRoutes = require("../src/routes/workout");

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", dashboardRoutes);
  app.use("/api", notificationRoutes);
  app.use("/api", telemetryRoutes);
  app.use("/api", workoutRoutes);
  app.get("/health", (req, res) => res.json({ status: "ok" }));

  return new Promise((resolve) => {
    const server = app.listen(TEST_PORT, () => {
      console.log(`${colors.green}[OK] Test server listening on http://localhost:${TEST_PORT}${colors.reset}\n`);
      resolve(server);
    });
  });
}

async function runWorkoutFlowTests() {
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta} SPRINT 2 - STORY 3 | WORKOUT SESSION FLOW TEST SUITE${colors.reset}`);
  console.log(`${colors.bright} Task: Workout API -> Event Bus -> Recommendation -> Notification${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}\n`);

  let testServer = null;
  let passedCount = 0;
  let totalTests = 0;

  try {
    testServer = await ensureServer();

    await Workout.deleteMany({ userId: TEST_USER });
    await Notification.deleteMany({ userId: TEST_USER });

    const interceptedEvents = {
      workoutStarted: false,
      workoutCompleted: false,
      recommendationGenerated: false,
      notificationCreated: false,
    };

    eventBus.on(EVENTS.WORKOUT_STARTED, (d) => {
      if (d.userId === TEST_USER) interceptedEvents.workoutStarted = true;
    });
    eventBus.on(EVENTS.WORKOUT_COMPLETED, (d) => {
      if (d.userId === TEST_USER) interceptedEvents.workoutCompleted = true;
    });
    eventBus.on(EVENTS.RECOMMENDATION_GENERATED, (d) => {
      if (d.userId === TEST_USER) interceptedEvents.recommendationGenerated = true;
    });
    eventBus.on(EVENTS.NOTIFICATION_CREATED, (d) => {
      if (d.userId === TEST_USER && d.workoutId) interceptedEvents.notificationCreated = true;
    });

    // ------------------------------------------------------------------------
    // STEP 1: Start a workout session
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`${colors.yellow}[STEP 1] Start Workout Session (POST /api/workout/start)${colors.reset}`);
    const startRes = await makeRequest(`${BASE_URL}/api/workout/start`, {
      method: "POST",
      body: { userId: TEST_USER, workoutType: "running" },
    });

    if (startRes.status === 201 && startRes.body.success && startRes.body.status === "in-progress") {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Workout created with status "in-progress" (201)`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Start failed: Status ${startRes.status} ${JSON.stringify(startRes.body)}`);
    }

    // ------------------------------------------------------------------------
    // STEP 2: Concurrency guard — duplicate start must be rejected
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[STEP 2] Concurrency Protection: Duplicate Start Rejected${colors.reset}`);
    const duplicateRes = await makeRequest(`${BASE_URL}/api/workout/start`, {
      method: "POST",
      body: { userId: TEST_USER, workoutType: "cycling" },
    });

    if (
      duplicateRes.status === 400 &&
      duplicateRes.body.message === "Workout session already active"
    ) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Second start blocked with 400: "${duplicateRes.body.message}"`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Expected 400 conflict, got: Status ${duplicateRes.status}`);
    }

    // ------------------------------------------------------------------------
    // STEP 3: Live telemetry during the session
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[STEP 3] Live Metrics: Heart Rate + Calories During Session${colors.reset}`);
    const liveRes = await makeRequest(`${BASE_URL}/api/workout/live-metrics`, {
      method: "POST",
      body: { userId: TEST_USER, heartRate: 160, calories: 250 },
    });
    const liveRes2 = await makeRequest(`${BASE_URL}/api/workout/live-metrics`, {
      method: "POST",
      body: { userId: TEST_USER, heartRate: 158, calories: 220 },
    });

    if (
      liveRes.status === 200 &&
      liveRes2.status === 200 &&
      liveRes2.body.live.caloriesBurned === 470 &&
      liveRes2.body.live.heartRate >= 158
    ) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Live totals accumulated: ${liveRes2.body.live.caloriesBurned} kcal, avg HR ${liveRes2.body.live.heartRate} bpm`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Live metrics update failed: ${JSON.stringify(liveRes2.body)}`);
    }

    // ------------------------------------------------------------------------
    // STEP 4: Stop the workout — full choreographed response
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[STEP 4] Stop Workout: Summary + Recommendations + Notification${colors.reset}`);
    const stopRes = await makeRequest(`${BASE_URL}/api/workout/stop`, {
      method: "POST",
      body: { userId: TEST_USER },
    });

    const summary = stopRes.body && stopRes.body.workoutSummary;
    const recommendations = (stopRes.body && stopRes.body.recommendations) || [];
    const notification = stopRes.body && stopRes.body.inAppNotification;

    if (
      stopRes.status === 200 &&
      summary &&
      summary.status === "completed" &&
      Array.isArray(recommendations) &&
      recommendations.length > 0 &&
      notification &&
      notification.type === "WORKOUT_COMPLETED"
    ) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} 200 OK with workoutSummary (status: completed, ${summary.durationMinutes} min, ${summary.caloriesBurned} kcal, ${summary.avgHeartRate} bpm)`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Recommendations returned: ${recommendations.length}`);
      recommendations.forEach((r) => console.log(`      • ${r}`));
      console.log(`  ${colors.green}✔ PASS:${colors.reset} In-app notification created: "${notification.title}"`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Stop response incomplete: Status ${stopRes.status} ${JSON.stringify(stopRes.body).slice(0, 300)}`);
    }

    // ------------------------------------------------------------------------
    // STEP 5: Event Bus choreography verification
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[STEP 5] Event Bus: WORKOUT_STARTED -> WORKOUT_COMPLETED -> RECOMMENDATION_GENERATED${colors.reset}`);
    if (
      interceptedEvents.workoutStarted &&
      interceptedEvents.workoutCompleted &&
      interceptedEvents.recommendationGenerated &&
      interceptedEvents.notificationCreated
    ) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} All 4 events dispatched through the Event Bus`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Missing events: ${JSON.stringify(interceptedEvents)}`);
    }

    // ------------------------------------------------------------------------
    // STEP 6: Idempotent termination — stop with no active session
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[STEP 6] Idempotent Termination: Stop Without Active Session${colors.reset}`);
    const secondStop = await makeRequest(`${BASE_URL}/api/workout/stop`, {
      method: "POST",
      body: { userId: TEST_USER },
    });

    if (secondStop.status === 400 && secondStop.body.message === "No active workout found") {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Second stop rejected with 400: "${secondStop.body.message}"`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Expected 400, got: Status ${secondStop.status}`);
    }

    // ------------------------------------------------------------------------
    // STEP 7: History, active session and persisted recommendations
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[STEP 7] Reads: Active Session + History + Persistence${colors.reset}`);
    const activeRes = await makeRequest(`${BASE_URL}/api/workout/active/${TEST_USER}`);
    const historyRes = await makeRequest(`${BASE_URL}/api/workout/history/${TEST_USER}`);
    const storedWorkout =
      historyRes.body && historyRes.body.workouts && historyRes.body.workouts[0];

    if (
      activeRes.status === 200 &&
      activeRes.body.workout === null &&
      historyRes.status === 200 &&
      storedWorkout &&
      storedWorkout.status === "completed" &&
      storedWorkout.recommendations.length > 0
    ) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Active session cleared (null) after completion`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} History returns completed workout with ${storedWorkout.recommendations.length} persisted recommendations`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Read endpoints incorrect: ${JSON.stringify(historyRes.body).slice(0, 300)}`);
    }

    // ------------------------------------------------------------------------
    // Summary Report
    // ------------------------------------------------------------------------
    console.log(`\n${colors.bright}${colors.blue}========================================================================${colors.reset}`);
    console.log(`${colors.bright} SPRINT 2 - STORY 3 (WORKOUT SERVICE) TEST RESULTS: ${passedCount} / ${totalTests} PASSED${colors.reset}`);
    if (passedCount === totalTests) {
      console.log(`${colors.bright}${colors.green} ✔ FULL WORKOUT FLOW [API -> Event Bus -> Recommendation -> Notification] PASSED!${colors.reset}`);
    } else {
      console.log(`${colors.bright}${colors.red} ✘ SOME WORKOUT TESTS FAILED.${colors.reset}`);
    }
    console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}\n`);
  } catch (error) {
    console.error(`${colors.red}Workout test execution error:${colors.reset}`, error);
  } finally {
    if (testServer) {
      testServer.close();
    }
  }

  return { passedCount, totalTests };
}

if (require.main === module) {
  runWorkoutFlowTests().then(({ passedCount, totalTests }) => {
    process.exit(passedCount === totalTests ? 0 : 1);
  });
}

module.exports = { runWorkoutFlowTests };
