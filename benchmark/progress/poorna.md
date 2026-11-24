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
- P9 runtime: built and started the seven-container stack; exercised API and browser flows through the gateway, including Redis-backed SSE and workout completion.
- Fixed the gateway SSE proxy to flush upstream response headers immediately; validated notification delivery through the public gateway.
- Verified goal-service scales to 2 and 3 healthy replicas; 30 gateway requests were served by all three replicas.

## In progress
- Formal P9 contract tests are blocked: the `contract-v1` tag and `benchmark/contract/contract.test.js` are not present in the repository.
- E5/E6 are gated on Sourabha's `phase1-gate` and must run on `e5/micro`.

## Next steps
1. Ask Sourabha to publish `contract-v1` and `benchmark/contract/contract.test.js`; run the official contract suite through `http://localhost:5021`.
2. After `phase1-gate`, create/use `e5/micro`, implement and test `active_minutes`, and write E5/E6 results as required.
3. Request `micro-ready` only after the official P1-P9 checks pass.
4. Publish the follow-up gateway SSE fix and validation notes after Git HTTPS is working.

## Needs from others
- `contract-v1` and the official contract test file are not available; required before formal P9 contract validation.
- `phase1-gate` is not available yet; required before E5/E6.
- `hub-v1` was available and its hub interface has been implemented with service-local configuration and metrics.
- The Git HTTPS helper still fails to load `libcurl-4.dll`, blocking publication of any follow-up commit.

## How to resume
1. Read this file and `PROMPT_3_Poorna.md`.
2. Check out `poorna/micro` and verify `git status`; the local branch includes a follow-up SSE header fix not yet in the merged PR.
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
- `docker compose ... up --build -d --wait` built the images and all seven containers became healthy.
- Contract-like flow through the gateway passed: goal validation/create, telemetry ingest/evaluation, SSE notification, notification read/unread, dashboard totals, workout start/live/stop, and exact unknown-route HTML response.
- Browser flow passed: microservices badge, goal creation, live workout metrics, stop/completion, recommendations, and refreshed dashboard.
- Scaling to `goal-service=2` and `=3` passed with all services healthy; end-to-end API/SSE flow passed at both sizes.
- At three replicas, 30 goal-creation requests returned 200 and logs confirmed requests reached all three replicas with correlation IDs.

## Not tested
- Official contract suite (`contract-v1` and `contract.test.js` are missing); manual contract-like flows are not a substitute for that suite.
- E5/E6, pending `phase1-gate`; official E1-E8 benchmark runs are owned by Siddharth and were not run.
- Follow-up SSE fix is not yet pushed; Git HTTPS fails to load `libcurl-4.dll`.
