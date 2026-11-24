# Poorna — Microservices Progress

## Done
- Read `PROMPT_3_Poorna.md` and the required architecture, API, hypothesis, environment, and Event-Driven references.
- Confirmed `day0-ready`, `hub-v1`, and `modular-ready` are present locally; `contract-v1` is not present.
- P1: added the gateway, telemetry service health/metrics scaffold, shared request-ID/logging/metrics/HTTP/CPU helpers, and initial micro Compose profile.
- P2: added telemetry schemas matching Event-Driven, step persistence, a dashboard read model with goal/workout service composition, Redis cache support, and an internal workout-total update endpoint.

## In progress
- P3 goal evaluation and notification flow.

## Next steps
1. Implement period-aware goal evaluation, notifications, and NotificationHub (P3-P5).
2. Implement workout/recommendations, per-service databases, and complete Compose profile (P6-P8).
3. Wait for `contract-v1`, then run contract checks and browser validation (P9).
4. Add architecture, patterns, ADRs, threat-to-validity notes, scale instructions, and final progress; request `micro-ready`.

## Needs from others
- `contract-v1` is not available locally yet; required before P9 contract validation.
- `hub-v1` is available. The NotificationHub will be adapted into the notification-service with service-local configuration and metrics.

## How to resume
1. Read this file and `PROMPT_3_Poorna.md`.
2. Check out `poorna/micro`, fetch/rebase `origin/main`, and verify `git status`.
3. Continue at the first incomplete item in Next steps.

## Tested
- `node --check` passes for all 15 JavaScript files.
- `docker compose -f Microservices\docker-compose.micro.yml --profile micro config` validates the initial Compose profile.
- Compared the `FitnessData`, `HeartRate`, `Sleep`, and `Weight` field names with Event-Driven; all match.
- Both package manifests parse as JSON.
- `git diff --check` passes.

## Not tested
- Docker build/start and MongoDB/Redis-backed routes could not run because Docker Desktop's Linux engine pipe is unavailable.
- Browser flow and contract tests (`contract-v1` is not present locally).
- Push to the collaboration branch; the local Git HTTPS helper currently fails to load `libcurl-4.dll`.
