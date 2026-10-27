# 🔔 Notification & Workout Database — Member 3 (Siddharth)

This folder contains the complete implementation and test suite for **Member 3 (Siddharth's)** tasks under the **Polling Architecture**:

1. **Sprint 1 - Story 1:** *"Notification: works on notification API"*
2. **Sprint 1 - Story 2:** *"Implement in app notification"* (via Polling & Long-Polling)
3. **Sprint 2 - Story 3:** *"Create workout Database"* (Workout schema, indexing, metrics, recommendations & session seeding)

---

## 🏛️ Architectural Comparison: Polling vs Event-Driven

| Dimension | Event-Driven Architecture (`Story1_Event_Backend`) | Polling Architecture (`Story1_Polling_Backend`) |
|---|---|---|
| **Notification Trigger** | Telemetry ingestion pushes `STEP_UPDATED` -> GoalConsumer emits `GOAL_REACHED` -> Notification created immediately. | Client periodically requests `/poll` (or background worker checks DB on interval `POLL_INTERVAL_MS = 5000ms`). |
| **Client Delivery** | Real-time push via **Server-Sent Events (SSE)** (`GET /api/notifications/:userId/stream`) or WebSockets. | Client polls `/api/notifications/:userId/poll` every 5 seconds (Short Polling) or holds request via `/api/notifications/:userId/long-poll` (Long Polling). |
| **Coupling** | Completely decoupled via `eventBus.js`. | Request-driven pull model against MongoDB / memory store. |
| **Network Traffic** | Only transmits when an actual event occurs. | Sends periodic requests at fixed intervals regardless of changes. |

---

## 📋 Implemented Endpoints

### 1. Week 1: Notification CRUD APIs
* `POST /api/notifications` — Create notification
* `GET /api/notifications/:userId` — Retrieve all notifications for user (sorted newest first)
* `GET /api/notifications/:userId/unread-count` — Unread count badge counter
* `PUT /api/notifications/:id/read` — Mark notification as read

### 2. Week 2: In-App Notification (Polling Mechanisms)
* `GET /api/notifications/:userId/poll?since=<timestamp>` — **Short Polling endpoint**:
  - Automatically evaluates active step goals on each poll.
  - Generates `"🎉 Daily Step Goal Achieved!"` alert when target is exceeded.
  - Returns `{ architecture: "POLLING", pollIntervalMs: 5000, hasNew: Boolean, notifications: [] }`.
* `GET /api/notifications/:userId/long-poll?timeout=15000` — **Long Polling endpoint**:
  - Holds HTTP connection open until a new notification is generated or timeout occurs.

---

## 🚀 How to Run the Tests

From the `Story1_Polling_Backend` folder:

```bash
npm test
```
*or directly with Node:*
```bash
node tests/testPollingNotification.js
```
