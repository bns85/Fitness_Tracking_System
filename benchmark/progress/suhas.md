# Suhas — Progress

Branch: `suhas/modular`

## Done
- **M1 Scaffold:** `Modular_Monolith/Modular_Backend/` established with `package.json`, `package-lock.json`, `Dockerfile`, `src/config/`, `src/utils/burnCpu.js`, `src/utils/logger.js`, `src/server.js` serving `/health`, `/metrics`, `/api/meta`, and `Frontend_Shared/`.
- **M2 NotificationHub (`src/notifications/NotificationHub.js`):** implemented Adapter pattern with `InMemoryHub` and `RedisHub` (Redis channel `notifications`, JSON payload `{userId, notification, requestId}`, 30s heartbeat comment `: heartbeat\n\n`, connection tracking, and SSE header management). Milestone tag `hub-v1` created!
- **M3 Metrics:** `src/metrics/index.js` configured with `variant="modular"` and `service="app"` default labels, `http_request_duration_seconds`, `db_operations_total` Mongoose plugin, `journey_failures_total`, `notification_listeners` SSE connections gauge, and event loop lag monitoring.
- **M4 Domain Modules:** Implemented all 6 modules with strict Facade pattern (`index.js` as only public API), module-owned collections (`telemetry_*`, `goals_*`, `notifications_*`, `workouts_*`), Repository pattern, and Strategy pattern for goals (`steps`, `calories`, `distance`).
- **M5 Main Flow:** `POST /api/telemetry/steps` saves steps first, then synchronously calls `goals.evaluateGoals(userId, requestId)` which calls `burnCpu(GOAL_CPU_MS)` once, evaluates goals, and invokes `notifications.createNotification(...)`. Follows Error Policy P (200 returned after data saved; goal/notification failures are logged and counted in `journey_failures_total`). Emits JSON journey steps (`ingest_received`, `data_saved`, `goal_evaluated`, `notification_created`, `sse_sent`). Honours `FAULT_NOTIFICATIONS=1`.
- **M6 Endpoints:** Goals CRUD (period-aware, duplicate check 409, 400 validation array), notifications (list, mark read, unread count, stream), dashboard (read aggregation querying facades with 300s cache), workouts (start, live metrics, pause, resume, stop with CORRECT behaviour where stop persists and increments daily telemetry totals).
- **M7 Module Checker:** `scripts/check-modules.js` zero-dependency boundary checker enforcing module encapsulation and blocking direct model imports across modules. Automated tests in `tests/checkModules.test.js` prove it catches violations. Integrated into `npm test`. Guide written in `benchmark/docs/parts/suhas_keeping_modules_modular.md`.
- **M8 Compose Part Files:** Created `Modular_Monolith/docker-compose.modular.yml` (`modular-app` port 5011, 1 CPU limit, `mongo-modular`, `redis-modular`, healthchecks), `Modular_Monolith/nginx-lb.conf`, and `Modular_Monolith/docker-compose.modular-scale.yml` for scaled N-replica testing behind Nginx.
- **Documentation & ADRs:**
  - `benchmark/docs/parts/suhas_architecture.md`: Mermaid diagram, module public APIs, coupling counts, architectural characteristics.
  - `benchmark/docs/parts/suhas_patterns.md`: Facade, Adapter, Repository, Strategy, Dependency Injection, Singleton/Config.
  - `docs/adr/ADR-003-notification-fanout-redis-pubsub.md`: Notification fan-out via Redis Pub/Sub for SSE in scaled monolith.
  - `docs/adr/ADR-004-module-boundaries-and-check-script.md`: Strict module boundaries and lint verification.
- **Unit & Integration Tests:** 28/28 tests passing (`tests/checkModules.test.js`, `tests/modularIntegration.test.js`, `tests/notifications/notificationHub.test.js`, `tests/server.test.js`) and `scripts/check-modules.js` reporting 0 violations.

## In progress
- M9 Contract Verification: Ready for `contract-v1` contract tests by Sourabha.

## Next steps (numbered, exact)
1. Run Sourabha's contract test suite (`benchmark/contract/contract.test.js`) against port 5011 as soon as `contract-v1` is tagged.
2. Complete browser checklist against `http://localhost:5011`.
3. Request Sourabha to tag `modular-ready`.
4. After `phase1-gate`:
   - Run E5 (Extensibility: add `active_minutes` goal strategy on branch `e5/modular`) and document in `benchmark/results/E5_modular.md`.
   - Run E6 (Deployability: time rebuild/restart) and document in `benchmark/results/E6_modular.md`.

## Needs from others
- Sourabha: commit `benchmark/contract/contract.test.js` and tag `contract-v1`.

## How to resume
```powershell
cd Fitness_Tracking_System\Modular_Monolith\Modular_Backend
npm test
```

## Tested
- `npm test`: 28/28 tests passing across 6 test suites + `scripts/check-modules.js` exit code 0.
- `check-modules.js` proven to catch internal imports and cross-module model imports via temporary directory fixtures.
- `burnCpu` helper verified to burn >= 9ms on 10ms request.
- Strategy registry verified to extract values for `steps`, `calories`, `distance`.
- `/health`, `/metrics`, `/api/meta` verified.
- Telemetry, Goal, and Workout validation error shapes verified against API contract.

## Not tested
- Docker daemon execution (Docker Desktop not active on this Windows host).
- Full browser UI manual clicks (no display window in terminal).
