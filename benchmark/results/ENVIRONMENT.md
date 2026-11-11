# Benchmark Environment

Recorded: 2026-11-11 (before E1 runs). Update this file if hardware or limits change.

## Host machine

| Item | Value |
|---|---|
| OS | Ubuntu 24.04.4 LTS on **WSL2** (kernel `6.6.87.2-microsoft-standard-WSL2`) |
| CPU | Intel Core 7 150U — 6 cores / 12 threads |
| RAM | 7.6 GiB total (≈5.4 GiB available at record time) |
| Swap | 2.0 GiB |
| Disk (repo volume) | `C:\` 931 GiB, ~627 GiB free (Windows drive mounted in WSL) |
| Docker | Docker Desktop with WSL2 backend; CLI via `DockerDesktop/resources/bin/docker.exe` |

**Note:** Docker Desktop itself runs on the Windows host; containers are Linux VMs. CPU/RAM numbers below are **container limits**, not host totals.

## Controlled variables (both variants equal)

| Variable | event | polling | Source |
|---|---|---|---|
| App CPU limit | **1.0 CPU** (`NanoCPUs=1000000000`) | **1.0 CPU** | `docker-compose.yml` `cpus: 1` |
| `CACHE_TTL` | **300 s** | **300 s** | compose env |
| `QUIET` | **1** | **1** | compose env |
| MongoDB | `mongo-event` → `fitness_event` | `mongo-polling` → `fitness_polling` | separate containers |
| Redis | `redis-event` | `redis-polling` | separate containers |
| Images | `mongo:7`, `redis:7-alpine` | same | compose |
| Poll interval | n/a (SSE push) | **5000 ms** (`POLL_INTERVAL_MS`) | compose / API |
| Loadgen worker cap | 20 concurrent per variant | 20 | `WORKER_CAP` in `loadgen.js` |

## Measurement stack

| Service | Port | Notes |
|---|---|---|
| event-app | 5001 | Express + Mongoose + Redis + SSE |
| polling-app | 5002 | Express + Mongoose + Redis + 5 s poll |
| Prometheus | 9090 | 5 s scrape; `variant` labels on apps + loadgen jobs |
| Grafana | 3000 | anonymous admin; dashboard uid `event-vs-polling` |
| loadgen metrics | 9100 | host process `benchmark/loadgen.js` (not in compose) |
| cAdvisor | — | **not installed** (panel empty on Docker Desktop; Linux only) |

## Mock-mode warning

Both backends still contain a silent in-memory fallback if MongoDB is unreachable (`src/config/db.js`).  
**A run is invalid unless logs show `MongoDB connected: mongo-*` with no mock message.** Any latency recorded without real Mongo **excludes database cost** — discard it.

## Load profile (E1 default)

| Step | Clients (each variant) | Hold | Warmup |
|---|---|---|---|
| 1 | 10 | 120 s | 20 s |
| 2 | 50 | 120 s | 20 s |
| 3 | 100 | 120 s | 20 s |
| 4 | 200 | 120 s | 20 s |

Three runs per level (`RUN_LABEL=run1..3`). Fresh `userId` per loadgen cycle; goal created before ingest (`target = cycleSteps`).

## Reproduce checks (run before every experiment block)

```bash
# 1. Stack healthy + real Mongo
docker logs event-app 2>&1 | grep MongoDB     # must show mongo-event, no mock
docker logs polling-app 2>&1 | grep MongoDB   # must show mongo-polling, no mock

# 2. CPU limits still 1
docker inspect event-app --format '{{.HostConfig.NanoCpus}}'    # 1000000000
docker inspect polling-app --format '{{.HostConfig.NanoCpus}}'  # 1000000000

# 3. Metrics live
curl -s localhost:5001/metrics | grep db_operations_total | head -3
curl -s localhost:5002/metrics | grep poll_responses_total | head -3
```

## Screenshot instructions (not images)

Save under `benchmark/results/screenshots/` with names  
`<variant>_<panel>_<users>users.png` (e.g. `event_delivery_100users.png`).

| Experiment | Grafana panel group | Time range |
|---|---|---|
| E1 delivery | Row 1 → Notification Delivery Latency | middle of each 10/50/100/200 step |
| E1 ingest | Row 2 → Ingest Latency + Ingest throughput | same steps |
| E1 resources | Row 3 → CPU Cores, Memory RSS, CPU-ms per INGEST | same steps |
| E1 mechanism | Row 4 → Empty-poll share, Poll intensity, Event mechanism | full run |
| E2 ablation | Row 1 delivery + Row 4 poll intensity | per POLL_MS=1/5/15 s |
| E3 high load | Row 1 + Row 2 + Event-loop lag | first degradation step |
| E4 durability | not a Grafana panel — record Mongo vs HTTP 200 counts in CSV/notes | n/a |
