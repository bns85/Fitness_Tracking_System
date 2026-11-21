# Sourabha — progress

Branch: `sourabha/foundation`

## Done
- A1 Backup: `git bundle` at `../Fitness_backup_2026-11-21.bundle` (156 MB, `git bundle verify` OK, 4 refs, complete history) and full folder copy at `~/Fitness_backup_2026-11-21` (WSL, outside OneDrive, node_modules excluded).
- A2 Frontend move finished: Event server serves `Frontend_Shared`, `config.js` loaded before `app.js`, all fetch/EventSource URLs built from `window.API_BASE`, compose mounts `Frontend_Shared` read-only. Committed in three commits as planned.

## In progress
- A3 Smoke test Event-Driven.

## Next steps (numbered, exact)
1. A3: start Event-Driven profile, run `tests/testGoalFeature.js` and `tests/testIntegrationSensorEventNotification.js`, open http://localhost:5001.
2. A4: move Polling to a legacy compose profile only (do not touch Polling files).
3. A5: refresh `benchmark/contract/API_CONTRACT.md` against current routes/controllers/goal code.
4. A6: commit `benchmark/docs/TASK_SPEC.md` and `benchmark/docs/AGREEMENTS.md`.
5. A7-A9 [HUMAN]: push, collaborators, branches, tag `day0-ready`.

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

## Not tested
- Event-Driven app not started yet (A3 pending).
