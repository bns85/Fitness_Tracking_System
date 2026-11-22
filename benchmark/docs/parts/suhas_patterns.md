# Design Patterns in the Modular Monolith

Author: Suhas (Modular Monolith Lead)

This document details the six primary design patterns implemented across the Modular Monolith architecture.

---

## 1. Facade Pattern

- **File Paths:**
  - `src/modules/telemetry/index.js`
  - `src/modules/goals/index.js`
  - `src/modules/notifications/index.js`
  - `src/modules/workouts/index.js`
  - `src/modules/recommendations/index.js`
  - `src/modules/dashboard/index.js`
- **Problem:** Modules need to collaborate without exposing their internal implementation details (models, repositories, private helper functions).
- **Why Here:** `index.js` acts as the single public entry point for each domain module. Modules are prohibited by `scripts/check-modules.js` from importing anything except another module's `index.js`.
- **Trade-off:** Requires explicitly declaring exported methods in `index.js`, adding a minor maintenance step when adding new cross-module capabilities.

---

## 2. Adapter Pattern

- **File Paths:**
  - `src/notifications/NotificationHub.js`
- **Problem:** The notifications module must deliver real-time Server-Sent Events (SSE) to connected browser clients, both in a single-instance development setup and across multiple scaled replicas behind a load balancer.
- **Why Here:** `NotificationHub` provides a unified interface (`register`, `unregister`, `publish`, `close`). Two concrete adapters are provided:
  - `InMemoryHub`: Stores connections locally in a Map and delivers SSE events in-process.
  - `RedisHub`: Adapts Redis Pub/Sub channels so any replica can publish a notification, and all replicas holding active SSE connections deliver it to their respective clients.
- **Trade-off:** `RedisHub` introduces a small serialization and network hop to Redis compared to pure in-process delivery, but enables seamless horizontal scaling.

---

## 3. Repository Pattern

- **File Paths:**
  - `src/modules/telemetry/telemetryRepository.js`
  - `src/modules/goals/goalRepository.js`
  - `src/modules/notifications/notificationRepository.js`
  - `src/modules/workouts/workoutRepository.js`
- **Problem:** Business logic mixed with database queries leads to tight coupling with Mongoose schemas and difficult mocking during tests.
- **Why Here:** Each module encapsulates its Mongoose model interactions inside a dedicated repository class. Database queries, atomic upserts, and projections remain isolated inside the owning module.
- **Trade-off:** Introduces an extra class layer between the facade/controllers and the database.

---

## 4. Strategy Pattern

- **File Paths:**
  - `src/modules/goals/strategies/StepsStrategy.js`
  - `src/modules/goals/strategies/CaloriesStrategy.js`
  - `src/modules/goals/strategies/DistanceStrategy.js`
  - `src/modules/goals/strategies/index.js`
- **Problem:** Goal progress calculation for different metric types (`steps`, `calories`, `distance`) often degenerates into brittle `switch` or `if/else` statements that violate the Open/Closed Principle.
- **Why Here:** Each goal type is encapsulated in its own strategy class implementing `extractValue(totals)` and declaring its target field and unit. Adding a new goal type (e.g. `active_minutes` in Experiment E5) requires creating exactly one new strategy file without modifying existing evaluation code.
- **Trade-off:** Requires a registry map to look up strategies by type string.

---

## 5. Dependency Injection Pattern

- **File Paths:**
  - `src/server.js`
  - `src/modules/telemetry/index.js`
  - `src/modules/goals/index.js`
  - `src/modules/workouts/index.js`
  - `src/modules/dashboard/index.js`
- **Problem:** Circular module dependencies (e.g., Telemetry calling Goals, while Goals queries Telemetry totals) cause require-cycle initialization bugs in CommonJS.
- **Why Here:** At bootstrap, `server.js` explicitly injects dependencies via `setDependencies({ ... })` across module facades. Modules declare what they need without hardcoding immediate circular `require` calls.
- **Trade-off:** Dependencies must be wired during server bootstrap before handling incoming HTTP requests.

---

## 6. Singleton / Configuration Pattern

- **File Paths:**
  - `src/config/index.js`
  - `src/metrics/index.js`
- **Problem:** Global application configuration and Prometheus metric registries must remain consistent and shared across all modules without duplicate metric registration errors.
- **Why Here:** Node.js module caching ensures `config/index.js` and `metrics/index.js` act as singletons. Global Mongoose plugins and Prometheus default labels are initialized once at startup.
- **Trade-off:** Changes to configuration during runtime require controlled re-initialization.
