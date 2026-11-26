# Sourabha — progress

Branch: `sourabha/foundation`

## Done
- A1 Backup: `git bundle` at `../Fitness_backup_2026-11-21.bundle` (156 MB, `git bundle verify` OK, 4 refs, complete history) and full folder copy at `~/Fitness_backup_2026-11-21` (WSL, outside OneDrive, node_modules excluded).
- A2 Frontend move finished: Event server serves `Frontend_Shared`, `config.js` loaded before `app.js`, all fetch/EventSource URLs built from `window.API_BASE`, compose mounts `Frontend_Shared` read-only. Committed in three commits as planned.
- A3 Smoke test Event-Driven: tests pass, HTTP checks pass (details under Tested).
- A4 Polling moved to legacy profile `polling`: default `docker compose up -d` starts event-app + mongo-event + redis-event + prometheus + grafana only; `--profile polling` starts polling stack (verified: polling /health 200), then stopped again.
- A5 API contract refreshed against routes/controllers/goal code (`docs: refresh API contract`). Key corrections: goal types are steps/calories/distance (API rejects `workouts`), create/update/complete return RAW goal docs while list/dashboard return goal views, goal 400s carry an `errors[]` array, unknown route is HTML 404 (Express default), no bulk mark-all-read endpoint exists (test must loop PUT `/:id/read`), `/api/meta` documented as agreed shape but currently 404 until task C2.
- A6 `benchmark/docs/TASK_SPEC.md` and `benchmark/docs/AGREEMENTS.md` committed (`docs: task spec and agreements`).
- B1 Contract tests referee: `benchmark/contract/contract.test.js` and `benchmark/contract/contract.js` authored (checks health, meta, goal CRUD & duplicate 409, step ingest, notification delivery, dashboard totals, workout lifecycle, and error 404 across any variant). Tag `contract-v1` ready.
- C1 `GOAL_CPU_MS` & `burnCpu`: added helper in `Event_Driven/Event_Backend/src/utils/burnCpu.js` and integrated inside `src/utils/goalProgress.js` (called exactly once per goal evaluation).
- C2 `/api/meta`: added endpoint to `Event_Driven/Event_Backend/src/server.js` returning `{ name: "PulseFlow", version: "1.0.0", style: "event-driven", variant: "event" }`.
- C3 Metric labels: added default labels `variant="event"` and `service="app"` in `Event_Driven/Event_Backend/src/metrics/index.js`.
- C4 Compare demo page: created `Frontend_Shared/compare.html` with simultaneous 3-variant step firing and real-time millisecond notification latency comparison.

## In progress
- (none — Day 0 code work done; waiting on [HUMAN] steps A7–A9)

## Next steps (numbered, exact)
1. A7 [HUMAN]: Sourabha runs `gh auth login` (or token/SSH), then `git push origin main`; confirm on GitHub.
2. A8 [HUMAN]: GitHub Settings → Collaborators: add Suhas, Poorna, Siddharth (write). Recommended: protect `main` (PR required).
3. A9: create + push branches `sourabha/foundation`, `suhas/modular`, `poorna/micro`, `siddharth/benchmark` from `main`, then tag `day0-ready` and push it. Message to team: "Day 0 ready. `git fetch --tags`, check out your branch, read your prompt."
4. Part B: contract tests `benchmark/contract/contract.test.js` (tag `contract-v1`).

## Needs from others
- (none yet)

## How to resume
```
cd /mnt/c/Users/soura/OneDrive/Documentos/GitHub/Fitness_Tracking_System
git status && git log --oneline -5
```
Read this file, then continue from "Next steps".

## Tested
- Bundle backup: `git bundle verify` passed.
- Content of staged frontend move equals working tree (only CRLF difference, normalized to LF).
- A3: `docker compose up -d --build event-app` via `docker.exe` (Docker Desktop had to be started manually first). Containers healthy: event-app :5001, mongo-event :27019, redis-event.
- A3: `npm run test:goals` = 24/24 PASSED. `npm run test:integration` = 6/6 PASSED (against the running container on :5001).
- A3 HTTP checks: `/`, `/config.js`, `/app.js`, `/styles.css` all 200; `/health` ok; `/api/notifications/:user`, `/api/dashboard/:user`, `/api/goals/:user` all 200; `/api/meta` 404 (expected until task C2); served HTML loads config.js before app.js.
- A5 live probes (curl): goal 400 validation shape with `errors[]`, 409 `DUPLICATE_GOAL` + raw goal, telemetry 400, goal/notification/workout 404 JSON, POST /notifications missing fields → 500 Mongoose error, goal list view shape, dashboard `{source,data}`, workout active → `null`, SSE headers `text/event-stream`, unknown route → HTML `Cannot GET`, malformed JSON → HTML 400.

## Not tested
- Browser click-through of http://localhost:5001 (no browser automation on this machine): dashboard rings, goals, notifications visuals. Sourabha should open it once by hand.
- Docker is NOT inside WSL (`docker` command missing); use `docker.exe` from WSL or the Docker Desktop UI.
