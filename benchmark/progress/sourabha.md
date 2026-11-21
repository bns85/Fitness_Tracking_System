# Sourabha — progress

Branch: `sourabha/foundation`

## Done
- A1 Backup: `git bundle` at `../Fitness_backup_2026-11-21.bundle` (156 MB, `git bundle verify` OK, 4 refs, complete history) and full folder copy at `~/Fitness_backup_2026-11-21` (WSL, outside OneDrive, node_modules excluded).
- A2 Frontend move finished: Event server serves `Frontend_Shared`, `config.js` loaded before `app.js`, all fetch/EventSource URLs built from `window.API_BASE`, compose mounts `Frontend_Shared` read-only. Committed in three commits as planned.
- A3 Smoke test Event-Driven: tests pass, HTTP checks pass (details under Tested).

## In progress
- (none)

## Next steps (numbered, exact)
1. A4: move Polling to a legacy compose profile only (do not touch Polling files).
2. A5: refresh `benchmark/contract/API_CONTRACT.md` against current routes/controllers/goal code.
3. A6: commit `benchmark/docs/TASK_SPEC.md` and `benchmark/docs/AGREEMENTS.md`.
4. A7-A9 [HUMAN]: push, collaborators, branches, tag `day0-ready`.

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

## Not tested
- Browser click-through of http://localhost:5001 (no browser automation on this machine): dashboard rings, goals, notifications visuals. Sourabha should open it once by hand.
- Docker is NOT inside WSL (`docker` command missing); use `docker.exe` from WSL or the Docker Desktop UI.
