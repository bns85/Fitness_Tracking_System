# ADR-005: Database Per Service

## Status

Accepted

## Context

The microservices variant must prevent one service from depending on another service's collection layout. The application still needs dashboard totals, goal evaluation against activity, and completed workout summaries.

## Decision

Use one dedicated MongoDB container for the micro variant, with a separate database per service: `fitness_telemetry`, `fitness_goals`, `fitness_notifications`, and `fitness_workouts`. Each service connects through its own `MONGO_URI`. Cross-service data is retrieved through HTTP endpoints. Telemetry stores an idempotent workout contribution in its own database and merges it into the dashboard and goal read models.

## Consequences

- Each domain owns its models and can change its database independently.
- Cross-domain reads require explicit network calls and read-model composition.
- The logical databases still share one MongoDB process and container; this is not physical failure isolation.
- `Microservices/scripts/check-databases.js` verifies the configured URIs and rejects source imports across service boundaries.

## Governance

Adding or moving a data field across service ownership requires updating the service API, Compose database mapping, boundary check, contract tests, and this ADR. A service must not connect to another service's database.
