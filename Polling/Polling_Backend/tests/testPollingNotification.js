/**
 * ============================================================================
 * SPRINT 1 - STORY 1 & STORY 2: MEMBER 3 (SIDDHARTH)
 * POLLING ARCHITECTURE NOTIFICATION TEST SUITE
 * ============================================================================
 * Tasks:
 *  - Story 1: "Notification: works on notification API"
 *  - Story 2: "Implement in app notification" (via Polling & Long-Polling)
 * ============================================================================
 */

const http = require("http");
const connectDB = require("../src/config/db");
const config = require("../src/config");
const Notification = require("../src/models/Notification");
const Goal = require("../src/models/Goal");
const FitnessData = require("../src/models/FitnessData");

const TEST_PORT = process.env.PORT || 5002;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_USER = "siddharth_poll_user";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
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
  const isRunning = await new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/health`, (res) => resolve(res.statusCode === 200));
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });

  if (isRunning) {
    console.log(`${colors.cyan}[INFO] Polling server already running on port ${TEST_PORT}.${colors.reset}`);
    return null;
  }

  console.log(`${colors.cyan}[INFO] Starting Polling backend server for testing...${colors.reset}`);
  await connectDB();

  const express = require("express");
  const cors = require("cors");
  const dashboardRoutes = require("../src/routes/dashboard");
  const notificationRoutes = require("../src/routes/notification");

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", dashboardRoutes);
  app.use("/api", notificationRoutes);
  app.get("/health", (req, res) => res.json({ status: "ok", architecture: "polling" }));

  return new Promise((resolve) => {
    const server = app.listen(TEST_PORT, () => {
      console.log(`${colors.green}[OK] Polling test server listening on http://localhost:${TEST_PORT}${colors.reset}\n`);
      resolve(server);
    });
  });
}

async function runPollingNotificationTests() {
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan} SPRINT 1 - STORY 1 & 2 | SIDDHARTH NOTIFICATION TESTING${colors.reset}`);
  console.log(`${colors.bright} Architecture: POLLING (Comparing with Event-Driven)${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}\n`);

  let testServer = null;
  let passedCount = 0;
  let totalTests = 0;

  try {
    testServer = await ensureServer();

    // Clean previous records
    await Notification.deleteMany({ userId: TEST_USER });
    await FitnessData.deleteMany({ userId: TEST_USER });
    await Goal.deleteMany({ userId: TEST_USER });

    // ------------------------------------------------------------------------
    // TEST 1: Story 1 - Create Notification via API (POST /api/notifications)
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`${colors.yellow}[TEST 1] Story 1: Manual Notification Creation (POST /api/notifications)${colors.reset}`);
    const createRes = await makeRequest(`${BASE_URL}/api/notifications`, {
      method: "POST",
      body: {
        userId: TEST_USER,
        type: "INACTIVITY",
        title: "Time to Move!",
        message: "You have been sedentary for 2 hours. Take a short walk!",
      },
    });

    if (createRes.status === 201 && createRes.body.success) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Notification created via API: Status 201 Created`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Status: ${createRes.status}`);
    }

    // ------------------------------------------------------------------------
    // TEST 2: Story 1 - Fetch Notifications List & Unread Count
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[TEST 2] Story 1: Get Notifications & Unread Count${colors.reset}`);
    const listRes = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}`);
    const countRes = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/unread-count`);

    if (listRes.status === 200 && countRes.body.unreadCount === 1) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Notifications list returned ${listRes.body.notifications.length} item(s)`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Unread count verified = ${countRes.body.unreadCount}`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Unexpected count or status`);
    }

    // ------------------------------------------------------------------------
    // TEST 3: Story 1 - Mark Notification as Read (PUT /api/notifications/:id/read)
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[TEST 3] Story 1: Mark Notification as Read${colors.reset}`);
    const notifId = listRes.body.notifications[0]._id;
    const readRes = await makeRequest(`${BASE_URL}/api/notifications/${notifId}/read`, {
      method: "PUT",
    });
    const updatedCount = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/unread-count`);

    if (readRes.status === 200 && readRes.body.notification.read === true && updatedCount.body.unreadCount === 0) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Notification marked as read successfully`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Unread count updated to 0`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Mark as read failed`);
    }

    // ------------------------------------------------------------------------
    // TEST 4: Story 2 - In-App Notification Polling (GET /api/notifications/:userId/poll)
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[TEST 4] Story 2: In-App Notification Polling (Initial state - no new goals)${colors.reset}`);
    const initialPoll = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/poll`);

    if (initialPoll.status === 200 && initialPoll.body.architecture === "POLLING" && initialPoll.body.hasNew === false) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Polling endpoint returned: architecture = POLLING, hasNew = false`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Recommended client poll interval = ${initialPoll.body.pollIntervalMs}ms`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Initial poll failed`);
    }

    // ------------------------------------------------------------------------
    // TEST 5: Story 2 - Goal Achieved -> Detected on Next Poll!
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[TEST 5] Story 2: Goal Achievement Detection via Polling${colors.reset}`);
    // Setup goal of 8,000 steps
    await makeRequest(`${BASE_URL}/api/goals`, {
      method: "POST",
      body: { userId: TEST_USER, type: "steps", target: 8000 },
    });

    // Ingest 8,500 steps (target reached!)
    await makeRequest(`${BASE_URL}/api/steps/${TEST_USER}`, {
      method: "POST",
      body: { steps: 8500 },
    });

    // Client polls server for updates
    const activePoll = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/poll`);
    const goalAlert = activePoll.body.notifications && activePoll.body.notifications.find((n) => n.type === "GOAL_REACHED");

    if (activePoll.status === 200 && activePoll.body.hasNew === true && goalAlert) {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Polling detected goal achieved! (hasNew = true)`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Alert Title: "${goalAlert.title}"`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Alert Message: "${goalAlert.message}"`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Unread count on poll: ${activePoll.body.unreadCount}`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Polling did not detect goal alert: ${JSON.stringify(activePoll.body)}`);
    }

    // ------------------------------------------------------------------------
    // TEST 6: Story 2 - Long-Polling Mechanism Verification
    // ------------------------------------------------------------------------
    totalTests++;
    console.log(`\n${colors.yellow}[TEST 6] Story 2: Long-Polling Support (GET /api/notifications/:userId/long-poll)${colors.reset}`);
    const longPollRes = await makeRequest(`${BASE_URL}/api/notifications/${TEST_USER}/long-poll?timeout=2000`);

    if (longPollRes.status === 200 && longPollRes.body.architecture === "LONG_POLLING") {
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Long-polling responded with architecture = LONG_POLLING`);
      console.log(`  ${colors.green}✔ PASS:${colors.reset} Long-poll delivered alerts immediately or on timeout cleanly`);
      passedCount++;
    } else {
      console.log(`  ${colors.red}✘ FAIL:${colors.reset} Long polling failed: ${longPollRes.status}`);
    }

    // ------------------------------------------------------------------------
    // Summary Report
    // ------------------------------------------------------------------------
    console.log(`\n${colors.bright}${colors.blue}========================================================================${colors.reset}`);
    console.log(`${colors.bright} POLLING NOTIFICATION TEST RESULTS: ${passedCount} / ${totalTests} PASSED${colors.reset}`);
    if (passedCount === totalTests) {
      console.log(`${colors.bright}${colors.green} ✔ ALL POLLING NOTIFICATION TESTS PASSED SUCCESSFULLY!${colors.reset}`);
    } else {
      console.log(`${colors.bright}${colors.red} ✘ SOME TESTS FAILED.${colors.reset}`);
    }
    console.log(`${colors.bright}${colors.blue}========================================================================${colors.reset}\n`);

  } catch (error) {
    console.error(`${colors.red}Test error:${colors.reset}`, error);
  } finally {
    if (testServer) {
      testServer.close();
    }
  }

  return { passedCount, totalTests };
}

if (require.main === module) {
  runPollingNotificationTests().then(({ passedCount, totalTests }) => {
    process.exit(passedCount === totalTests ? 0 : 1);
  });
}

module.exports = { runPollingNotificationTests };
