# API Contract — Event-Driven Backend

> Source files: `Event_Driven/Event_Backend/src/routes/` and `src/controllers/`
> Frontend calls extracted from: `Event_Driven/Event_Frontend/app.js`
> Base URL (dev): `http://localhost:5001/api`

---

## Endpoint Table

| # | Method | Path | Request Body Fields | Response Body Fields | Status Codes |
|---|--------|------|---------------------|----------------------|--------------|
| 1 | POST | `/api/telemetry/steps` | `userId` *(required)*, `steps` *(required)*, `calories` *(default 0)*, `distance` *(default 0)* | `success`, `message`, `timestamp` | 200 OK · 400 Bad Request · 500 Internal Server Error |
| 2 | POST | `/api/goals` | `userId` *(required)*, `type` *(required; one of: steps, calories, distance, workouts)*, `target` *(required, positive number)*, `period` *(daily\|weekly; default daily)*, `startDate` *(optional ISO date)* | `success`, `goal` | 200 OK · 400 Bad Request · 409 Conflict (DUPLICATE_GOAL) · 500 Internal Server Error |
| 3 | GET | `/api/goals/:userId` | — | `success`, `goals[]`, `count` | 200 OK · 400 Bad Request · 500 Internal Server Error |
| 4 | GET | `/api/goals/:userId/active` | — | `success`, `goals[]` *(status=active only)*, `count` | 200 OK · 400 Bad Request · 500 Internal Server Error |
| 5 | PUT | `/api/goals/:goalId` | `target` *(opt)*, `period` *(opt)*, `type` *(opt)*, `startDate` *(opt)*, `endDate` *(opt)*, `active` *(opt, boolean)* | `success`, `goal` | 200 OK · 400 Bad Request · 404 Not Found · 500 Internal Server Error |
| 6 | POST | `/api/goals/:goalId/complete` | — | `success`, `goal` | 200 OK · 404 Not Found · 500 Internal Server Error |
| 7 | POST | `/api/notifications` | `userId`, `type`, `title`, `message` | `success`, `notification` | 201 Created · 500 Internal Server Error |
| 8 | GET | `/api/notifications/:userId` | — | `success`, `notifications[]` | 200 OK · 500 Internal Server Error |
| 9 | GET | `/api/notifications/:userId/stream` | — | SSE stream; events: `notification` (data: notification object); heartbeat comment every 30 s | 200 OK (text/event-stream) · stays open |
| 10 | PUT | `/api/notifications/:id/read` | — | `success`, `notification` | 200 OK · 404 Not Found · 500 Internal Server Error |
| 11 | GET | `/api/notifications/:userId/unread-count` | — | `success`, `unreadCount` | 200 OK · 500 Internal Server Error |
| 12 | POST | `/api/workout/start` | `userId` *(required)*, `workoutType` *(default "other"; options: running, cycling, walking, strength, hiit, yoga, swimming)* | `success`, `status`, `workout` | 201 Created · 400 Bad Request · 500 Internal Server Error |
| 13 | POST | `/api/workout/stop` | `userId` *(required)*, `workoutId` *(opt)* | `success`, `workoutSummary` {workoutId, userId, workoutType, status, startTime, endTime, durationMinutes, caloriesBurned, steps, distanceKm, avgHeartRate, maxHeartRate, recommendations}, `recommendations[]`, `inAppNotification` | 200 OK · 400 Bad Request · 500 Internal Server Error |
| 14 | POST | `/api/workout/pause` | `userId`, `workoutId` *(opt)* | `success`, `status`, `workout` | 200 OK · 400 Bad Request · 500 Internal Server Error |
| 15 | POST | `/api/workout/resume` | `userId`, `workoutId` *(opt)* | `success`, `status`, `workout` | 200 OK · 400 Bad Request · 500 Internal Server Error |
| 16 | POST | `/api/workout/live-metrics` | `userId` *(required)*, `workoutId` *(opt)*, `heartRate`, `calories` *(default 0)*, `steps` *(default 0)*, `distance` *(default 0)* | `success`, `live` {workoutId, status, heartRate, maxHeartRate, caloriesBurned, steps, distanceKm} | 200 OK · 400 Bad Request · 404 Not Found · 500 Internal Server Error |
| 17 | GET | `/api/workout/active/:userId` | — | `success`, `workout` *(summary object or null)* | 200 OK · 500 Internal Server Error |
| 18 | GET | `/api/workout/history/:userId` | Query: `limit` *(default 20, max 100)* | `success`, `count`, `workouts[]` *(summary objects)* | 200 OK · 500 Internal Server Error |
| 19 | GET | `/api/workout/:workoutId` | — | `success`, `workout` *(summary object)* | 200 OK · 404 Not Found · 500 Internal Server Error |
| 20 | GET | `/api/dashboard/:userId` | — | `source` ("cache"\|"database"), `data` {userId, latestActivity, weeklyAverages, heartRate, sleep, goals[], recentWorkouts[]} | 200 OK · 500 Internal Server Error |

---

## Response Shape Details

### Goal object (returned by #2, #3, #4, #5, #6)
```json
{
  "goalId": "<ObjectId>",
  "userId": "string",
  "type": "steps|calories|distance|workouts",
  "period": "daily|weekly",
  "target": 10000,
  "current": 3200,
  "percentage": 32,
  "remaining": 6800,
  "achieved": false,
  "active": true,
  "status": "active|completed",
  "startDate": "ISO date"
}
```

### Dashboard `data` object (returned by #20)
```json
{
  "userId": "string",
  "latestActivity": { "date", "steps", "distance", "calories", "veryActiveMinutes", "sedentaryMinutes" },
  "weeklyAverages": { "steps", "calories", "distance", "activeMinutes", "sedentaryMinutes" },
  "heartRate": { "avg", "max", "min" },
  "sleep": { "avgMinutesAsleep", "avgTimeInBed", "latestMinutesAsleep" },
  "goals": [ /* goal view objects */ ],
  "recentWorkouts": [ { "workoutId", "workoutType", "durationMinutes", "caloriesBurned", "avgHeartRate", "endTime", "recommendations" } ]
}
```

### Workout summary object (returned by #12–#19)
```json
{
  "workoutId": "<ObjectId>",
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

---

## Frontend API Calls (Event_Driven/Event_Frontend/app.js)

| Frontend Function | Method | URL Pattern | Notes |
|-------------------|--------|-------------|-------|
| `loadDashboard()` | GET | `/api/dashboard/${userId}` | Called on load, user-id change, after goal save, after workout stop |
| `loadNotifications()` | GET | `/api/notifications/${userId}` | Called on load, user-id change, notification popover open, after workout stop |
| `connectNotificationStream()` | GET (SSE) | `/api/notifications/${userId}/stream` | `EventSource`; called on load and user-id change |
| `goal-form submit` | POST | `/api/goals` | Body: `{userId, type, period, target, startDate}` |
| `startWorkoutSession()` | POST | `/api/workout/start` | Body: `{userId, workoutType}` |
| `togglePauseWorkout()` (pause path) | POST | `/api/workout/pause` | Body: `{userId, workoutId}` |
| `togglePauseWorkout()` (resume path) | POST | `/api/workout/resume` | Body: `{userId, workoutId}` |
| `stopWorkoutSession()` | POST | `/api/workout/stop` | Body: `{userId, workoutId}` |
| `pushLiveMetrics()` | POST | `/api/workout/live-metrics` | Body: `{userId, workoutId, heartRate, calories, steps}`; called every 3 s during active session |
| `loadWorkoutSession()` active check | GET | `/api/workout/active/${userId}` | Called on load and user-id change |
| `loadWorkoutSession()` history check | GET | `/api/workout/history/${userId}?limit=1` | Called when no active workout found |

> **Note:** The frontend does NOT call `/api/telemetry/steps`, `/api/notifications` (POST/PUT), `/api/goals/:goalId` (PUT/complete), or `/api/workout/:workoutId` directly. Those are either internal server-to-server calls or intended for external test tooling/benchmarks.

---

## Error Envelope

All error responses follow:
```json
{ "success": false, "message": "Human-readable description" }
```
Conflict (409) also includes `"code": "DUPLICATE_GOAL"` and `"goal": { /* existing goal */ }`.
