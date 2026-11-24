# PulseFlow Microservices

The public API is served by the gateway at `http://localhost:5021`. It serves the shared frontend, adds `X-Request-Id`, and routes requests to four independently deployed services.

## Start

From the repository root, with Docker Desktop's Linux engine running:

```powershell
docker compose -f Microservices\docker-compose.micro.yml --profile micro up --build -d
```

Check the gateway at `http://localhost:5021/health`, then open `http://localhost:5021`. The gateway is the only service with a host port. Internal service ports are reachable only on the Compose network.

Stop the stack without deleting persisted data:

```powershell
docker compose -f Microservices\docker-compose.micro.yml --profile micro down
```

## Services and databases

| Service | Internal port | Database | Owns |
|---|---:|---|---|
| Gateway | 5021 | — | Public API routing, frontend and `/api/meta` |
| Telemetry | 5022 | `fitness_telemetry` | Activity data and dashboard telemetry read model |
| Goal | 5023 | `fitness_goals` | Period-aware goals and evaluation |
| Notification | 5024 | `fitness_notifications` | Notifications and SSE connections |
| Workout | 5025 | `fitness_workouts` | Workout sessions and recommendations |

MongoDB (`mongo-micro`) and Redis (`redis-micro`) are dedicated to this variant. Each domain connects to its own Mongo database; a service must use another service's HTTP API rather than querying its database. Run the boundary check from the repository root:

```powershell
node Microservices\scripts\check-databases.js
```

## Scale the goal service

Compose DNS is resolved for each internal request, and the HTTP client does not reuse connections. This lets additional goal replicas receive new requests. After starting the stack, scale only the goal service to two or three replicas:

```powershell
docker compose -f Microservices\docker-compose.micro.yml --profile micro up -d --wait --scale goal-service=2
docker compose -f Microservices\docker-compose.micro.yml --profile micro up -d --wait --scale goal-service=3
```

Both replica counts were tested through the gateway, including goal evaluation and Redis Pub/Sub notification delivery.

## Resource limits

| Container | CPU limit | Memory limit |
|---|---:|---:|
| Gateway | 0.10 | 256 MiB |
| Telemetry | 0.25 | 512 MiB |
| Goal | 0.35 | 512 MiB |
| Notification | 0.20 | 512 MiB |
| Workout | 0.10 | 512 MiB |
| **Application total** | **1.00** | — |

MongoDB and Redis use the same images and runtime settings as the other variants. Neither has a Compose memory cap; record their measured memory separately from the application-container limits.

## Service communication and shared code

Telemetry saves activity before synchronously asking the goal service to evaluate it. The goal service calls telemetry for activity totals and calls the notification service when a goal is reached. Workout stop persists the workout, records a unique workout contribution through telemetry, and then sends a best-effort completion notification. Notification creation and SSE delivery are best-effort; each failure is logged and counted without undoing saved telemetry.

Goal notifications are de-duplicated by goal and period. Workout completion notifications use a deterministic notification ID derived from the user and workout IDs, so retries and concurrent requests do not create duplicate records.

The small `shared/` library is copied into every image during its build. This avoids a versioned package dependency between independently deployed services, but shared changes require rebuilding each service and can diverge if copied code is edited independently.

The shared HTTP client applies `DOWNSTREAM_TIMEOUT_MS` (default 1000 ms), retries eligible failures according to `DOWNSTREAM_RETRIES` (default 1), forwards the correlation ID, and records each network attempt in `downstream_call_duration_seconds`. The gateway uses Docker service names and disables keep-alive reuse.

## Local checks

```powershell
npm.cmd --prefix Microservices\goal-service test
npm.cmd --prefix Microservices\notification-service test
npm.cmd --prefix Microservices\telemetry-service test
npm.cmd --prefix Microservices\workout-service test
node Microservices\scripts\check-databases.js
```
