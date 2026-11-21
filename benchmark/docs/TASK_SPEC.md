# ANTIGRAVITY TASK: build two new architecture styles and compare them with Event-Driven

You are taking over a student project (course: Software Architecture and Design Patterns). You have no memory of
earlier work, so everything you need is in this file. Read it all. Then read the repo files named in Section 1.
Work in PHASES. Finish and verify one phase before the next. After EVERY task: commit, and update
`benchmark/PROGRESS.md` (what is done, what is not, how to resume) so another agent can continue if your quota ends.
Never fabricate numbers. Say clearly what you tested and what you could not test.

---

## 0. Why this task exists
The project compared Event-Driven (SSE push) with Polling. At the review the professor said it was like comparing
an ant and a lion: Polling was too weak, so Event-Driven dominated. New direction:
- **Ignore Polling.** Do NOT delete or edit it. Leave all its files. Remove it from the default Docker profile only.
  Move its old results to `benchmark/results/legacy_polling/` (keep, do not use in new comparisons).
- **Keep Event-Driven** as variant 1 (already built).
- **Add two new styles** and compare all three: **Modular Monolith** and **Microservices**.
Goal: a fair "lion, tiger, cheetah" comparison where each style wins at least one characteristic, with a working
frontend and backend for all three, strong evidence, and excellent design-pattern documentation.

## 1. What exists (read these first)
- `Event_Driven/Event_Backend` (Node, Express, Mongoose, Redis, port 5001): in-process EventEmitter bus
  (`src/utils/eventBus.js`), consumers in `src/consumers/`, SSE at `GET /api/notifications/:userId/stream`.
  `POST /api/telemetry/steps` publishes STEP_UPDATED and answers 200 at once; a consumer then saves FitnessData,
  checks goals, creates the Notification and pushes it over SSE.
- `Event_Driven/Event_Frontend` (plain JavaScript pages). `Polling/*` (leave alone).
- `benchmark/`: `loadgen.js` (v2 open-loop), `loadgen.selftest.js`, `run_load.sh`, `generate_dashboard.py`,
  Prometheus and Grafana config, `analysis/` scripts, results CSVs, `PROGRESS.md`, `README.md`, `results/ENVIRONMENT.md`.
  Root `docker-compose.yml` (per-variant Mongo and Redis, 1 CPU per app, `CACHE_TTL=300`, `QUIET=1`).
- Earlier task files in the repo or given with this one: `HANDOFF_ANTIGRAVITY.md`, `GRAFANA_EVERYTHING.md`,
  `OPENCODE_GRAFANA_MATCH.md`, `OPENCODE_FIX_NO_DATA.md`. If their work is not done (Grafana "No data" panels from
  `sum by(variant)` on one side of a division, exact-results exporter, self-test on port 9199), do it inside Phase 2.
- The app has: activity data (steps, calories, distance, sleep, weight, heart rate), goals (GOAL_REACHED notification),
  live workouts, daily dashboard, rule-based recommendations, notifications (list, read, mark read), MTurk Fitbit dataset.
- A teammate owns a bug fix for the event-driven workout flow. Do NOT change workout behaviour. In the new variants
  reproduce the CORRECT behaviour (a workout stop saves the result and updates the dashboard totals).
- The professor's guide (method): Characteristic -> Metric -> Hypothesis -> Experiment -> Verdict. Rules: variants
  differ by one decision, same logic/data/DB/load; warm up; step loads (hold 2 to 5 min); 3 runs, report median;
  p50/p95/p99 not averages; record machine specs and container limits; scalability round 1 = equal total CPU/memory,
  round 2 = scale only what is hot and record the cores needed; trade-off table; ADRs; threats to validity; report
  checklist. The professor wants each style to win something, and wants everyone to understand everything.

## 2. The three variants (exact definitions)
| | Event-Driven (exists) | Modular Monolith (new) | Microservices (new) |
|---|---|---|---|
| Deployment | one app | one app | gateway + 4 services |
| Parts talk by | in-process events | direct calls to a module's public API | HTTP calls between services |
| Data | one DB | one DB, each module owns its own collections | one Mongo container, ONE DATABASE PER SERVICE |
| Port | 5001 | 5011 | 5021 (gateway) |
Same for all three: the same HTTP API (paths, bodies, status codes, JSON shapes), the same frontend, the same Mongoose
schemas, the same business rules, SSE for delivering notifications to the browser, the same `GOAL_CPU_MS` setting.
Each variant has its own Mongo and Redis containers (never shared).

### Modular Monolith (folder `Modular_Monolith/Modular_Backend`, port 5011)
- Modules by business area: `telemetry`, `goals`, `notifications`, `workouts`, `recommendations`, `dashboard`.
- Each module has `index.js` as its ONLY public API (facade). Other modules may import only `modules/<name>/index.js`.
  A module owns its models and collections (prefix collection names per module, no cross-module Mongoose queries or joins).
- Telemetry saves the data FIRST, then calls `goals.evaluate(userId)`, which calls `notifications.create(...)`.
  No event bus on this path. `notifications` holds the SSE connections.
- Write `scripts/check-modules.js` (no dependencies): fails when a module imports another module's internals or a
  cross-module model. Run it in `npm test`. Document it ("keeping modules modular").

### Microservices (folder `Microservices/`, gateway on port 5021)
- `gateway` (nginx or a small Node proxy): routes the SAME public paths as the monolith so the frontend is unchanged,
  serves the frontend, adds `X-Request-Id` (correlation ID), exposes `/api/meta`.
- `telemetry-service` (steps, calories, distance, heart rate, sleep, weight, FitnessData, dashboard read model),
  `goal-service` (goals and goal evaluation, the HEAVY service), `notification-service` (notifications, SSE, read/unread),
  `workout-service` (workouts and recommendations).
- Calls between services are synchronous HTTP with a timeout (1 s) and one retry, correlation ID passed on every call.
  Telemetry saves first, then calls goal-service, which calls notification-service. Each service has `/health` and `/metrics`.
- Database per service (separate Mongo databases in the variant's Mongo container). No service reads another service's DB.
- Record `downstream_call_duration_seconds{from,to}` (the cost of each network hop).
- Shared code is a small copied `shared/` library; document the trade-off (shared library vs duplication).

### Notification fan-out (Modular Monolith and Microservices)
SSE connections live inside one process. Both new variants use a `NotificationHub` with a Redis Pub/Sub adapter, so
that replicas can deliver to the client they hold. (Event-Driven keeps its in-process bus and therefore cannot run as
several replicas; that is a documented finding, tested in E2.) Use the Adapter pattern for the hub.

### Controlled variables
- Heavy work: add `GOAL_CPU_MS` (default 10) = a busy loop in goal evaluation. Add the SAME setting to the
  Event-Driven goal consumer (small, separate commit, default 0 so old runs are unchanged). New experiments use 10.
- Round 1 equal TOTAL CPU: monolith apps 1.0 CPU each. Microservices total 1.0 CPU split across ALL its containers
  including the gateway (suggested: gateway 0.10, telemetry 0.25, goal 0.35, notification 0.20, workout 0.10). Record it.
- Memory limit per container recorded. `CACHE_TTL=300`, `QUIET=1`, same images for Mongo/Redis in every variant.

## 3. Pre-registered hypotheses (commit as `benchmark/docs/HYPOTHESES.md` BEFORE any benchmark run)
Write the star chart and these hypotheses first. Add numeric thresholds. Do not edit them after seeing data.
- H1 Speed: p50/p95 delivery latency: Modular Monolith lowest, Event-Driven middle, Microservices highest (network hops).
- H2 Scalability: when goal evaluation is hot, Microservices need fewer total cores than Modular Monolith to keep p95
  degradation <= 20% at the peak load (scale only goal-service). Event-Driven cannot be scaled by replicas without a broker.
- H3 Fault isolation: with the notification service/module failed, Microservices keep ingest, dashboard and goal saving
  working; the monoliths lose more journeys.
- H4 Durability: Event-Driven loses acknowledged steps after a crash right after the 200; the other two lose none.
- H5 Extensibility: Modular Monolith has the smallest change footprint to add a new goal type.
- H6 Cost: Modular Monolith uses the least CPU and memory and the fewest containers; Microservices the most.
- H7 Burst tolerance: Event-Driven handles a sudden step burst best.
Each style must win at least one characteristic. If the plan makes one style win everything, tell me and propose changes.

## 4. PHASES AND TASKS

### PHASE 1: working apps (must be fully working before Phase 2)
**T1 Orient.** Map every endpoint the frontend uses (read `Event_Frontend` code and `Event_Backend/src/routes`). Write
`benchmark/contract/API_CONTRACT.md`. Note frontend path bug: Event server serves `../../Story1_Event_Frontend`; the folder is
`Event_Frontend`. Fix with a one-line, separate commit. Move the frontend to a shared folder
`Frontend_Shared/` with `config.js` (`window.API_BASE`) and make all three variants serve it.
**T2 Contract tests.** `benchmark/contract/contract.test.js` (Node built-in `node:test`, no dependencies) runs the SAME checks
against any base URL: set goal, send steps, receive GOAL_REACHED over SSE, notification list/read/mark read, dashboard totals,
workout start/metrics/stop (stop persists and updates totals), recommendations, 404 and validation errors. Run it on Event-Driven first.
**T3 Modular Monolith.** Build as Section 2. Include `Dockerfile`, `/health`, `/metrics` (reuse the instrumentation module:
`http_request_duration_seconds`, `db_operations_total`, event-loop lag), `/api/meta` (name, version, style). Contract tests PASS.
**T4 Microservices.** Build as Section 2 with `docker-compose` profile. Contract tests PASS through the gateway.
**T5 Frontend.** One frontend for all variants. Show a small header badge from `/api/meta` ("Architecture: Modular Monolith").
Verify in a real browser (use Playwright if available, else a manual checklist written to `benchmark/docs/FRONTEND_CHECKLIST.md`)
that each screen works on all three variants: dashboard rings, activity, goals, workouts (start, live metrics, stop), recommendations,
notifications (live push, list, mark read). No console errors.
**T6 Compare demo page** `Frontend_Shared/compare.html`: one button "Send 1500 steps for a NEW user to all three", three panels
showing the milliseconds until each variant's notification arrives. Used in the live demo.
**T7 Compose.** Root `docker-compose.yml` profiles: `event`, `modular`, `micro`, plus monitoring always on. `docker compose --profile modular up -d`
etc. Healthchecks, `depends_on: service_healthy`, resource limits as Section 2, `.env.example`. Start one variant at a time for measuring.
`package.json` scripts: `up:event`, `up:modular`, `up:micro`, `test:contract`, `check:modules`.
**Phase 1 gate:** contract tests pass on all three, browser checklist done, `docker compose` starts each profile from scratch. Report before continuing.

### PHASE 2: measurement
**T8 Instrumentation.** Prometheus targets with `variant` = `event|modular|micro` and `service` labels. Add
`downstream_call_duration_seconds` and correlation-ID logging (JSON logs with `requestId`, `service`, `step`).
**T9 Load generator v3** (`benchmark/loadgen.js`): keep v2 correctness (open loop, fixed cycle, random think, equal offered load,
idle behaviour). Add `VARIANT=event|modular|micro` with `BASE_URL` per variant and the same flow (`/api/goals`, step ingest, SSE
listener). Do not use polling. Extend `loadgen.selftest.js` with stubs for the three variants (port 9199 for self-test metrics).
Support `STEPS` up to 800+, `GOAL_CPU_MS`, burst mode (0 to N clients in 5 s), and `--replicas` note in the CSV. Keep the CSV columns
and add `variant`, `replicas`, `containers`, `total_cpu_limit`.
**T10 Dashboard.** Update `generate_dashboard.py` for 3 variants: colours Event-Driven blue (#2563eb), Modular Monolith teal (#0f766e),
Microservices purple (#7c3aed). Rows by characteristic (Performance, Scalability, Resource efficiency and cost, Fault isolation and
availability, Durability, Observability) plus the "Exact results (same as CSV)" row from the CSV exporter. Fix any division with
`sum by(variant)` on one side only. Panel for hop latency (microservices). Variables: `run`, `variant`. Legends mean/max, not "Last".
Run `check_panels.js` and show no EMPTY panels while a variant is under load.

### PHASE 3: experiments (real runs only; each 3 runs; reset DBs between runs; one variant at a time)
Write start/end times in `benchmark/results/RUN_LOG.md`. Save CSVs to `benchmark/results/`. Machine specs in `ENVIRONMENT.md`.
- **E1 Baseline:** 10, 50, 100, 200 clients (extend to 400, 800 until degradation > 20% or errors start). Delivery p50/p95/p99, ingest,
  CPU, CPU per notification, memory (sum of all containers), container count, error rate, time-outs, latency degradation vs own 10-client baseline.
- **E2 Scale-out:** at the first load level where p95 degradation > 20%: Modular Monolith = replicate the whole app 2, 3 times behind nginx;
  Microservices = replicate ONLY goal-service; Event-Driven = run 2 replicas and count lost notifications (expected: lost, document it).
  Record cores and memory needed to get back under 20%, and scaling efficiency (throughput(N) / (N x throughput(1))).
- **E3 Fault isolation:** steady 100 clients. Fault A: notification service fails (Microservices: stop its container; monoliths: set
  `FAULT_NOTIFICATIONS=1` so the notifications module/consumer throws). Fault B: kill the whole app container. For each: error rate,
  which journeys still work (ingest, dashboard read, goal save, notification), time to recover (first time error < 1% and p95 within 20%
  of baseline). Mark fault start/end with Grafana annotations.
- **E4 Durability:** 20 trials per variant: send steps, kill the app container right after HTTP 200, restart, compare steps saved with
  steps acknowledged.
- **E5 Extensibility:** add ONE new goal type (`active_minutes`) to each variant on its own branch. Record files changed, lines added,
  services/modules touched (`git diff --stat`), wall-clock time, tests added. Keep all three working with the contract test.
- **E6 Deployability:** time to rebuild and restart after one small change in the goal logic (`docker compose build` + `up` timing) per variant.
- **E7 Observability:** with correlation IDs, take 100 sampled notifications and reconstruct each journey from logs; report the share that is
  complete per variant (Event-Driven bus vs direct calls vs HTTP).
- **E8 Burst:** 0 to 200 clients in 5 s; delivery p95 and time-outs per variant.
Safety: if a run shows the machine is the limit (CPU of the host near 100%), say so and lower the load; never hide it.

### PHASE 4: analysis and documents (`benchmark/docs/`, simple English, short sentences)
- `analysis/aggregate.js`: median and mean over runs per (variant, users); degradation vs own baseline; summary.csv and summary.md.
- `REPORT.md` (course Template 2), `TRADEOFFS.md` (table: characteristic, metric, event, modular, micro, better, matters for us),
  hypothesis scorecard (held / not held and why), star chart with stars only where a metric backs them (label argued-from-code ratings).
- ADRs in `docs/adr/`: ADR-001 chosen three styles and the single differing decision; ADR-002 sync HTTP between services;
  ADR-003 notification fan-out via Redis Pub/Sub; ADR-004 module boundaries and the check script; ADR-005 database per service;
  ADR-006 GOAL_CPU_MS as a controlled variable. Each with Title, Status, Context, Decision, Consequences, Governance.
- `ARCHITECTURE.md`: Mermaid diagram per variant, logical components, coupling (afferent and efferent counts from the code), characteristics.
- `DESIGN_PATTERNS.md`: list every pattern used and WHERE (file paths): Observer/Publish-Subscribe (event bus, Redis hub, SSE),
  Facade (module public API), Adapter (NotificationHub in-memory and Redis), Strategy or Factory (goal type evaluators),
  Repository (data access), API Gateway, Database per Service, Retry/Timeout (and Circuit Breaker if you add it), Singleton/config,
  Dependency Injection. For each: problem, why here, trade-off.
- `DEMO.md` (5-minute live demo with the compare page, Windows PowerShell commands with `curl.exe`, a NEW userId each time, fallback plan),
  `QA.md` (20 hardest professor questions with data-grounded answers and honest "not tested"), `NUMBERS_FOR_SLIDES.md`
  (every number, its source file, runs behind it), `SLIDE_CONTENT.md` (text and numbers for 7 slides: context, three architectures,
  characteristics and stars, method and hypotheses, results, trade-offs, verdict and limits), `PRESENTERS.md` (equal split for four people
  with a Q&A topic list each; not on the slides).
- Threats to validity: one laptop, load generator on the same host, GOAL_CPU_MS is simulated work, one feature, Redis hop in the new
  variants, Event-Driven acknowledges before saving, 3 runs, equal TOTAL CPU in round 1 only.

## 5. Quality bar ("best project")
- Every variant starts with one command and passes the contract tests; no unexplained console errors; clean `git status`.
- No dead code, no copied secrets, `.env.example` only. Simple English comments and READMEs. Meaningful commit messages.
- Each style wins at least one characteristic in the results, or you explain honestly why not and what you changed to be fair.
- Do not claim anything untested (no 10,000 users, no cloud). Report limits.

## 6. Rules
- Do not edit or delete Polling. Do not change workout logic in Event-Driven. Do not change old CSV results.
- Changes to Event-Driven are limited to: the static frontend path, `GOAL_CPU_MS`, `/api/meta`, metrics labels. Each in a separate commit.
- Push is blocked on this machine (HTTPS credentials). Do not bypass. Write `benchmark/GIT_PUSH.md` with steps and stop.
- If a decision is needed, stop and ask. At the end of every phase print a checklist: done / partly done / blocked, what you
  tested, what you could not test, exact commands to reproduce.
