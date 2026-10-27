# 🏛️ Architecture Design Document: Workout Session Flow
**Project:** Fitness Tracking & Personalized Recommendation System (SADP-FTS)  
**Sprint:** 2 (Story 3)  
**Author:** Member 4 - Suhas (Architecture & Testing Specialist)  
**Pattern:** Polling Architecture — Request-Driven Session Management  

---

## 1. Executive Summary & User Story

> **User Story (Story 3):**  
> *"User wants to start, stop & complete a workout session while viewing my live heart rate & calories burnt. (Recommendations)"*

This document defines the **end-to-end architectural flow, polling-based state management, and recommendation rules** for workout sessions in the **Polling Architecture**.

---

## 2. Polling vs Event-Driven — Key Difference

| Aspect | Event-Driven (`Story1_Event_Backend`) | Polling (`Story1_Polling_Backend`) |
|---|---|---|
| **State Change Detection** | Server pushes `WORKOUT_STARTED`, `WORKOUT_COMPLETED` via EventBus | Client polls `GET /api/workout/status/:userId` every `POLL_INTERVAL_MS` |
| **Recommendations** | Generated reactively by a consumer listening to `WORKOUT_COMPLETED` event | Computed synchronously inside `POST /api/workout/stop` and returned directly in response |
| **Notifications** | Pushed instantly via SSE stream | Client polls `GET /api/notifications/:userId/poll` to fetch new alerts |

---

## 3. Polling Workout Session Flow

```
 [Client / UI]                          [Polling Backend Server]           [MongoDB]
       │                                          │                             │
       │  POST /api/workout/start                 │                             │
       ├─────────────────────────────────────────>│                             │
       │                                          │  Insert Workout Document    │
       │                                          ├────────────────────────────>│
       │<─────────────────────────────────────────┤                             │
       │   201 { status: "in-progress" }          │                             │
       │                                          │                             │
       │ ═══ ACTIVE SESSION: CLIENT POLLS ════    │                             │
       │  GET /api/workout/status/:userId          │                             │
       ├──────(every 5 seconds)──────────────────>│                             │
       │<─────────────────────────────────────────┤                             │
       │   { active: true, calories, heartRate }  │                             │
       │                                          │                             │
       │  POST /api/workout/stop                  │                             │
       ├─────────────────────────────────────────>│                             │
       │                                          │  Compute: duration,         │
       │                                          │  avgHR, calories            │
       │                                          │  Generate recommendations   │
       │                                          │  Update Workout → completed │
       │                                          │  Create Notification        │
       │                                          ├────────────────────────────>│
       │<─────────────────────────────────────────┤                             │
       │   200 { summary, recommendations }       │                             │
       │                                          │                             │
       │ ═══ CLIENT POLLS FOR NOTIFICATION ═══   │                             │
       │  GET /api/notifications/:userId/poll     │                             │
       ├─────────────────────────────────────────>│                             │
       │<─────────────────────────────────────────┤                             │
       │   { hasNew: true, notifications: [...] } │                             │
```

---

## 4. Session State Machine

```
    ┌───────────────┐
    │     IDLE      │
    └───────┬───────┘
            │  POST /api/workout/start
            ▼
    ┌───────────────┐
    │  IN-PROGRESS  │ ◄── Client polls GET /api/workout/status every 5s
    └───────┬───────┘
            │  POST /api/workout/stop
            ▼
    ┌───────────────┐
    │   COMPLETED   │ ──> Recommendations returned in stop response
    └───────┬───────┘
            │
            ▼
    GET /api/notifications/:userId/poll
    returns "🏋️ Workout Completed!" alert
```

### State Transition Rules:
1. **No concurrent workouts:** If status `in-progress` already exists → `HTTP 400` returned.
2. **Cannot stop without starting:** If no `in-progress` session → `HTTP 400` returned.
3. **Recommendations computed synchronously:** No consumer needed — all logic runs inside `stopWorkout` handler.

---

## 5. Recommendation Decision Matrix

| Condition | Threshold | Recommendation |
|---|---|---|
| High Cardiovascular Intensity | `avgHeartRate >= 150 bpm` | *"High cardiovascular strain. Hydrate with electrolytes and take a 24h recovery rest."* |
| Moderate Fat-Burn Zone | `120 <= avgHeartRate < 150 bpm` | *"Optimal aerobic fat-burn zone! Great cardiovascular endurance session."* |
| High Caloric Expenditure | `caloriesBurned >= 400 kcal` | *"Outstanding calorie burn! Replenish with carbohydrates and lean protein."* |
| Short Session | `durationMinutes < 15` | *"Quick session completed. Try 30+ minutes next time for sustained endurance."* |

---

## 6. API Endpoints (Defined by Suhas, Implemented by Sourabha)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/workout/start` | Start a new workout session |
| `POST` | `/api/workout/metrics/:workoutId` | Ingest live HR and calorie readings |
| `POST` | `/api/workout/stop` | Stop, compute summary, generate recommendations |
| `GET` | `/api/workout/status/:userId` | Poll current workout state (active/inactive) |
| `GET` | `/api/workout/history/:userId` | Get completed workout history |
