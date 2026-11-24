# Microservices threats to validity

- The services, MongoDB, Redis, and load generator run on one development machine. Local Docker networking is not representative of a production network or separate failure domains.
- All four logical databases share one MongoDB container, and cache/Pub/Sub use one Redis container. Container-level resource limits do not model managed database or multi-zone deployments.
- `GOAL_CPU_MS` is simulated busy-loop work. It does not represent a production goal engine or realistic CPU/memory access.
- The current source checks and unit tests do not establish end-to-end availability, goal-service scale-out, Redis replica delivery, or fault recovery.
- No browser checklist or contract test has run yet. The `contract-v1` tag is not present in the locally available refs.
- No official E1-E8 measurements have been run for this variant. Architecture characteristics in the diagram are static observations, not measured results.
- The team workload and Fitbit-style records do not represent every real user's activity pattern. Workout contributions are combined with daily telemetry in a read model; that design should be verified against a complete contract run.
- A notification publish may fail after its notification document is stored. The system records that failure but does not provide durable replay of missed SSE messages.
- HTTP retries can add load during an outage. Idempotency is implemented for workout-total contributions and goal notifications, but operational retry behavior still needs fault testing.
