# 🏛️ Architecture Design Document: Workout Session Flow
**Project:** Fitness Tracking & Personalized Recommendation System (SADP-FTS)  
**Sprint:** 2 (Story 3)  
**Author:** Member 4 - Suhas (Architecture & Testing Specialist)  
**Pattern:** Event-Driven Architecture (EDA) & Reactive State Machine  

---

## 1. Executive Summary & User Story

> **User Story (Story 3):**  
> *"User wants to start, stop & complete a workout session while viewing my live heart rate & calories burnt. (Recommendations)"*

This document defines the **end-to-end architectural flow, reactive event choreography, state machine transitions, and recommendation rules** for workout sessions.

---

## 2. Event-Driven Sequence & Choreography

```
 [Client / Mobile App]         [Workout Service]          [EventBus]           [Recommendation Engine]    [Notification Service]
           │                           │                       │                         │                          │
           │  POST /api/workout/start  │                       │                         │                          │
           ├──────────────────────────>│                       │                         │                          │
           │                           │  publish('WORKOUT_STARTED')                     │                          │
           │                           ├──────────────────────>│                         │                          │
           │<──────────────────────────┤                       │                         │                          │
           │   201 { status: 'in-progress' }                   │                         │                          │
           │                           │                       │                         │                          │
           │ === ACTIVE SESSION ===    │                       │                         │                          │
           │  Live Sensor Telemetry    │                       │                         │                          │
           │  (HR, Calories, Steps)    │                       │                         │                          │
           ├──────────────────────────>│                       │                         │                          │
           │                           │                       │                         │                          │
           │  POST /api/workout/stop   │                       │                         │                          │
           ├──────────────────────────>│                       │                         │                          │
           │                           │  publish('WORKOUT_COMPLETED')                   │                          │
           │                           ├──────────────────────>│                         │                          │
           │                           │                       │                         │                          │
           │                           │                       ├────────────────────────>│                          │
           │                           │                       │  (Consumes workout)     │                          │
           │                           │                       │  (Evaluates metrics)    │                          │
           │                           │                       │                         │                          │
           │                           │                       │<────────────────────────┤                          │
           │                           │                       │ publish('RECOMMENDATION_GENERATED')                │
           │                           │                       │                         │                          │
           │                           │                       ├───────────────────────────────────────────────────>│
           │                           │                       │  (Consumes recommendation)                         │
           │                           │                       │  (Creates In-App Alert in MongoDB)                 │
           │                           │                       │  (Pushes alert via SSE stream)                     │
           │<──────────────────────────┴───────────────────────┴────────────────────────────────────────────────────┤
           │   200 OK { workoutSummary, recommendations, inAppNotification }                                        │
```

---

## 3. Session State Machine

A workout session strictly obeys the following state transitions:

```
    ┌───────────────┐
    │     IDLE      │
    └───────┬───────┘
            │  Event: START_WORKOUT (POST /api/workout/start)
            ▼
    ┌───────────────┐
    │  IN-PROGRESS  │ ◄─── Live Telemetry Updates (HR, Calories)
    └───────┬───────┘
            │  Event: STOP_WORKOUT (POST /api/workout/stop)
            ▼
    ┌───────────────┐
    │   COMPLETED   │ ───► Triggers Recommendation & In-App Notification
    └───────────────┘
```

### State Transition Validation Rules:
1. **Concurrency Protection:** A user with an active workout session in status `in-progress` **cannot** initiate another workout (`HTTP 400 Conflict: Workout session already active`).
2. **Idempotent Termination:** A user cannot stop a workout if no active session exists (`HTTP 400 Bad Request: No active workout found`).
3. **Data Integrity:** All metrics (`durationMinutes`, `caloriesBurned`, `avgHeartRate`) must be computed atomically upon session completion.

---

## 4. Event Bus Specification

The following events are added to `src/utils/eventBus.js`:

| Event Name | Producer | Payload | Consumers |
|---|---|---|---|
| `WORKOUT_STARTED` | Workout API | `{ workoutId, userId, workoutType, startTime }` | Telemetry listener, Dashboard state |
| `WORKOUT_COMPLETED` | Workout API | `{ workoutId, userId, durationMinutes, caloriesBurned, avgHeartRate }` | Recommendation Engine, History Store |
| `RECOMMENDATION_GENERATED`| Recommendation Engine | `{ userId, workoutId, recommendations: [...] }` | In-App Notification Service, UI Card |

---

## 5. Recommendation Engine Decision Matrix

Upon receiving `WORKOUT_COMPLETED`, the recommendation engine evaluates heart rate zones and calorie expenditure:

| Condition | Metric Threshold | Generated Recommendation |
|---|---|---|
| **High Cardiovascular Intensity** | `avgHeartRate >= 150 bpm` | *"High cardiovascular strain detected. Ensure proper rehydration with electrolytes and prioritize 24h muscle recovery."* |
| **Moderate Fat-Burn Zone** | `120 bpm <= avgHeartRate < 150 bpm` | *"Optimal aerobic fat-burn zone maintained! Great cardiovascular endurance session."* |
| **High Caloric Expenditure** | `caloriesBurned >= 400 kcal` | *"Outstanding calorie expenditure! Replenish with balanced carbohydrates and lean protein."* |
| **Short / Warmup Session** | `durationMinutes < 15 min` | *"Quick burst session completed. Consider extending tomorrow's routine to 30 minutes for endurance building."* |

---

## 6. Component Responsibilities (Team Alignment)

* **Siddharth (Database):** Mongoose schema `src/models/Workout.js` managing session persistence.
* **Sourabha (Backend API):** Endpoints `POST /api/workout/start` and `POST /api/workout/stop`.
* **Poorna (UI/UX):** Recommendation display cards on the user dashboard.
* **Suhas (Architecture & Testing):** Architectural session design (this document) and automated integration test suite (`tests/testWorkoutFlow.js`).
