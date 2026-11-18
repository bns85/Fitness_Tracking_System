/**
 * ============================================================================
 * GOAL FEATURE TEST SUITE (SET FITNESS GOAL) - POLLING ARCHITECTURE
 * ============================================================================
 * Verifies the complete Set Goal feature on the Polling architecture:
 *  1. Goal Creation:     POST /api/goals persists goals (daily/weekly periods)
 *  2. Duplicate Guard:   Same user+type+period -> 409 DUPLICATE_GOAL
 *  3. Validation:        Invalid payloads -> 400
 *  4. Activity Progress: step ingestion advances goal.current (20% -> 60% -> 100%)
 *  5. GOAL_REACHED:      Background polling worker creates exactly one alert
 *  6. Poll Delivery:     GET /api/notifications/:userId/poll returns the alert
 *  7. CRUD:              PUT target updates / complete / deactivate
 *  8. Isolation:         Goals are scoped to their user
 * ============================================================================
 */

const http = require("http");
const connectDB = require("../src/config/db");
const Goal = require("../src/models/Goal");
const FitnessData = require("../src/models/FitnessData");
const Notification = require("../src/models/Notification");

const TEST_PORT = process.env.PORT || 5002;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_USER = "goal_polling_test_user";
const OTHER_USER = "goal_polling_other_user";

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
  const { startGoalPollingWorker } = require("../src/workers/goalPollingWorker");
  startGoalPollingWorker();

  const express = require("express");
  const cors = require("cors");
  const dashboardRoutes = require("../src/routes/dashboard");
  const notificationRoutes = require("../src/routes/notification");
  const workoutRoutes = require("../src/routes/workout");
  const goalRoutes = require("../src/routes/goal");

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", dashboardRoutes);
  app.use("/api", notificationRoutes);
  app.use("/api", workoutRoutes);
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

async function waitForUnread(userId, minCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await makeRequest(`${BASE_URL}/api/notifications/${userId}/unread-count`);
    last = res.body && res.body.unreadCount;
    if (typeof last === "number" && last >= minCount) return last;
    await wait(500);
  }
  return last;
}

async function runGoalFeatureTests() {
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta} SET FITNESS GOAL - POLLING TEST SUITE${colors.reset}`);
  console.log(`${colors.bright} Coverage: CRUD + validation + progress + GOAL_REACHED worker + poll delivery${colors.reset}`);
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

    const initialList = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    const initialGoals = initialList.body && initialList.body.goals;
    check(
      initialList.status === 200 && initialGoals && initialGoals.length === 1 && initialGoals[0].current === 0,
      `GET /api/goals/:userId returns persisted goal with current=0 (count ${initialGoals && initialGoals.length})`,
      `Unexpected initial goals: ${JSON.stringify(initialGoals)}`
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

    await makeRequest(`${BASE_URL}/api/steps/${TEST_USER}`, {
      method: "POST",
      body: { steps: 2000 },
    });
    let list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    let stepsView = findView(list.body.goals, "steps", "daily");
    check(
      stepsView && stepsView.current === 2000 && stepsView.percentage === 20 && stepsView.status === "active",
      `After 2000 steps: current 2000, 20%, active (got ${stepsView && `${stepsView.current}/${stepsView.percentage}%/${stepsView.status}`})`,
      `Unexpected progress after 2000 steps: ${JSON.stringify(stepsView)}`
    );

    await makeRequest(`${BASE_URL}/api/steps/${TEST_USER}`, {
      method: "POST",
      body: { steps: 4000 },
    });
    list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    stepsView = findView(list.body.goals, "steps", "daily");
    check(
      stepsView && stepsView.current === 6000 && stepsView.percentage === 60 && stepsView.status === "active",
      `After 6000 steps: current 6000, 60%, active (got ${stepsView && `${stepsView.current}/${stepsView.percentage}%/${stepsView.status}`})`,
      `Unexpected progress after 6000 steps: ${JSON.stringify(stepsView)}`
    );

    await makeRequest(`${BASE_URL}/api/steps/${TEST_USER}`, {
      method: "POST",
      body: { steps: 4000 },
    });
    list = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    stepsView = findView(list.body.goals, "steps", "daily");
    check(
      stepsView && stepsView.current === 10000 && stepsView.percentage === 100 && stepsView.status === "completed",
      `At target: current 10000, 100%, completed (got ${stepsView && `${stepsView.current}/${stepsView.percentage}%/${stepsView.status}`})`,
      `Goal not completed at target: ${JSON.stringify(stepsView)}`
    );

    // ------------------------------------------------------------------------
    // 5. Background polling worker creates GOAL_REACHED exactly once
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 5] Polling Worker: GOAL_REACHED Created Once${colors.reset}`);
    const unread = await waitForUnread(TEST_USER, 1, 12000);
    const listRes = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}`);
    const notifications = (listRes.body && listRes.body.notifications) || [];
    const goalReached = notifications.filter((n) => n.type === "GOAL_REACHED");
    check(
      unread >= 1 && goalReached.length === 1,
      `Background worker created exactly 1 GOAL_REACHED notification (unread=${unread})`,
      `Expected 1 GOAL_REACHED notification, unread=${unread} goalReached=${goalReached.length}`
    );
    check(
      goalReached[0] && goalReached[0].title.includes("Goal Achieved") && goalReached[0].read === false,
      `Notification title: "${goalReached[0] && goalReached[0].title}" (unread)`,
      `Unexpected notification content: ${JSON.stringify(goalReached[0])}`
    );

    // ------------------------------------------------------------------------
    // 6. Poll delivery mechanism returns the alert
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 6] Poll Delivery: GET /notifications/:userId/poll${colors.reset}`);
    const pollRes = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/poll`);
    const polled = (pollRes.body && pollRes.body.notifications) || [];
    check(
      pollRes.status === 200 &&
        pollRes.body.architecture === "POLLING" &&
        countGoalReached(polled) === 1 &&
        pollRes.body.unreadCount >= 1,
      `Poll response delivers GOAL_REACHED (architecture ${pollRes.body.architecture}, unread ${pollRes.body.unreadCount})`,
      `Poll response wrong: ${JSON.stringify(pollRes.body)}`
    );

    // ------------------------------------------------------------------------
    // 7. No duplicate notification on further activity
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 7] No Duplicate GOAL_REACHED On Further Activity${colors.reset}`);
    await makeRequest(`${BASE_URL}/api/steps/${TEST_USER}`, {
      method: "POST",
      body: { steps: 500 },
    });
    await wait(1500);
    const pollAgain = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/poll`);
    const countAfter = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/unread-count`);
    const listAfter = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}`);
    const reachedAfter = countGoalReached((listAfter.body && listAfter.body.notifications) || []);
    check(
      reachedAfter === 1 && countAfter.body.unreadCount === 1,
      `Still exactly 1 GOAL_REACHED after more steps (reached=${reachedAfter}, unread=${countAfter.body.unreadCount}, poll unread=${pollAgain.body.unreadCount})`,
      `Duplicate created: reached=${reachedAfter} unread=${countAfter.body.unreadCount}`
    );

    // ------------------------------------------------------------------------
    // 8. Weekly period goal
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 8] Weekly Goal Period${colors.reset}`);
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
    // 9. User isolation
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 9] User Isolation${colors.reset}`);
    const otherRes = await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: OTHER_USER, type: "steps", target: 500, period: "daily" },
    });
    const otherList = await makeRequest(`${BASE_URL}/api/goals/${OTHER_USER}`);
    const myList = await makeRequest(`${BASE_URL}/api/goals/${TEST_USER}`);
    const myTypes = (myList.body.goals || []).map((g) => `${g.type}:${g.period}`).sort();
    check(
      otherRes.status === 200 && otherList.body.goals.length === 1 && otherList.body.goals[0].target === 500,
      `Other user sees only its own goal (count ${otherList.body.goals.length}); current user goals: ${myTypes.join(", ")}`,
      `Isolation broken: other=${JSON.stringify(otherList.body.goals)}`
    );
    check(
      (myList.body.goals || []).every((g) => !(g.type === "steps" && g.period === "daily" && g.target === 500)),
      "Other user's goal does not leak into current user's list",
      "Isolation broken: other user's goal leaked into current user's list"
    );

    // ------------------------------------------------------------------------
    // 10. PUT update (target change resets achievement) + complete + deactivate
    // ------------------------------------------------------------------------
    console.log(`\n${colors.yellow}[TEST 10] PUT Update / Complete / Deactivate${colors.reset}`);
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
    console.log(`${colors.bright} SET GOAL (POLLING) TEST RESULTS: ${passedCount} / ${totalTests} PASSED${colors.reset}`);
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
