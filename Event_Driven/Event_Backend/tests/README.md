# 🧪 Testing Suite — Member 4 (Suhas) Deliverables

This directory contains the automated test suites implemented by **Member 4 (Suhas)** covering the testing tasks for **Sprint 1 (Story 1 & Story 2)**.

---

## 📋 Task Matrix

| Story | Task Assigned to Suhas | Test File | Description |
|---|---|---|---|
| **Sprint 1 - Story 1** | **Testing: Test dashboard under slow network conditions** | `tests/testSlowNetwork.js` | Simulates slow network latency (3G @ 500ms, 2G @ 1500ms), verifies CQRS cache performance (Cache Hit vs Cache Miss), validates payload integrity, and tests client timeout limits. |
| **Sprint 1 - Story 2** | **Integration test: Sensor - event Bus - notification** | `tests/testIntegrationSensorEventNotification.js` | Full integration pipeline verification from step sensor telemetry ingestion (`/api/telemetry/steps`), through EventBus (`STEP_UPDATED` -> `GOAL_REACHED`), to in-app notification persistence, real-time SSE push, and mark-as-read state transition. |

---

## 🚀 How to Run the Tests

### Option 1: Run All Suhas Tests (Recommended)
```bash
npm test
```
*or directly with Node:*
```bash
node tests/runAllTests.js
```

### Option 2: Run Story 1 Slow Network Tests Only
```bash
npm run test:slow-network
```
*or:*
```bash
node tests/testSlowNetwork.js
```

### Option 3: Run Story 2 Integration Tests Only
```bash
npm run test:integration
```
*or:*
```bash
node tests/testIntegrationSensorEventNotification.js
```

---

## 📊 Test Verification Details

### 1. Story 1: Slow Network Dashboard Tests (`testSlowNetwork.js`)
- **Test 1: Baseline Test** — Measures response latency under normal/local network conditions.
- **Test 2: Slow 3G Network (500ms Latency) - Cache Miss** — Verifies DB query aggregates fitness data and responds with HTTP 200 OK despite network delay.
- **Test 3: Slow 3G Network - Cache Hit Performance** — Verifies Redis/in-memory cache retrieval serves request without querying MongoDB.
- **Test 4: Extreme 2G Network (1500ms Latency) - Payload Integrity** — Verifies complete JSON schema (`userId`, `latestActivity`, `weeklyAverages`, `heartRate`, `sleep`, `goals`) without truncation or packet loss.
- **Test 5: Client Timeout Resilience** — Verifies request completes within client timeout thresholds.

### 2. Story 2: Sensor -> Event Bus -> Notification Integration (`testIntegrationSensorEventNotification.js`)
- **Step 1: Setup Goal** — Sets a step goal (`POST /api/goals`) with target = 5,000 steps.
- **Step 2: Sensor Ingestion** — Telemetry sensor posts 6,000 steps (`POST /api/telemetry/steps`).
- **Step 3: Event Bus Verification** — Verifies `STEP_UPDATED` is caught by `goalConsumer`, evaluates `6000 >= 5000`, emits `GOAL_REACHED`, and dispatches `NOTIFICATION_CREATED`.
- **Step 4: In-App Notification Persistence** — Verifies MongoDB document created, unread count = 1, and message contents formatted.
- **Step 5: Live SSE Push Stream** — Verifies real-time push delivery via Server-Sent Events (`/api/notifications/:userId/stream`).
- **Step 6: Mark as Read Transition** — Updates notification status via `PUT /api/notifications/:id/read` and verifies unread badge counter drops back to 0.
