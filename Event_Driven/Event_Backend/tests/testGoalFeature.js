/**
 * ============================================================================
 * GOAL FEATURE TEST SUITE (SET FITNESS GOAL)
 * ============================================================================
 * Verifies the complete Set Goal feature on the Event-Driven architecture:
 *  1. Goal Creation:     POST /api/goals persists goals (daily/weekly periods)
 *  2. Duplicate Guard:   Same user+type+period -> 409 DUPLICATE_GOAL
 *  3. Validation:        Invalid payloads -> 400
 *  4. Activity Progress: STEP_UPDATED events advance goal.current (20% -> 60% -> 100%)
 *  5. GOAL_REACHED:      Exactly one notification per goal per period
 *  6. Real-Time Push:    SSE stream receives the GOAL_REACHED alert
 *  7. CRUD:              PUT target updates / complete / deactivate
 *  8. Isolation:         Goals are scoped to their user
 * ============================================================================
 */

const http = require("http");
const connectDB = require("../src/config/db");
const Goal = require("../src/models/Goal");
const FitnessData = require("../src/models/FitnessData");
const Notification = require("../src/models/Notification");

const TEST_PORT = process.env.PORT || 5001;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_USER = "goal_feature_test_user";
const OTHER_USER = "goal_feature_other_user";

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    return null;
  }

  console.log(`${colors.cyan}[INFO] Starting backend server for testing...${colors.reset}`);
  await connectDB();
  const { initGoalConsumers } = require("../src/consumers/goalConsumer");
  initGoalConsumers();

  const express = require("express");
  const cors = require("cors");
  const dashboardRoutes = require("../src/routes/dashboard");
  const notificationRoutes = require("../src/routes/notification");
  const telemetryRoutes = require("../src/routes/telemetry");
  const goalRoutes = require("../src/routes/goal");

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", dashboardRoutes);
  app.use("/api", notificationRoutes);
  app.use("/api", telemetryRoutes);
  app.use("/api", goalRoutes);
  app.use("/", goalRoutes);
  app.get("/health", (req, res) => res.json({ status: "ok" }));

  return new Promise((resolve) => {
    const server = app.listen(TEST_PORT, () => {
      console.log(`${colors.green}[OK] Test server listening on http://localhost:${TEST_PORT}${colors.reset}\n`);
      resolve(server);
    });
  });
}

function findView(goals, type, period) {
  return (goals || []).find((g) => g.type === type && (g.period || "daily") === period) || null;
}

function countGoalReached(notifications) {
  return (notifications || []).filter((n) => n.type === "GOAL_REACHED").length;
}

async function runGoalFeatureTests() {
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta} SET FITNESS GOAL - EVENT-DRIVEN TEST SUITE${colors.reset}`);
  console.log(`${colors.bright} Coverage: CRUD + validation + progress + GOAL_REACHED + SSE + isolation${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}\n`);

  let testServer = null;
  let passedCount = 0;
  let totalTests = 0;

  const pass = (msg) => {
    console.log(`  ${colors.green}✔ PASS:${colors.reset} ${msg}`);
    passedCount++;
  };
  const fail = (msg) => {
    console.log(`  ${colors.red}✘ FAIL:${colors.reset} ${msg}`);
  };
  const check = (condition, passMsg, failMsg) => {
    totalTests++;
    if (condition) pass(passMsg);
    else fail(failMsg);
  };

  try {
    testServer = await ensureServer();

    await Notification.deleteMany({ userId: { $in: [TEST_USER, OTHER_USER] } });
    await FitnessData.deleteMany({ userId: { $in: [TEST_USER, OTHER_USER] } });
    await Goal.deleteMany({ userId: { $in: [TEST_USER, OTHER_USER] } });

    // ------------------------------------------------------------------------
    // 1. Goal creation + persistence
    // ------------------------------------------------------------------------
    console.log(`${colors.yellow}[TEST 1] Goal Creation & Persistence${colors.reset}`);
    const createRes = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: TEST_USER, type: "steps", target: 10000, period: "daily" },
    });
    check(
      createRes.status === 200 && createRes.body.success && createRes.body.goal && createRes.body.goal.target === 10000,
      "Daily steps goal created (target 10000, status 200)",
      `Goal creation failed: status ${createRes.status} body ${JSON.stringify(createRes.body)}`
    );
    const stepsGoalId = createRes.body && createRes.body.goal && createRes.body.goal._id;

    const createCalRes = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: TEST_USER, type: "calories", target: 100, period: "daily" },
    });
    const caloriesGoalId = createCalRes.body && createCalRes.body.goal && createCalRes.body.goal._id;
    check(
      createCalRes.status === 200 && createCalRes.body.success,
      "Daily calories goal created (target 100)",
      `Calories goal creation failed: status ${createCalRes.status}`
    );

    const initialList = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    const initialGoals = initialList.body && initialList.body.goals;
    check(
      initialList.status === 200 && initialGoals && initialGoals.length === 2,
      `GET /api/goals/:userId returns both persisted goals (count ${initialGoals && initialGoals.length})`,
      `Expected 2 goals, got ${initialGoals && initialGoals.length}`
    );

    // ------------------------------------------------------------------------
    // 2. Duplicate prevention
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 2] Duplicate Goal Guard${colors.reset}`);
    const dupRes = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: TEST_USER, type: "steps", target: 10000, period: "daily" },
    });
    check(
      dupRes.status === 409 && dupRes.body.code === "DUPLICATE_GOAL",
      "Duplicate daily steps goal rejected with 409 DUPLICATE_GOAL",
      `Expected 409 DUPLICATE_GOAL, got status ${dupRes.status} code ${dupRes.body.code}`
    );

    const weeklyDup = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: TEST_USER, type: "steps", target: 50000, period: "weekly" },
    });
    check(
      weeklyDup.status === 200,
      "Same type with different period (weekly) is allowed",
      `Weekly goal with same type rejected: status ${weeklyDup.status}`
    );
    const weeklyGoalId = weeklyDup.body && weeklyDup.body.goal && weeklyDup.body.goal._id;
    // Remove the weekly goal again so progress checks below stay isolated
    if (weeklyGoalId) await Goal.deleteOne({ _id: weeklyGoalId });

    // ------------------------------------------------------------------------
    // 3. Payload validation
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 3] Payload Validation${colors.reset}`);
    const invalidTarget = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: TEST_USER, type: "steps", target: -5 },
    });
    check(invalidTarget.status === 400, "Negative target rejected with 400", `Expected 400, got ${invalidTarget.status}`);

    const missingUser = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { type: "steps", target: 100 },
    });
    check(missingUser.status === 400, "Missing userId rejected with 400", `Expected 400, got ${missingUser.status}`);

    const badPeriod = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: TEST_USER, type: "steps", target: 100, period: "monthly" },
    });
    check(badPeriod.status === 400, "Invalid period rejected with 400", `Expected 400, got ${badPeriod.status}`);

    // ------------------------------------------------------------------------
    // 4. Activity-driven progress: 20% -> 60% -> 100%
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 4] Activity Progress: 20% -> 60% -> 100%${colors.reset}`);

    await makeRequest(`${BASE_URL}/api/telemetry/steps`, {
      method: "POST",
      body: { userId: TEST_USER, steps: 2000 },
    });
    await wait(700);
    let list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    let stepsView = findView(list.body.goals, "steps", "daily");
    check(
      stepsView && stepsView.current === 2000 && stepsView.percentage === 20 && stepsView.status === "active",
      `After 2000 steps: current 2000, 20%, active (got ${stepsView && `${stepsView.current}/${stepsView.percentage}%/${stepsView.status}`})`,
      `Unexpected progress after 2000 steps: ${JSON.stringify(stepsView)}`
    );

    await makeRequest(`${BASE_URL}/api/telemetry/steps`, {
      method: "POST",
      body: { userId: TEST_USER, steps: 4000 },
    });
    await wait(700);
    list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    stepsView = findView(list.body.goals, "steps", "daily");
    check(
      stepsView && stepsView.current === 6000 && stepsView.percentage === 60 && stepsView.status === "active",
      `After 6000 steps: current 6000, 60%, active (got ${stepsView && `${stepsView.current}/${stepsView.percentage}%/${stepsView.status}`})`,
      `Unexpected progress after 6000 steps: ${JSON.stringify(stepsView)}`
    );

    await makeRequest(`${BASE_URL}/api/telemetry/steps`, {
      method: "POST",
      body: { userId: TEST_USER, steps: 4000, calories: 150 },
    });
    await wait(700);
    list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    stepsView = findView(list.body.goals, "steps", "daily");
    const caloriesView = findView(list.body.goals, "calories", "daily");
    check(
      stepsView && stepsView.current === 10000 && stepsView.percentage === 100 && stepsView.status === "completed",
      `At target: current 10000, 100%, completed (got ${stepsView && `${stepsView.current}/${stepsView.percentage}%/${stepsView.status}`})`,
      `Goal not completed at target: ${JSON.stringify(stepsView)}`
    );
    check(
      caloriesView && caloriesView.current === 150 && caloriesView.percentage === 100 && caloriesView.status === "completed",
      `Calories goal completed by same event (current 150/100)`,
      `Calories goal unexpected: ${JSON.stringify(caloriesView)}`
    );

    // ------------------------------------------------------------------------
    // 5. GOAL_REACHED notification (exactly one per goal per period)
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 5] GOAL_REACHED Notification (once per goal per period)${colors.reset}`);
    const countRes = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/unread-count`);
    const listRes = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}`);
    const notifications = (listRes.body && listRes.body.notifications) || [];
    const goalReached = notifications.filter((n) => n.type === "GOAL_REACHED");
    check(
      countRes.body.unreadCount === 2 && goalReached.length === 2,
      `Exactly 2 GOAL_REACHED notifications created (steps + calories), unread=${countRes.body.unreadCount}`,
      `Expected 2 GOAL_REACHED notifications, unread=${countRes.body.unreadCount} goalReached=${goalReached.length}`
    );
    check(
      goalReached.every((n) => n.title.includes("Goal Achieved") && n.read === false),
      `Notification titles: "${goalReached.map((n) => n.title).join('" | "')}" (unread)`,
      `Unexpected notification content: ${JSON.stringify(goalReached)}`
    );

    await makeRequest(`${BASE_URL}/api/telemetry/steps`, {
      method: "POST",
      body: { userId: TEST_USER, steps: 500, calories: 50 },
    });
    await wait(700);
    const countAfter = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/unread-count`);
    check(
      countAfter.body.unreadCount === 2,
      `No duplicate notifications after further activity (unread still ${countAfter.body.unreadCount})`,
      `Duplicate notification created: unread=${countAfter.body.unreadCount}`
    );

    // ------------------------------------------------------------------------
    // 6. Real-time SSE push of a new GOAL_REACHED alert
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 6] Real-Time SSE Push (GOAL_REACHED via EventSource)${colors.reset}`);
    let sseReceived = false;
    await new Promise((resolve) => {
      const parsedUrl = new URL(`${BASE_URL}/api/notifications/${TEST_USER}/stream`);
      const sseReq = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: "GET",
          headers: { Accept: "text/event-stream" },
        },
        (sseRes) => {
          let sseData = "";
          sseRes.on("data", (chunk) => {
            sseData += chunk.toString();
            if (sseData.includes("event: notification") || sseData.includes("GOAL_REACHED")) {
              sseReceived = true;
              sseReq.destroy();
              resolve();
            }
          });
        }
      );
      sseReq.on("error", () => resolve());

      // Create a fresh distance goal, then reach it while SSE is connected
      setTimeout(async () => {
        await makeRequest(`${BASE_URL}/api/goals`, {
          method: "POST",
          body: { userId: TEST_USER, type: "distance", target: 1, period: "daily" },
        });
        await wait(300);
        await makeRequest(`${BASE_URL}/api/telemetry/steps`, {
          method: "POST",
          body: { userId: TEST_USER, steps: 100, distance: 1.5 },
        });
      }, 300);

      setTimeout(() => {
        sseReq.destroy();
        resolve();
      }, 3000);

      sseReq.end();
    });
    check(
      sseReceived,
      "SSE client received GOAL_REACHED push in real time",
      "SSE stream did not deliver the GOAL_REACHED event within 3s"
    );

    // ------------------------------------------------------------------------
    // 7. Weekly period goal
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 7] Weekly Goal Period${colors.reset}`);
    const weeklyRes = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: TEST_USER, type: "steps", target: 50000, period: "weekly" },
    });
    list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    const weeklyView = findView(list.body.goals, "steps", "weekly");
    check(
      weeklyRes.status === 200 && weeklyView && weeklyView.period === "weekly" && weeklyView.status === "active",
      `Weekly steps goal persisted with period="weekly" (current ${weeklyView && weeklyView.current}, ${weeklyView && weeklyView.percentage}%)`,
      `Weekly goal missing or wrong: ${JSON.stringify(weeklyView)}`
    );
    check(
      weeklyView && weeklyView.percentage === Math.min(100, Math.round((weeklyView.current / 50000) * 100)) && weeklyView.percentage < 100,
      "Weekly progress computed against the weekly target (not reached yet)",
      `Weekly progress unexpected: ${JSON.stringify(weeklyView)}`
    );

    // ------------------------------------------------------------------------
    // 8. User isolation
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 8] User Isolation${colors.reset}`);
    const otherRes = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: OTHER_USER, type: "steps", target: 500, period: "daily" },
    });
    const otherList = await makeRequest(`${BASE_URL}/api/goals/${OTHER_USER}`);
    const myList = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    const myTypes = (myList.body.goals || []).map((g) => `${g.type}:${g.period}`).sort();
    check(
      otherRes.status === 200 &&
        otherList.body.goals.length === 1 &&
        otherList.body.goals[0].target === 500,
      `Other user sees only its own goal (count ${otherList.body.goals.length}); current user goals: ${myTypes.join(", ")}`,
      `Isolation broken: other=${JSON.stringify(otherList.body.goals)}`
    );
    check(
      (myList.body.goals || []).every((g) => !(g.type === "steps" && g.period === "daily" && g.target === 500)),
      "Other user's goal does not leak into current user's list",
      "Isolation broken: other user's goal leaked into current user's list"
    );

    // ------------------------------------------------------------------------
    // 9. PUT update (target change resets achievement) + complete + deactivate
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 9] PUT Update / Complete / Deactivate${colors.reset}`);
    const putRes = await makeRequest(`${BASE_URL}/api/goals/${stepsGoalId}`, {
      method: "PUT",
      body: { target: 20000 },
    });
    list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    stepsView = findView(list.body.goals, "steps", "daily");
    check(
      putRes.status === 200 && stepsView && stepsView.target === 20000 && stepsView.status === "active" && stepsView.percentage < 100,
      `PUT raised target to 20000 and reset achievement (now ${stepsView && stepsView.percentage}%)`,
      `PUT update unexpected: status ${putRes.status} view ${JSON.stringify(stepsView)}`
    );

    const completeRes = await makeRequest(`${BASE_URL}/api/goals/${stepsGoalId}/complete`, {
      method: "POST",
    });
    list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    stepsView = findView(list.body.goals, "steps", "daily");
    check(
      completeRes.status === 200 && stepsView && stepsView.status === "completed",
      "POST /goals/:goalId/complete marks the goal completed",
      `Complete failed: status ${completeRes.status} view ${JSON.stringify(stepsView)}`
    );

    const activeRes = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}/active`);
    const activeTypes = ((activeRes.body && activeRes.body.goals) || []).map((g) => `${g.type}:${g.period}`);
    check(
      activeRes.status === 200 && !activeTypes.includes("steps:daily") && activeTypes.includes("steps:weekly"),
      `GET /goals/:userId/active excludes completed goals (active: ${activeTypes.join(", ")})`,
      `Active list wrong: ${JSON.stringify(activeTypes)}`
    );

    const deactivateRes = await makeRequest(`${BASE_URL}/api/goals/${stepsGoalId}`, {
      method: "PUT",
      body: { active: false },
    });
    const afterDeactivate = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    const stillVisible = findView(afterDeactivate.body.goals, "steps", "daily");
    check(
      deactivateRes.status === 200 && !stillVisible,
      "Deactivated goal (active=false) disappears from goal list",
      `Deactivate failed: status ${deactivateRes.status} stillVisible=${JSON.stringify(stillVisible)}`
    );

    // ------------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------------
    console.log(`\n${colors.bright}${colors.blue}========================================================================${colors.reset}`);
    console.log(`${colors.bright} SET GOAL (EVENT-DRIVEN) TEST RESULTS: ${passedCount} / ${totalTests} PASSED${colors.reset}`);
    if (passedCount === totalTests) {
      console.log(`${colors.bright}${colors.green} ✔ ALL GOAL FEATURE TESTS PASSED!${colors.reset}`);
    } else {
      console.log(`${colors.bright}${colors.red} ✘ SOME GOAL FEATURE TESTS FAILED.${colors.reset}`);
    }
    console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}\n`);
  } catch (error) {
    console.error(`${colors.red}Goal feature test execution error:${colors.reset}`, error);
  } finally {
    if (testServer) {
      testServer.close();
    }
  }

  return { passedCount, totalTests };
}

if (require.main === module) {
  runGoalFeatureTests().then(({ passedCount, totalTests }) => {
    process.exit(passedCount === totalTests ? 0 : 1);
  });
}

module.exports = { runGoalFeatureTests };
