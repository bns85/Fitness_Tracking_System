# ECS351 Benchmark — Project Progress

Generated: 2026-11-11 (session checkpoint before push)

---

## 1. Tasks completed

### Task 0 — Orient (DONE)
- Git surveyed; `main` branch; benchmark layout inspected.
- Workout persistence fix **already merged** in `71f2fcc` (report-only; no workout code touched).
- Unstaged CRLF-only rewrite of `benchmark/grafana/dashboards/event-vs-polling.json` identified (content == HEAD; left uncommitted on purpose).

### Task 1 — Verify system under test is real (DONE)
- **PROMINENT:** Before this work, **no MongoDB was running** and both apps have a silent mock/in-memory fallback in `src/config/db.js`. Any earlier latency numbers taken without Mongo up **excluded database cost** and must be discarded.
- Full compose stack created: separate `mongo-event` / `mongo-polling`, separate `redis-event` / `redis-polling`.
- Controlled variables (equalized): `CACHE_TTL=300` both, `QUIET=1` both, **1 CPU** per app container (`cpus: 1`).
- Dockerfiles + `.dockerignore` added for both backends.
- Verified live:
  - `MongoDB connected: mongo-event` / `mongo-polling` in logs; **no mock messages**.
  - Cross-DB isolation: `task1_verify` present only in its own Mongo; count 0 in the other.
  - CPU: `NanoCPUs=1000000000` (=1) for both apps.
  - Ingest smoke tests returned 200 and persisted real documents.
- Prometheus loadgen jobs split with `variant` labels (`loadgen-event`, `loadgen-polling`).
- Controlled variables documented in `benchmark/README.md`.

### Task 2 — Fix broken instruments (DONE — 2026-11-11)
| Item | Status | Evidence |
|---|---|---|
| 2.1 `db_operations_total` | **DONE (code + live verify)** | Global Mongoose plugin in `src/metrics/index.js`; metrics is now the **first require** in both `server.js`. After rebuild: event shows `db_operations_total{op=find,save,...}`; polling shows `find,findOne,findOneAndUpdate,countDocuments`. |
| 2.2 `notification_listeners` | **DONE (already correct; verified)** | Stream subscribes to `NOTIFICATION_CREATED`. Live test: **5 open SSE → gauge=5 → close → gauge=0**. |
| 2.3 Loadgen bias + `hasNew` | **DONE (stub test PASS)** | `benchmark/loadgen.js`: SSE held until cycle end (sample hold ≈3079ms with TIMEOUT_MS=3000); polling continues after first `hasNew` (7 polls/user, 60 empty polls, 70 total); reads `hasNew` with `has_new` fallback. Stub harness: `TASK 2.3 STUB TEST: PASS`. |
| 2.4 `poll_responses_total` | **DONE (live verify)** | `pollNotifications` now does `pollResponses.inc({has_new})`. Live: `poll_responses_total{has_new="false"} 2`. |
| 2.5 No business-logic changes | Held | Only metrics/QUIET/compose/loadgen-measurement; no workout changes. |

---

## 2. Tasks still pending

| Task | Status |
|---|---|
| **2.3** Loadgen listener hold-until-cycle-end + `hasNew` field fix + stub retest | **DONE** (stub PASS) |
| **2.4** `poll_responses_total` increment | **DONE** (live verified) |
| **3** Grafana dashboard fixes | **DONE** (generator + JSON validated; Grafana shows 24 panels) |
| **4** Real experiments E1–E4 (+ optional E5), `ENVIRONMENT.md`, screenshot instructions | Pending — **no CSVs exist yet** |
| **5** `benchmark/analysis/aggregate.js` → `summary.csv` / `summary.md` | Pending |
| **6** Docs: REPORT.md, ADR-001.md, ARCHITECTURE.md, DEMO.md, NUMBERS_FOR_SLIDES.md, QA.md | Pending |
| Missing files vs task file: `benchmark/instrument.js`, `benchmark/loadgen/notify.js`, `benchmark/analysis/`, `benchmark/docs/` | Not created (current loadgen is `benchmark/loadgen.js`) |

---

## 3. Files created / modified / deleted

### Created
- `Event_Driven/Event_Backend/Dockerfile`
- `Event_Driven/Event_Backend/.dockerignore`
- `Polling/Polling_Backend/Dockerfile`
- `Polling/Polling_Backend/.dockerignore`
- `benchmark/PROGRESS.md` (this file)

### Modified (committed in `2c305fc` or pending commit)
- `docker-compose.yml` — full stack: 2×Mongo, 2×Redis, 2×apps (1 CPU, CACHE_TTL=300, QUIET=1), Prometheus, Grafana
- `benchmark/README.md` — controlled variables + start instructions
- `benchmark/prometheus/prometheus.yml` — loadgen variant labels
- `Event_Driven/.../src/utils/eventBus.js` — QUIET gate on publish log
- `Event_Driven/.../src/consumers/goalConsumer.js` — QUIET gates
- `Event_Driven/.../src/consumers/workoutConsumer.js` — QUIET gates
- `Event_Driven/.../src/controllers/notificationController.js` — QUIET gates
- `Polling/.../src/controllers/notificationController.js` — QUIET gates
- `Polling/.../src/workers/goalPollingWorker.js` — QUIET gates
- **Pending commit:** `Event_Driven/.../src/metrics/index.js` — Mongoose `dbOperations` plugin
- **Pending commit:** `Polling/.../src/metrics/index.js` — same
- **Pending commit:** `Event_Driven/.../src/server.js` — metrics first require
- **Pending commit:** `Polling/.../src/server.js` — metrics first require

### Not committed (intentional)
- `benchmark/grafana/dashboards/event-vs-polling.json` — **CRLF-only** working-tree noise; content identical to HEAD. Do not treat as a real edit.

### Deleted
- None.

---

## 4. Commands executed and results (key ones)

```text
docker compose up -d --build
  → all 8 stack containers healthy (apps, 2 mongo, 2 redis, prom, grafana)

docker logs event-app | grep MongoDB
  → MongoDB connected: mongo-event          (no mock)

docker logs polling-app | grep MongoDB
  → MongoDB connected: mongo-polling        (no mock)

Cross-DB isolation check (mongosh) → other DB count = 0

curl -X POST :5001/api/telemetry/steps … → 200; document in fitness_event
curl -X POST :5002/api/steps/…           → 200; document in fitness_polling

SSE×5 → notification_listeners 5 → after close 0

POST traffic + GET dashboard → db_operations_total samples on BOTH :5001 and :5002
```

---

## 5. Errors / unresolved issues

1. ~~Loadgen `has_new` vs API `hasNew`~~ — **FIXED** (`hasNew` with fallback).
2. ~~Loadgen early-close bias~~ — **FIXED** (hold until cycle end; stub PASS).
3. ~~`poll_responses_total` never incremented~~ — **FIXED** (live verified).
4. **Prometheus targets down:** `loadgen-event`, `loadgen-polling` (loadgen not running), `cadvisor` (not installed; Docker Desktop → expect empty; label “Linux only”).
5. **Transient Redis ECONNREFUSED** in early app logs (container start race); subsequent logs show `Redis connected`. Watch during long runs.
6. **No experiment CSVs** — `benchmark/results/` only has empty `screenshots/`.
7. ~~Grafana dashboard untested for Task 3 fixes~~ — **DONE** (regenerated, validated, loaded in Grafana; no visual browser check).
8. **Host Redis on :6379** (native) is unrelated to benchmark Redis (in-network only). Do not confuse them.
9. **Git push blocked:** HTTPS remote, no credential helper, no `gh` CLI → `fatal: could not read Username for 'https://github.com'`. Local commits not pushed.
10. **Empty-poll true % not yet measured** under a full E1 run — historical 84% figure is invalid (instrument bugs fixed).

---

## 6. Infrastructure status

| Component | Status | Detail |
|---|---|---|
| Docker Desktop | **UP** | Started this session (was not running) |
| event-app :5001 | **healthy** | Real Mongo `mongo-event` + Redis `redis-event`, CACHE_TTL=300, QUIET=1, 1 CPU |
| polling-app :5002 | **healthy** | Real Mongo `mongo-polling` + Redis `redis-polling`, same controls |
| mongo-event / mongo-polling | **healthy** | Separate volumes; DBs `fitness_event` / `fitness_polling` |
| redis-event / redis-polling | **healthy** | Isolated per variant |
| Prometheus :9090 | **up** | event-app **up**, polling-app **up**; loadgen + cAdvisor **down** |
| Grafana :3000 | **up (HTTP 200)** | Dashboard file present; Task 3 fixes not applied/verified |

---

## 7. Instrumentation & load-test status

| Metric | Status |
|---|---|
| `http_request_duration_seconds` | Registered (middleware both apps) |
| `db_operations_total` | **Working after fix** (plugin + first-require) |
| `notification_listeners` | **Working** (verified 5→0) |
| `events_published_total` | Wired in event bus publish |
| `poll_responses_total` | **Defined but never incremented** |
| `nodejs_eventloop_lag_*` | Via prom-client default metrics |
| Loadgen metrics on :9100 | Code exists (`benchmark/loadgen.js`); **not running**; field-name bug; early-close bias |
| Experiment runs E1–E4 | **Not started** — no CSVs |

---

## 8. Exact next steps (in order)

1. ~~Commit + push pending metrics/server changes and this PROGRESS.md~~ — committed; **push blocked on GitHub auth**.
2. ~~**Task 2.3:** Fix `benchmark/loadgen.js`~~ — DONE (stub PASS).
3. ~~**Task 2 (finish):** Add `pollResponses.inc`~~ — DONE (live verified).
4. ~~**Task 3:** Audit and fix Grafana dashboard~~ — DONE (regenerate via `python3 benchmark/generate_dashboard.py`).
5. **Task 4:** Write `benchmark/results/ENVIRONMENT.md` (machine specs + docker limits); reset DBs between runs; run E1 (10/50/100/200 × 3 runs), E2 ablation, E3 higher load, E4 durability; save CSVs under `benchmark/results/`.
6. **Task 5:** `benchmark/analysis/aggregate.js` → `summary.csv` + `summary.md`.
7. **Task 6:** Write the six docs under `benchmark/docs/`.
8. Final checklist with exact reproduce commands.
9. Push all commits once GitHub credentials are available.

---

## 9. Git checkpoint (this session)

- Branch: `main` (tracks `origin/main`)
- Already on GitHub (origin): up through `5face94` / `71f2fcc` (see origin/main)
- Local commits **not pushed** (auth failure):
  - `4b618d6` fix(loadgen): real SSE/poll measurement
  - `2c305fc` feat(compose): real per-variant Mongo/Redis, equal CACHE_TTL=300, QUIET=1, 1-CPU
  - `9af94df` fix(metrics): mongoose db_operations plugin as first require; add PROGRESS checkpoint
  - (this commit) Task 2.3 loadgen hold + hasNew + pollResponses.inc + PROGRESS update
- `.env` files: **gitignored**, not tracked; no secrets in repo (`git ls-files` clean)
- Unstaged noise: `benchmark/grafana/dashboards/event-vs-polling.json` CRLF-only rewrite — leave uncommitted
