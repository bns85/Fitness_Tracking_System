# Suhas — Progress

Branch: `suhas/modular`

## Done
- M1 Scaffold: `Modular_Monolith/Modular_Backend/` established with `package.json`, `package-lock.json`, `Dockerfile`, `src/config/`, `src/utils/burnCpu.js`, `src/utils/logger.js`, `src/server.js` serving `/health`, `/metrics`, `/api/meta`, and `Frontend_Shared/`.
- M2 NotificationHub (`src/notifications/NotificationHub.js`): implemented Adapter pattern with `InMemoryHub` and `RedisHub` (Redis channel `notifications`, JSON payload `{userId, notification, requestId}`, 30s heartbeat comment `: heartbeat\n\n`, connection tracking, and SSE header management).
- M3 Metrics: `src/metrics/index.js` configured with `variant="modular"` and `service="app"` default labels, `http_request_duration_seconds`, `db_operations_total` Mongoose plugin, `journey_failures_total`, `notification_listeners` SSE connections gauge, and event loop lag monitoring.
- Unit testing: 13/13 unit tests pass across NotificationHub (InMemory & RedisHub) and server endpoints (`GET /health`, `GET /metrics`, `GET /api/meta`).

## In progress
- M4 Modules: Implementing the 6 domain modules (`telemetry`, `goals`, `notifications`, `workouts`, `recommendations`, `dashboard`) with strict module facades (`index.js`), repositories, and Strategy pattern for goal types.

## Next steps (numbered, exact)
1. Build M4/M5 modules:
   - `telemetry`: model with `telemetry_fitness_data` collection, telemetryRepository, step ingest handler calling goal evaluation synchronously.
   - `goals`: model with `goals_data` collection, period-aware goal evaluators behind Strategy pattern (`steps`, `calories`, `distance`), repository, CRUD endpoints.
   - `notifications`: model with `notifications_data` collection, notificationRepository, NotificationHub SSE integration, `FAULT_NOTIFICATIONS` support.
   - `workouts`: model with `workouts_data` collection, workoutRepository, start/stop/pause/resume/live-metrics endpoints, with correct behaviour where stop updates dashboard.
   - `recommendations`: rule-based engine with Redis caching.
   - `dashboard`: aggregated data via facades of other modules without direct DB access.
2. Build M7: `scripts/check-modules.js` module checker and write `benchmark/docs/parts/suhas_keeping_modules_modular.md`.
3. Build M8: `Modular_Monolith/docker-compose.modular.yml`, `nginx-lb.conf`, and `docker-compose.modular-scale.yml`.
4. Run M9 contract tests against port 5011.
5. Write docs: `suhas_architecture.md`, `suhas_patterns.md`, ADR-003, ADR-004.

## Needs from others
- Sourabha to tag `hub-v1` so Poorna can copy `NotificationHub.js` to microservices.
- Sourabha to finish `contract-v1` for end-to-end contract test execution.

## How to resume
```powershell
cd Fitness_Tracking_System\Modular_Monolith\Modular_Backend
node --test tests/**/*.test.js
```

## Tested
- `tests/notifications/notificationHub.test.js`: InMemoryHub registration, SSE headers, notification delivery, user isolation, disconnect cleanup, heartbeat, RedisHub pub/sub handling, and createNotificationHub factory (10/10 passed).
- `tests/server.test.js`: `GET /health` (200, status ok, X-Request-Id header), `GET /metrics` (200, prometheus metrics), `GET /api/meta` (200, PulseFlow modular-monolith payload) (3/3 passed).

## Not tested
- End-to-end multi-process Redis communication with real Redis container (tested via mock pub/sub clients in unit tests).
- Docker Compose build of modular-app container (Docker daemon not running locally yet).
