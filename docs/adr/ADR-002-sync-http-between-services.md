# ADR-002: Synchronous HTTP Between Services

## Status

Accepted

## Context

The microservices variant must make its internal network calls visible and measurable while preserving the public API and error policy. Ingest must save telemetry before evaluating goals. Goal evaluation may create a notification, and workout stop must update the dashboard totals.

## Decision

Use synchronous HTTP between the gateway and domain services, and between telemetry, goal, workout, and notification services. The shared client forwards `X-Request-Id`, uses a 1000 ms default timeout and one retry, disables connection reuse, and records `downstream_call_duration_seconds{from,to}`.

Telemetry responds to step ingest only after the save and goal-evaluation attempt. Goal-evaluation and notification failures are logged and counted without failing an already-saved step request. Workout stop persists first and requires the telemetry totals update before returning success; its notification is best-effort.

## Consequences

- The request journey is direct and observable without introducing a broker for all domain operations.
- Network hops increase latency and create availability dependencies.
- Retries are limited to eligible transient failures. Workout totals and goal notifications use idempotency keys to prevent duplicate records.
- Redis Pub/Sub remains the notification fan-out mechanism; it is not the synchronous business-call transport.

## Governance

Changes to call order, retry policy, timeout, idempotency, or public error behavior require updating this ADR, the API contract, and the microservice tests. Do not claim fault recovery without running the corresponding fault experiment.
