# Poorna — Microservices Progress

## Done
- Read `PROMPT_3_Poorna.md` and the required architecture, API, hypothesis, environment, and Event-Driven references.
- Confirmed `day0-ready`, `hub-v1`, and `modular-ready` are present locally; `contract-v1` is not present.
- P1: added the gateway, telemetry service health/metrics scaffold, shared request-ID/logging/metrics/HTTP/CPU helpers, and initial micro Compose profile.
- P2: added telemetry schemas matching Event-Driven, step persistence, a dashboard read model with goal/workout service composition, Redis cache support, and an internal workout-total update endpoint.
- P3-P5: added period-aware goals and one CPU-work call per evaluation; telemetry → goal → notification synchronous HTTP flow with retry, timeout, correlation ID, hop metrics, best-effort failure counters, and a Redis-backed SSE NotificationHub adapter.
- P6: added workout lifecycle APIs, cached recommendations, dashboard-total updates, idempotent workout completion notifications, and an idempotent telemetry contribution read model.
- P7: added a no-dependency check that verifies four distinct Mongo databases and rejects cross-service source imports.
- P8: completed the microservice README, architecture and pattern notes, ADR-002/ADR-005, and threats-to-validity notes. The gateway now has a local smoke check for health, meta, correlation ID, and the shared frontend.

## In progress
- P9 contract/browser validation is blocked pending `contract-v1` and a running Docker Desktop Linux engine.

## Next steps
1. Start Docker Desktop's Linux engine and verify the image build and full Compose health checks.
2. Fetch `contract-v1`; run `BASE_URL=http://localhost:5021 npm run test:contract` and the browser checklist through the gateway.
3. Test goal-service scaling at 2 and 3 replicas; fix any issues and update test results.
4. Finalize progress and request `micro-ready` only after P9 passes.
5. Push `poorna/micro` to origin after the local Git HTTPS helper is repaired/authenticated.

## Needs from others
- `contract-v1` is not available locally yet; required before P9 contract validation.
- `hub-v1` was available and its hub interface has been implemented with service-local configuration and metrics.
- Docker Desktop's Linux engine must be started for image, MongoDB, Redis, and browser validation.

## How to resume
1. Read this file and `PROMPT_3_Poorna.md`.
2. Check out `poorna/micro`, fetch/rebase `origin/main`, and verify `git status`.
3. Continue at the first incomplete item in Next steps.

## Tested
- `node --check` passes for all 41 project JavaScript files (excluding installed `node_modules`).
- `docker compose -f Microservices\docker-compose.micro.yml --profile micro config` validates the full Compose profile.
- Goal service unit suite: 5 tests pass (period boundaries, goal views/strategies, HTTP retry and correlation ID).
- Notification service unit suite: 3 tests pass (SSE event format, deterministic workout notification IDs, and concurrent retry deduplication).
- Telemetry service unit suite: 2 tests pass (merged daily totals and dashboard averages).
- Workout service unit suite: 3 tests pass (recommendation rules, Redis cache TTL, and logged cache-failure fallback).
- Compared all seven shared Mongoose schema field lists with Event-Driven; all match.
- Compose CPU limits sum to exactly 1.00; only the gateway publishes a host port; no fixed app container names are configured.
- `node Microservices\scripts\check-databases.js` confirms four distinct service databases and no cross-service source imports.
- Package manifests parse as JSON; default Prometheus target labels verified.
- Local gateway smoke check passed for `/health`, `/api/meta`, `X-Request-Id`, and serving `Frontend_Shared/`.
- `git diff --check` passes.

## Not tested
- Docker image build/start, MongoDB/Redis-backed routes, replica scaling, browser flow, and contract tests (`contract-v1` is not present locally; Docker engine unavailable).
- Official E1-E8 experiments.
- Push to the collaboration branch; the local Git HTTPS helper currently fails to load `libcurl-4.dll`.
