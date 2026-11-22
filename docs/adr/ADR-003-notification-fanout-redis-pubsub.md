# ADR-003: Notification Fan-Out via Redis Pub/Sub for SSE in Scaled Monolith

## Status
Accepted

## Context
In Sprint 1 and the original single-instance Event-Driven prototype, notifications were pushed to browser clients via Server-Sent Events (SSE) using an in-process EventEmitter (`eventBus`).

When scaling the Modular Monolith horizontally across multiple replicas (as evaluated in Experiment E2), an HTTP request to ingest telemetry (`POST /api/telemetry/steps`) may land on Replica A via the Nginx load balancer, while the client's long-lived SSE connection (`GET /api/notifications/:userId/stream`) is connected to Replica B. Without a shared fan-out mechanism, Replica A cannot deliver the real-time `GOAL_REACHED` event to Replica B.

## Decision
We implement the Adapter pattern in `NotificationHub` (`src/notifications/NotificationHub.js`) with two concrete adapters:
1. `InMemoryHub`: For local, single-process execution and unit tests.
2. `RedisHub`: For production and scaled multi-replica environments.

When `publish(userId, notification, requestId)` is invoked:
- The publisher serializes `{ userId, notification, requestId }` and publishes it to Redis channel `notifications`.
- Every replica subscribes to channel `notifications` exactly once upon startup.
- Upon message arrival, each replica delivers the notification to any active SSE connections it holds for that `userId`.

## Consequences

### Positive
- Enables seamless horizontal scaling across N app replicas behind Nginx without sticky sessions for SSE.
- Clean separation between local connection management and message distribution.
- Zero external dependencies required during unit testing (via `InMemoryHub`).

### Negative
- Introduces an extra network hop and JSON serialization/deserialization to Redis.
- If Redis is unavailable, message delivery degrades to local process only.

## Governance
All modules delivering notifications must do so exclusively through `notifications.createNotification(...)` and `NotificationHub`. No module may write directly to Redis channels or create ad-hoc SSE streams.
