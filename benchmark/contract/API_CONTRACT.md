# API Contract — Event-Driven Backend (source of truth for all three variants)

> Source files: `Event_Driven/Event_Backend/src/routes/`, `src/controllers/`, `src/utils/goalProgress.js`
> Frontend calls extracted from: `Frontend_Shared/app.js` (served by every variant)
> Base URL (dev): `http://localhost:5001/api` (modular: `5011`, micro gateway: `5021`)
> Refreshed 2026-11-21 against the period-aware goals commit. Behaviour source of truth is the
> Event-Driven code; this document describes what that code actually returns today.

---

## 1. General rules

- All request and response bodies are JSON (`Content-Type: application/json`) except the SSE stream and
  error responses from Express itself (see §5).
- Every endpoint is also mounted **without** the `/api` prefix (e.g. `POST /goals` works like
  `POST /api/goals`). `/api/...` is the canonical form; tests and the frontend use it.
- CORS is open (no origin restrictions).
- `GET /health` (no `/api`) → `200 {"status":"ok","timestamp":"<ISO datetime>"}`.
- `GET /metrics` (no `/api`) → Prometheus text format.
- `GET /api/meta` → **not implemented yet on Event-Driven (404 today)**. The agreed shape, which
  every variant must implement, is:
  ```json
  { "name": "PulseFlow", "version": "<semver>", "style": "event-driven", "variant": "event" }
  ```
  (`style`: `event-driven` | `modular-monolith` | `microservices`; `variant`: `event` | `modular` | `micro`).

---

## 2. Endpoint table

| # | Method | Path | Request body / query | Success response fields | Status codes |
|---|--------|------|----------------------|-------------------------|--------------|
| 1 | POST | `/api/telemetry/steps` | `userId`* , `steps`* , `calories` (default 0), `distance` (default 0) | `success`, `message`, `timestamp` | 200 · 400 · 500 |
| 2 | POST | `/api/goals` | `userId`* , `type`* (one of `steps`,`calories`,`distance`) , `target`* (number > 0), `period` (`daily`\|`weekly`, default `daily`), `startDate` (ISO date, optional) | `success`, `goal` (**raw goal document**, §3.1) | 200 · 400 · 409 · 500 |
| 3 | GET | `/api/goals/:userId` | — | `success`, `goals[]` (**goal views**, §3.2), `count` | 200 · 500 |
| 4 | GET | `/api/goals/:userId/active` | — | `success`, `goals[]` (views with `status:"active"` only), `count` | 200 · 500 |
| 5 | PUT | `/api/goals/:goalId` | any of `target`, `period`, `type`, `startDate`, `endDate`, `active` | `success`, `goal` (**raw goal document**) | 200 · 400 · 404 · 500 |
| 6 | POST | `/api/goals/:goalId/complete` | — | `success`, `goal` (**raw goal document**) | 200 · 404 · 500 |
| 7 | POST | `/api/notifications` | `userId`* , `type`* (`GOAL_REACHED`\|`WORKOUT_COMPLETED`\|`INACTIVITY`) , `title`* , `message`* | `success`, `notification` (raw document) | 201 · 500 |
| 8 | GET | `/api/notifications/:userId` | — | `success`, `notifications[]` (raw documents, newest first) | 200 · 500 |
| 9 | GET | `/api/notifications/:userId/stream` | — | SSE stream, see §4 | 200 (`text/event-stream`, stays open) |
| 10 | PUT | `/api/notifications/:id/read` | — | `success`, `notification` | 200 · 404 · 500 |
| 11 | GET | `/api/notifications/:userId/unread-count` | — | `success`, `unreadCount` | 200 · 500 |
| 12 | POST | `/api/workout/start` | `userId`* , `workoutType` (default `other`; enum below) | `success`, `status`, `workout` (**raw workout document**) | 201 · 400 · 500 |
| 13 | POST | `/api/workout/stop` | `userId`* , `workoutId` (optional) | `success`, `workoutSummary` (§3.3), `recommendations[]`, `inAppNotification` | 200 · 400 · 500 |
| 14 | POST | `/api/workout/pause` | `userId`* , `workoutId` (optional) | `success`, `status`, `workout` (raw document) | 200 · 400 · 500 |
| 15 | POST | `/api/workout/resume` | `userId`* , `workoutId` (optional) | `success`, `status`, `workout` (raw document) | 200 · 400 · 500 |
| 16 | POST | `/api/workout/live-metrics` | `userId`* , `workoutId` (optional), `heartRate`, `calories` (default 0), `steps` (default 0), `distance` (default 0) | `success`, `live` {`workoutId`,`status`,`heartRate`,`maxHeartRate`,`caloriesBurned`,`steps`,`distanceKm`} | 200 · 400 · 404 · 500 |
| 17 | GET | `/api/workout/active/:userId` | — | `success`, `workout` (summary §3.3 or `null`) | 200 · 500 |
| 18 | GET | `/api/workout/history/:userId` | query `limit` (default 20, max 100) | `success`, `count`, `workouts[]` (summaries) | 200 · 500 |
| 19 | GET | `/api/workout/:workoutId` | — | `success`, `workout` (summary) | 200 · 404 · 500 |
| 20 | GET | `/api/dashboard/:userId` | — | `source` (`"cache"`\|`"database"`), `data` (§3.4) | 200 · 500 |

\* required. `workoutType` enum: `running`, `cycling`, `walking`, `strength`, `hiit`, `yoga`, `swimming`, `other`.

**Not an endpoint:** there is **no bulk "mark all read" API**. Clients mark all read by listing
notifications (#8) and calling #10 for each unread one until `unread-count` is 0. The contract test
does exactly this.

---

## 3. Object shapes

### 3.1 Raw goal document (returned by #2, #5, #6)
The Mongoose document as stored (has `_id`, no `goalId`, no computed fields):

```json
{
  "_id": "<ObjectId>",
  "userId": "string",
  "type": "steps|calories|distance",
  "target": 10000,
  "current": 0,
  "period": "daily|weekly",
  "startDate": "ISO date",
  "endDate": null,
  "achieved": false,
  "achievedPeriodKey": null,
  "lastAchievedAt": "ISO date (only after first achievement)",
  "active": true,
  "createdAt": "ISO datetime",
  "updatedAt": "ISO datetime",
  "__v": 0
}
```

### 3.2 Goal view (returned by #3, #4 and inside dashboard `data.goals`)
Computed read projection used for display:

```json
{
  "goalId": "<ObjectId as string>",
  "type": "steps|calories|distance",
  "period": "daily|weekly",
  "target": 10000,
  "current": 3200,
  "percentage": 32,
  "remaining": 6800,
  "achieved": false,
  "status": "active|completed",
  "active": true,
  "unit": "steps|calories|km",
  "startDate": "ISO date",
  "endDate": null
}
```

`status` is `"completed"` when the goal is reached **inside the current period** (daily: today;
weekly: current Mon–Sun week), otherwise `"active"`. `current` is the real activity sum for the
goal's type and period (live from `FitnessData`, not the stored `current` field). Views are sorted
active-first.

### 3.3 Workout summary (returned by #13, #17, #18, #19 and dashboard `recentWorkouts`)
```json
{
  "workoutId": "<ObjectId as string>",
  "userId": "string",
  "workoutType": "running|cycling|walking|strength|hiit|yoga|swimming|other",
  "status": "in-progress|paused|completed",
  "startTime": "ISO datetime",
  "endTime": "ISO datetime|null",
  "durationMinutes": 42.5,
  "caloriesBurned": 310,
  "steps": 4800,
  "distanceKm": 3.6,
  "avgHeartRate": 142,
  "maxHeartRate": 168,
  "recommendations": ["string"]
}
```

Raw workout documents (#12, #14, #15) additionally contain `pausedAt`, `pausedMs`,
`heartRateTotal`, `heartRateCount`, `heartRateReadings[]`, `createdAt`, `updatedAt`, `__v`.
Dashboard `recentWorkouts` items are a subset: `workoutId`, `workoutType`, `durationMinutes`,
`caloriesBurned`, `avgHeartRate`, `endTime`, `recommendations`.

### 3.4 Dashboard `data` (returned by #20)
```json
{
  "userId": "string",
  "latestActivity": { "date", "steps", "distance", "calories", "veryActiveMinutes", "sedentaryMinutes" } | null,
  "weeklyAverages": { "steps", "calories", "distance", "activeMinutes", "sedentaryMinutes" },
  "heartRate": { "avg", "max", "min" },
  "sleep": { "avgMinutesAsleep", "avgTimeInBed", "latestMinutesAsleep" },
  "goals": [ /* goal views, §3.2 */ ],
  "recentWorkouts": [ /* subset, §3.3 */ ]
}
```
Response is `{ "source": "database", "data": ... }` on a cache miss and `{ "source": "cache",
"data": ... }` from Redis (`CACHE_TTL=300` seconds). The dashboard cache is invalidated when a
goal is created, updated or completed.

### 3.5 Notification document (returned by #7, #8, #10, SSE, and `inAppNotification` in #13)
```json
{
  "_id": "<ObjectId>",
  "userId": "string",
  "type": "GOAL_REACHED|WORKOUT_COMPLETED|INACTIVITY",
  "title": "string",
  "message": "string",
  "read": false,
  "goalId": "<string, only for GOAL_REACHED>",
  "periodKey": "<string, only for GOAL_REACHED: YYYY-MM-DD or YYYY-Www>",
  "createdAt": "ISO datetime",
  "updatedAt": "ISO datetime",
  "__v": 0
}
```

---

## 4. SSE stream (#9)

- Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`, `Access-Control-Allow-Origin: *`.
- Event name: **`notification`**. Data: the notification document as JSON (§3.5), not wrapped:
  ```
  event: notification
  data: {"_id":"...","userId":"...","type":"GOAL_REACHED", ...}

  ```
- Heartbeat: comment line `: heartbeat` every 30 seconds.
- Delivery is in-process (Event-Driven bus): the browser only receives notifications for events
  published by the same server process it connected to.

---

## 5. Error shapes (exact)

| Situation | Status | Body |
|---|---|---|
| Goal validation failed (#2) | 400 | `{"success":false,"message":"<joined sentences>","errors":["<sentence>", ...]}` |
| Goal update validation (#5) | 400 | `{"success":false,"message":"<single sentence>"}` (no `errors` array) |
| Duplicate active goal (#2) | 409 | `{"success":false,"code":"DUPLICATE_GOAL","message":"You already have an active <period> <type> goal. Update that goal instead of creating a duplicate.","goal":<raw goal document>}` |
| Missing `userId`/`steps` (#1) | 400 | `{"success":false,"message":"userId and steps are required"}` |
| Unknown goal / notification / workout id (#5,#6,#10,#19) | 404 | `{"success":false,"message":"Goal not found"}` / `"Notification not found"` / `"Workout not found"` |
| Workout conflicts (#12,#13,#14,#15) | 400 | `{"success":false,"message":"Workout session already active"}` (plus `workoutId`), `"No active workout found"`, `"No paused workout found"` |
| Live metrics without active workout (#16) | 404 | `{"success":false,"message":"No active workout found"}` |
| Notification body fails schema (#7) | **500** | `{"success":false,"message":"Notification validation failed: ..."}` (the app does not validate #7 up front; bad input surfaces as a Mongoose error) |
| Dashboard failure (#20) | 500 | `{"error":"Failed to fetch dashboard summary"}` (different envelope — keep it, it is the current behaviour) |
| Any other controller exception | 500 | `{"success":false,"message":"<error.message>"}` |
| **Unknown route** (e.g. `GET /api/no-such-route`) | 404 | **HTML**, not JSON: `<pre>Cannot GET /api/no-such-route</pre>` (Express default) |
| **Malformed JSON body** | 400 | **HTML**, not JSON: `<pre>Bad Request</pre>` (body-parser default) |

There is no JSON catch-all 404 handler today. The contract test asserts the HTML bodies above.

---

## 6. Goals: period-aware behaviour (source: `goalController.js`, `goalProgress.js`)

- Types accepted by the API: `steps`, `calories`, `distance`. (`workouts` exists in the Mongo
  schema enum but the API rejects it with 400 — do not use it.)
- Periods: `daily` (local calendar day) and `weekly` (local Mon–Sun). Both can exist for the same
  type at the same time; duplicates are blocked per `(userId, type, period)` among non-deactivated
  goals (regardless of `startDate`).
- `current` in a view = sum of `FitnessData` for that type inside the period window
  (`totalSteps` / `calories` / `totalDistance`).
- Creating a goal immediately evaluates past activity of the same period: a user who already walked
  12 000 steps and then creates a 10 000-step daily goal gets `status:"completed"` right away.
- **GOAL_REACHED** fires at most **once per goal per period** (atomic claim on `achievedPeriodKey`).
  It creates one notification (`type:"GOAL_REACHED"`, `goalId`, `periodKey`) and pushes it to SSE.
  Further activity in the same period does not re-fire; next day / next week it can fire again.
- `PUT /api/goals/:goalId`: changing `target`, `type` or `period` resets `achieved`,
  `achievedPeriodKey` and stored `current` (the definition changed, so progress restarts).
  `active:false` deactivates the goal (it disappears from #3, #4 and the dashboard).
- `POST /api/goals/:goalId/complete` manually marks achieved for the current period and sets
  stored `current` to at least `target`.
- Ingest (#1) **does not** synchronously evaluate goals on Event-Driven: the request is
  acknowledged after `STEP_UPDATED` is published; a consumer evaluates goals afterwards
  (best-effort, asynchronous). Tests allow a short wait after ingest before asserting.

---

## 7. Frontend API calls (`Frontend_Shared/app.js`)

| Frontend function | Method | URL | Notes |
|---|---|---|---|
| `loadArchitectureBadge()` | GET | `${API_BASE}/meta` | Header badge; hides itself on failure |
| `loadNotifications()` | GET | `${API_BASE}/notifications/${userId}` | On load, user change, popover open |
| `loadDashboard()` | GET | `${API_BASE}/dashboard/${userId}` | On load, user change, after goal save, after workout stop |
| goal form submit | POST | `${API_BASE}/goals` | Body `{userId, type, period, target, startDate}` |
| `connectNotificationStream()` | GET (SSE) | `${API_BASE}/notifications/${userId}/stream` | `EventSource`; reconnects automatically |
| `workoutRequest()` start | POST | `${API_BASE}/workout/start` | `{userId, workoutType}` |
| pause / resume | POST | `${API_BASE}/workout/pause` \| `/resume` | `{userId, workoutId}` |
| `stopWorkoutSession()` | POST | `${API_BASE}/workout/stop` | `{userId, workoutId}` |
| `pushLiveMetrics()` | POST | `${API_BASE}/workout/live-metrics` | Every 3 s while active |
| `loadWorkoutSession()` | GET | `${API_BASE}/workout/active/${userId}` | Then history fallback `${API_BASE}/workout/history/${userId}?limit=1` |

`API_BASE` comes from `Frontend_Shared/config.js` (`window.API_BASE`, default `/api`).
The frontend does not call #1, #7 (POST), #10, #11, #5, #6 or #19 directly; those are used by
tests, benchmarks and internal flows.

---

## 8. What the contract test (`benchmark/contract/contract.test.js`) checks

Order: create goal → send steps → receive `GOAL_REACHED` on SSE within 5 s → list notifications →
mark one read → mark all read (loop of #10) → dashboard totals match the steps sent → workout
start / live metrics / stop (stop persists and dashboard totals change) → recommendations (in the
stop response) → validation 400 and unknown-route 404 with the exact shapes in §5 → `/api/meta`
(clean skip until Event-Driven implements it) → `/health`.
