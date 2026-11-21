# AGREEMENTS (frozen interface for all three variants)

**Variants**
| label | style in `/api/meta` | host port | folder |
|---|---|---|---|
| `event` | `event-driven` | 5001 | `Event_Driven/Event_Backend` |
| `modular` | `modular-monolith` | 5011 | `Modular_Monolith/Modular_Backend` |
| `micro` | `microservices` | 5021 (gateway) | `Microservices/` |
Microservices internal ports (inside the Docker network): telemetry-service 5022, goal-service 5023, notification-service 5024,
workout-service 5025. Each service serves `/health` and `/metrics` on its own port.
`GET /api/meta` returns JSON: `{ "name": "PulseFlow", "version": "<semver>", "style": "<style>", "variant": "<label>" }`.
Containers: each variant has its OWN Mongo and Redis (`mongo-event`, `redis-event`, `mongo-modular`, `redis-modular`,
`mongo-micro`, `redis-micro`; follow the naming already used in the root `docker-compose.yml`). Same Mongo and Redis images and
settings in every variant. Never share a database or Redis between variants.
**Same for all three variants:** the same HTTP API (paths, bodies, status codes, JSON shapes), the same frontend, the same Mongoose
schema FIELDS, the same business rules, SSE for delivering notifications to the browser (`GET /api/notifications/:userId/stream`,
same event names and payload as Event-Driven today), the same `GOAL_CPU_MS` setting.
**Environment variables:** `PORT`, `MONGO_URI`, `REDIS_URL`, `CACHE_TTL=300`, `QUIET=1`, `VARIANT`, `SERVICE_NAME`,
`GOAL_CPU_MS` (default 10 in modular and micro; default 0 in Event-Driven; experiments set 10 everywhere),
`FAULT_NOTIFICATIONS` (0 or 1, monoliths only), `DOWNSTREAM_TIMEOUT_MS=1000`, `DOWNSTREAM_RETRIES=1` (microservices).
**GOAL_CPU_MS:** one helper `burnCpu(ms)` (busy loop using `process.hrtime.bigint()`), called exactly ONCE per goal evaluation, inside
the goal logic only. Same helper code in all variants.
**Metrics (Prometheus):** reuse the metric names of the existing instrumentation module in `Event_Driven/Event_Backend`
(find it with `grep -r http_request_duration_seconds Event_Driven/Event_Backend/src`). Do not rename old metrics. Every target
carries labels `variant` (event|modular|micro) and `service` (`app` for monoliths; `gateway`, `telemetry`, `goal`, `notification`,
`workout` for microservices). New metric: `downstream_call_duration_seconds{from,to}` (histogram, every service-to-service call).
**Correlation ID and logs:** header `X-Request-Id`. Create one at the first entry point if missing; pass it on every internal call and
on every internal event. One JSON log line per journey step on stdout:
`{ts, level, requestId, service, variant, step, userId, msg}` where `step` is one of
`ingest_received`, `data_saved`, `goal_evaluated`, `notification_created`, `sse_sent`. (Experiment E7 rebuilds journeys from these logs.)
**Error policy P (same in all three variants, so the comparison is fair):** the ingest request returns 200 after the data is SAVED.
Goal evaluation and notification are best-effort: if they fail, log it, count `journey_failures_total{variant,service,step}`, and do
NOT fail the client request. Event-Driven differs on purpose: it acknowledges BEFORE saving (documented finding, tested in E4).
In Modular Monolith and Microservices the chain (save, evaluate goal, create notification, publish) is synchronous inside the request.
**NotificationHub (Adapter pattern), used by Modular Monolith and Microservices:**
`register(userId, res)`, `unregister(userId, res)`, `publish(userId, notification, requestId)`, `close()`.
Two adapters: `InMemoryHub` (local connections only) and `RedisHub` (publishes JSON `{userId, notification, requestId}` on Redis
channel `notifications`; every replica subscribes once and delivers to the SSE connections it holds). SSE heartbeat every 30 s.
File: `<variant>/src/notifications/NotificationHub.js`. Suhas writes it first; Poorna copies it into her own `shared/` area.
**Databases:** Modular Monolith: one database, collection names prefixed per module (`telemetry_*`, `goals_*`, `notifications_*`,
`workouts_*`), no cross-module queries or joins. Microservices: one Mongo container, ONE DATABASE PER SERVICE:
`fitness_telemetry`, `fitness_goals`, `fitness_notifications`, `fitness_workouts`. No service reads another service's database.
**Workouts:** do not change Event-Driven workout behaviour (a teammate owns a fix). In the new variants build the CORRECT behaviour:
a workout stop saves the result AND updates the dashboard totals.
**Round 1 resource rule (equal TOTAL CPU):** Event-Driven 1.0 CPU; Modular Monolith 1.0 CPU; Microservices 1.0 CPU split over ALL its
containers including the gateway: gateway 0.10, telemetry 0.25, goal 0.35, notification 0.20, workout 0.10. Memory limit per container
is recorded. Mongo and Redis containers are the same for every variant and are reported separately.
