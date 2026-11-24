# Microservices design patterns

## API Gateway

- **Where:** `Microservices/gateway/server.js`
- **Problem:** The browser should not know internal hostnames or service ports.
- **Why here:** The gateway routes the existing public API paths, serves the shared frontend, provides `/api/meta`, and creates the request ID at the public boundary.
- **Trade-off:** One additional network hop and one public entry point to keep available.

## Database per Service

- **Where:** `Microservices/docker-compose.micro.yml`, `Microservices/scripts/check-databases.js`
- **Problem:** Shared collections let one domain depend on another domain's storage layout.
- **Why here:** Each service has a distinct Mongo database and accesses foreign data through HTTP. The check script verifies the four configured database names and checks source imports.
- **Trade-off:** Joins and cross-domain reads become HTTP calls; all four databases still share one MongoDB container, so this is logical rather than host-level isolation.

## NotificationHub Adapter

- **Where:** `Microservices/notification-service/src/notifications/NotificationHub.js`
- **Problem:** Notification creation should not depend on whether an SSE client is local or connected to another replica.
- **Why here:** `InMemoryHub` and `RedisHub` implement `register`, `unregister`, `publish`, and `close`. Redis messages contain `userId`, the notification, and `requestId`; each replica subscribes to `notifications`.
- **Trade-off:** Redis Pub/Sub adds infrastructure and is not durable. The notification document is stored before publish, so a failed publish is visible in logs/metrics but does not roll back the record.

## Timeout and Retry

- **Where:** `Microservices/shared/httpClient.js`
- **Problem:** A failed or slow downstream should not wait forever, and transient server/network failures should get one retry.
- **Why here:** The client uses `DOWNSTREAM_TIMEOUT_MS` (1000 ms by default), `DOWNSTREAM_RETRIES` (1 by default), a fresh non-keep-alive connection, and records each attempt in `downstream_call_duration_seconds{from,to}`.
- **Trade-off:** Retries increase work and can repeat side effects. Workout totals use a unique `workoutId` contribution; goal notifications are de-duplicated by goal/period; workout notifications use deterministic IDs. Client errors are not retried. There is no circuit breaker.

## Correlation ID

- **Where:** `Microservices/shared/requestId.js`, `Microservices/shared/httpClient.js`, `Microservices/shared/logger.js`, `Microservices/gateway/server.js`
- **Problem:** Logs from separate processes need to be joined into one request journey.
- **Why here:** The gateway accepts or creates `X-Request-Id`; service middleware preserves it; each internal call and Redis notification payload forwards it; JSON journey logs include it.
- **Trade-off:** A client-provided ID is accepted as-is, so it is a correlation value, not an authentication mechanism.

## Repository / service-local persistence boundary

- **Where:** `Microservices/<service>/src/models/` and the owning service's controllers/services
- **Problem:** A domain must keep persistence operations inside its own service.
- **Why here:** Mongoose models are service-local data access interfaces; no service imports another service's model. Telemetry's `WorkoutContribution` makes workout totals idempotent without changing the shared `FitnessData` schema fields.
- **Trade-off:** There is no additional repository class between controllers and Mongoose. Query logic remains coupled to Mongoose, but a second wrapper layer is avoided while ownership remains local.

## Strategy (goal types)

- **Where:** `Microservices/goal-service/src/utils/periodUtils.js`, `Microservices/goal-service/src/services/goalService.js`
- **Problem:** Steps, calories, and distance use different telemetry fields and units.
- **Why here:** `GOAL_STRATEGIES` selects the field, unit, and current-value calculation for each supported goal type.
- **Trade-off:** Adding a type also requires a matching telemetry aggregate and contract decision; the type table alone is not enough.

## Dependency Injection

- **Where:** `Microservices/notification-service/src/routes/notifications.js`, `Microservices/notification-service/src/controllers/notificationController.js`
- **Problem:** Notification handlers should use a hub without constructing a particular adapter in each route.
- **Why here:** The server creates the configured hub and passes it into the router/controller; tests can inject `InMemoryHub`.
- **Trade-off:** The server owns hub lifecycle and must close it on shutdown.

## Shared library trade-off

- **Where:** `Microservices/shared/` and each service's `Dockerfile`
- **Problem:** Duplicate request/logging/metrics code drifts, but a shared released package couples deployments.
- **Why here:** The small common library is copied into each service image at build time.
- **Trade-off:** A shared code change requires rebuilding each affected image. The library is shared source, not a separately versioned runtime dependency.
